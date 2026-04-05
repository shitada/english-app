"""Conversation API endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.config import get_conversation_topics, get_prompt, get_vocabulary_topics
from app.copilot_client import get_copilot_service
from app.dal import conversation as conv_dal
from app.database import get_db_session
from app.rate_limit import require_rate_limit
from app.utils import coerce_bool, extract_role, get_topic_label, safe_llm_call, validate_topic

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversation", tags=["conversation"])


class StartRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    difficulty: Literal["beginner", "intermediate", "advanced"] = "intermediate"


class MessageRequest(BaseModel):
    conversation_id: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=2000)


class EndRequest(BaseModel):
    conversation_id: int = Field(ge=1)


class StartResponse(BaseModel):
    conversation_id: int
    message: str
    topic: str
    phrase_suggestions: list[str] = []
    key_phrases: list[str] = []


class MessageResponse(BaseModel):
    message: str
    feedback: dict[str, Any] | None
    phrase_suggestions: list[str] = []
    key_phrases: list[str] = []


class EndResponse(BaseModel):
    summary: dict[str, Any]


class ConversationListItem(BaseModel):
    id: int
    topic: str
    difficulty: str
    started_at: str
    ended_at: str | None
    status: str
    message_count: int
    duration_seconds: int | None = None


class ConversationListResponse(BaseModel):
    conversations: list[ConversationListItem]
    total_count: int
    has_more: bool


@router.get("/topics")
async def list_topics():
    return get_conversation_topics()


async def _generate_phrase_suggestions(
    copilot: Any, ai_message: str, topic_label: str, difficulty: str
) -> list[str]:
    """Generate 2-3 reply starter phrases for the user (non-fatal)."""
    try:
        prompt = (
            f"Given this AI message in a {topic_label} conversation at {difficulty} level:\n"
            f'"{ai_message}"\n\n'
            "Suggest 2-3 short English phrases the user could reply with. "
            "Keep them natural, varied, and appropriate for the difficulty level. "
            'Return JSON: {"suggestions": ["phrase1", "phrase2", "phrase3"]}'
        )
        result = await copilot.ask_json(
            "You are an English conversation helper. Return ONLY valid JSON.",
            prompt,
        )
        suggestions = result.get("suggestions", [])
        if isinstance(suggestions, list):
            return [str(s) for s in suggestions[:3] if s]
        return []
    except Exception as e:
        logger.warning("Phrase suggestion generation failed (non-fatal): %s", e)
        return []


async def _extract_key_phrases(
    copilot: Any, ai_message: str
) -> list[str]:
    """Extract 2-4 key phrases/idioms from AI message for highlighting (non-fatal)."""
    try:
        prompt = (
            f"From this English conversation message:\n"
            f'"{ai_message}"\n\n'
            "Identify 2-4 useful English phrases, idioms, collocations, or expressions "
            "that a language learner should pay attention to. Pick phrases that appear "
            "verbatim in the message. "
            'Return JSON: {"key_phrases": ["phrase1", "phrase2"]}'
        )
        result = await copilot.ask_json(
            "You are an English language teaching assistant. Return ONLY valid JSON.",
            prompt,
        )
        phrases = result.get("key_phrases", [])
        if isinstance(phrases, list):
            # Only keep phrases that actually appear in the message (case-insensitive)
            lower_msg = ai_message.lower()
            return [str(p) for p in phrases[:4] if p and str(p).lower() in lower_msg]
        return []
    except Exception as e:
        logger.warning("Key phrase extraction failed (non-fatal): %s", e)
        return []


@router.post("/start", response_model=StartResponse)
async def start_conversation(req: StartRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    topics = get_conversation_topics()
    topic_data = validate_topic(topics, req.topic)
    topic_label = topic_data["label"]

    conversation_id = await conv_dal.create_conversation(db, req.topic, req.difficulty)

    copilot = get_copilot_service()

    difficulty_instructions = {
        "beginner": "\nIMPORTANT: Use simple vocabulary and short sentences (5-8 words). Speak slowly and clearly. If the user makes mistakes, gently correct them with the right phrase. Avoid idioms and complex grammar.",
        "intermediate": "\nUse natural conversational English. Mix simple and moderate vocabulary. Correct significant grammar errors but keep the conversation flowing.",
        "advanced": "\nUse natural, fluent English including idioms, phrasal verbs, and complex sentence structures. Challenge the user with nuanced vocabulary. Only correct subtle errors. Discuss topics in depth.",
    }

    system = get_prompt("conversation_partner").format(
        scenario=topic_data.get("scenario", topic_label),
        role=extract_role(topic_data.get("scenario", "a conversation partner")),
        goal=topic_data.get("goal", "Have a natural conversation"),
    ) + difficulty_instructions[req.difficulty]
    try:
        opening = await safe_llm_call(
            lambda: copilot.ask(system, "Start the scenario. Greet the user in character."),
            context="start_conversation",
        )
    except Exception:
        await conv_dal.delete_conversation(db, conversation_id)
        raise

    await conv_dal.add_message(db, conversation_id, "assistant", opening)

    suggestions, key_phrases = await asyncio.gather(
        _generate_phrase_suggestions(copilot, opening, topic_label, req.difficulty),
        _extract_key_phrases(copilot, opening),
    )

    return {
        "conversation_id": conversation_id,
        "message": opening,
        "topic": req.topic,
        "phrase_suggestions": suggestions,
        "key_phrases": key_phrases,
    }


def _normalize_grammar_feedback(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize LLM grammar feedback to ensure consistent types."""
    result = dict(raw)
    result["is_correct"] = coerce_bool(result.get("is_correct", True))
    result["corrected_text"] = str(result.get("corrected_text") or "")
    errors = result.get("errors")
    result["errors"] = [e for e in errors if isinstance(e, dict)] if isinstance(errors, list) else []
    suggestions = result.get("suggestions")
    result["suggestions"] = [s for s in suggestions if isinstance(s, dict)] if isinstance(suggestions, list) else []
    return result


def _normalize_summary(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize LLM conversation summary to ensure consistent types."""
    result = dict(raw)
    kv = result.get("key_vocabulary")
    if isinstance(kv, str):
        result["key_vocabulary"] = [w.strip() for w in kv.split(",") if w.strip()]
    elif isinstance(kv, list):
        result["key_vocabulary"] = [str(item) for item in kv]
    else:
        result["key_vocabulary"] = []
    if not isinstance(result.get("communication_level"), str):
        result["communication_level"] = str(result.get("communication_level", "unknown"))
    if not isinstance(result.get("tip"), str):
        result["tip"] = str(result.get("tip") or "")
    if not isinstance(result.get("summary"), str):
        result["summary"] = str(result.get("summary") or "")
    return result


@router.post("/message", response_model=MessageResponse)
async def send_message(req: MessageRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    conv = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or already ended")

    topics = get_conversation_topics()
    topic_data = next((t for t in topics if t["id"] == conv["topic"]), None)
    topic_label = topic_data["label"] if topic_data else conv["topic"]

    user_msg_id = await conv_dal.add_message(db, req.conversation_id, "user", req.content)

    history = await conv_dal.format_history_text(db, req.conversation_id)

    copilot = get_copilot_service()

    # Prepare prompts
    grammar_prompt = get_prompt("grammar_checker").format(user_message=req.content)
    system = get_prompt("conversation_partner").format(
        scenario=topic_data.get("scenario", topic_label) if topic_data else topic_label,
        role=extract_role(topic_data.get("scenario", "a conversation partner")) if topic_data else "a conversation partner",
        goal=topic_data.get("goal", "Have a natural conversation") if topic_data else "Have a natural conversation",
    )
    conv_prompt = f"Conversation so far:\n{history}\n\nContinue the scenario naturally. Stay in character and respond to what the user just said."

    # Run grammar check and conversation response in PARALLEL
    # Grammar check is non-fatal — if it fails, we still return the AI response
    t0 = time.monotonic()

    async def _safe_grammar_check():
        try:
            return await copilot.ask_json(
                "You are an English grammar and expression checker. Return ONLY valid JSON.",
                grammar_prompt,
            )
        except Exception as e:
            logger.warning("Grammar check failed (non-fatal): %s", e)
            return None

    try:
        feedback, ai_response = await asyncio.gather(
            _safe_grammar_check(),
            safe_llm_call(lambda: copilot.ask(system, conv_prompt), context="send_message"),
        )
    except Exception:
        await conv_dal.delete_message(db, user_msg_id)
        raise
    logger.info("Parallel LLM calls completed (%.1fs)", time.monotonic() - t0)

    # Save feedback + AI response
    if feedback is not None:
        feedback = _normalize_grammar_feedback(feedback)
        await conv_dal.update_message_feedback(db, user_msg_id, feedback)
    await conv_dal.add_message(db, req.conversation_id, "assistant", ai_response)

    # Generate phrase suggestions and extract key phrases (non-fatal, parallel)
    suggestions, key_phrases = await asyncio.gather(
        _generate_phrase_suggestions(copilot, ai_response, topic_label, conv.get("difficulty", "intermediate")),
        _extract_key_phrases(copilot, ai_response),
    )

    return {"message": ai_response, "feedback": feedback, "phrase_suggestions": suggestions, "key_phrases": key_phrases}


@router.post("/end", response_model=EndResponse)
async def end_conversation(req: EndRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    conv = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    history = await conv_dal.format_history_text(db, req.conversation_id)

    copilot = get_copilot_service()
    summary_prompt = get_prompt("conversation_summary").format(conversation=history)
    try:
        summary = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English learning assistant. Return ONLY valid JSON.",
                summary_prompt,
            ),
            context="end_conversation",
        )
    except HTTPException:
        logger.warning("Summary generation failed for conversation %s; using fallback", req.conversation_id)
        summary = {
            "note": "Summary could not be generated",
            "key_vocabulary": [],
            "communication_level": "unknown",
            "tip": "",
        }

    summary = _normalize_summary(summary)

    transitioned = await conv_dal.end_conversation(db, req.conversation_id, summary=summary)
    if not transitioned:
        raise HTTPException(status_code=409, detail="Conversation was already ended")

    return {"summary": summary}


@router.get("/{conversation_id}/summary")
async def get_summary(conversation_id: int = Path(ge=1), db: aiosqlite.Connection = Depends(get_db_session)):
    """Retrieve a stored conversation summary."""
    summary = await conv_dal.get_conversation_summary(db, conversation_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="Summary not found")
    return {"summary": _normalize_summary(summary)}


@router.get("/{conversation_id}/history")
async def get_history(conversation_id: int = Path(ge=1), db: aiosqlite.Connection = Depends(get_db_session)):
    if not await conv_dal.conversation_exists(db, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = await conv_dal.get_conversation_history(db, conversation_id)
    messages = []
    for r in rows:
        feedback = None
        if r["feedback_json"]:
            try:
                feedback = json.loads(r["feedback_json"])
            except (json.JSONDecodeError, TypeError):
                pass
        msg = {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "feedback": feedback,
            "is_bookmarked": bool(r["is_bookmarked"]),
            "created_at": r["created_at"],
        }
        messages.append(msg)
    return {"messages": messages}


@router.get("/list", response_model=ConversationListResponse)
async def list_conversations(
    topic: str | None = None,
    keyword: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """List past conversations with message counts."""
    conversations = await conv_dal.list_conversations(db, topic=topic, keyword=keyword, limit=limit, offset=offset)
    total_count = await conv_dal.count_conversations(db, topic=topic, keyword=keyword)
    topics = get_conversation_topics()
    conversations = [
        {**c, "topic": get_topic_label(topics, c["topic"])} for c in conversations
    ]
    return {
        "conversations": conversations,
        "total_count": total_count,
        "has_more": (offset + limit) < total_count,
    }


class DeleteResponse(BaseModel):
    deleted: bool


class ClearResponse(BaseModel):
    deleted_count: int


@router.delete("/{conversation_id}", response_model=DeleteResponse)
async def delete_conversation(conversation_id: int = Path(ge=1), db: aiosqlite.Connection = Depends(get_db_session)):
    """Delete a conversation and its messages."""
    deleted = await conv_dal.delete_conversation(db, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@router.delete("/clear/ended", response_model=ClearResponse)
async def clear_ended_conversations(db: aiosqlite.Connection = Depends(get_db_session)):
    """Delete all ended and abandoned conversations."""
    count = await conv_dal.delete_ended_conversations(db)
    return {"deleted_count": count}


class CleanupResponse(BaseModel):
    abandoned_count: int


@router.post("/cleanup/stale", response_model=CleanupResponse)
async def cleanup_stale_conversations(
    max_age_hours: int = Query(default=24, ge=1, le=720),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Mark stale active conversations as abandoned."""
    count = await conv_dal.cleanup_stale_conversations(db, max_age_hours=max_age_hours)
    return {"abandoned_count": count}


class ExportMessageItem(BaseModel):
    role: str
    content: str
    feedback: Any = None
    created_at: str


class ConversationExportResponse(BaseModel):
    id: int
    topic: str
    difficulty: str
    started_at: str
    ended_at: str | None
    status: str
    summary: Any = None
    messages: list[ExportMessageItem]


@router.get("/{conversation_id}/export", response_model=ConversationExportResponse)
async def export_conversation(
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Export a full conversation transcript with metadata and messages."""
    data = await conv_dal.get_conversation_export(db, conversation_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    topics = get_conversation_topics()
    data["topic"] = get_topic_label(topics, data["topic"])
    return data


@router.get("/grammar-accuracy")
async def grammar_accuracy(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get grammar accuracy statistics across all conversations."""
    result = await conv_dal.get_grammar_accuracy(db)
    topics = get_conversation_topics()
    result["by_topic"] = [
        {**item, "topic": get_topic_label(topics, item["topic"])}
        for item in result["by_topic"]
    ]
    return result


@router.get("/topic-recommendations")
async def topic_recommendations(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get conversation topic recommendations based on practice history."""
    topics = get_conversation_topics()
    all_topic_keys = [t["id"] for t in topics]
    recs = await conv_dal.get_topic_recommendations(db, all_topic_keys)
    return [
        {**r, "topic": get_topic_label(topics, r["topic"])} for r in recs
    ]


@router.put("/messages/{message_id}/bookmark")
async def toggle_bookmark(
    message_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Toggle bookmark status on a conversation message."""
    result = await conv_dal.toggle_message_bookmark(db, message_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return result


@router.get("/bookmarks")
async def list_bookmarks(
    conversation_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """List all bookmarked messages, optionally filtered by conversation."""
    items = await conv_dal.get_bookmarked_messages(db, conversation_id, limit, offset)
    total = await conv_dal.count_bookmarked_messages(db, conversation_id)
    topics = get_conversation_topics()
    items = [{**item, "topic": get_topic_label(topics, item["topic"])} for item in items]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{conversation_id}/replay")
async def get_conversation_replay(
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get conversation as turn-by-turn pairs for replay/review mode."""
    result = await conv_dal.get_conversation_replay(db, conversation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    topics = get_conversation_topics()
    result["conversation"]["topic"] = get_topic_label(topics, result["conversation"]["topic"])
    return result


@router.get("/{conversation_id}/vocabulary")
async def get_conversation_vocabulary(
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Find vocabulary words that appear in a conversation's messages."""
    result = await conv_dal.get_conversation_vocabulary(db, conversation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    vocab_topics = get_vocabulary_topics()
    result["words"] = [{**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in result.get("words", [])]
    return result
