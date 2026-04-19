"""Conversation API endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.config import get_conversation_topics, get_prompt, get_vocabulary_topics
from app.copilot_client import get_copilot_service
from app.dal import conversation as conv_dal
from app.dal import preferences as pref_dal
from app.dal import vocabulary as vocab_dal
from app.database import get_db_session
from app.rate_limit import require_rate_limit
from app.utils import coerce_bool, extract_role, get_topic_label, safe_llm_call, validate_topic

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversation", tags=["conversation"])

# Maximum number of past messages to include when building the LLM prompt for /message.
# Keeps token usage bounded for long conversations; older turns are summarized as a marker.
MESSAGE_HISTORY_MAX_TURNS = 16


class StartRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    difficulty: Literal["beginner", "intermediate", "advanced"] = "intermediate"
    role_swap: bool = False
    personality: Literal["patient_teacher", "chatty_friend", "professional", "challenging"] = "patient_teacher"


PERSONALITY_INSTRUCTIONS: dict[str, str] = {
    "patient_teacher": (
        "\nCommunication style: You are a patient, encouraging teacher. "
        "Use simple and clear language. Gently correct mistakes by rephrasing "
        "what the user said correctly. Speak slowly and give positive reinforcement."
    ),
    "chatty_friend": (
        "\nCommunication style: You are a casual, chatty friend. "
        "Use informal language, slang, contractions, and common idioms. "
        "Be enthusiastic and fun. React naturally like a real friend would."
    ),
    "professional": (
        "\nCommunication style: You are a formal professional. "
        "Use polished, business-appropriate language. Maintain a courteous and "
        "respectful tone. Prefer formal register, complete sentences, and "
        "professional vocabulary."
    ),
    "challenging": (
        "\nCommunication style: You are intellectually challenging. "
        "Use advanced vocabulary, complex sentence structures, and nuanced ideas. "
        "Push the user to express themselves more precisely. Ask follow-up "
        "questions that require deeper thinking."
    ),
}


class MessageRequest(BaseModel):
    conversation_id: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=2000)


class EndRequest(BaseModel):
    conversation_id: int = Field(ge=1)
    skip_summary: bool = False


class GrammarNote(BaseModel):
    phrase: str
    grammar_point: str
    explanation: str


class StartResponse(BaseModel):
    conversation_id: int
    message: str
    topic: str
    phrase_suggestions: list[str] = []
    key_phrases: list[str] = []
    grammar_notes: list[GrammarNote] = []
    user_role: str = ""
    role_briefing: list[str] = []


class MessageResponse(BaseModel):
    message: str
    feedback: dict[str, Any] | None
    phrase_suggestions: list[str] = []
    key_phrases: list[str] = []
    grammar_notes: list[GrammarNote] = []


class EndResponse(BaseModel):
    summary: dict[str, Any]


class HelpersRequest(BaseModel):
    conversation_id: int = Field(ge=1)


class HelpersResponse(BaseModel):
    phrase_suggestions: list[str] = []
    key_phrases: list[str] = []
    grammar_notes: list[GrammarNote] = []


class ConversationListItem(BaseModel):
    id: int
    topic: str
    topic_id: str = ""
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


CONVERSATION_MEMORY_KEY = "conversation_memory"


@router.get("/memory")
async def get_conversation_memory(db: aiosqlite.Connection = Depends(get_db_session)):
    """Load stored personal facts the AI remembers about the user."""
    raw = await pref_dal.get_preference(db, CONVERSATION_MEMORY_KEY)
    if not raw:
        return {"facts": []}
    try:
        facts = json.loads(raw)
        if not isinstance(facts, list):
            return {"facts": []}
        return {"facts": [str(f) for f in facts if f]}
    except (json.JSONDecodeError, TypeError):
        return {"facts": []}


@router.delete("/memory")
async def clear_conversation_memory(db: aiosqlite.Connection = Depends(get_db_session)):
    """Clear all stored personal facts."""
    deleted = await pref_dal.delete_preference(db, CONVERSATION_MEMORY_KEY)
    return {"cleared": deleted}


@router.get("/topics")
async def list_topics(db: aiosqlite.Connection = Depends(get_db_session)):
    config_topics = get_conversation_topics()
    custom = await conv_dal.list_custom_topics(db)
    custom_as_topics = [{"id": t["id"], "label": t["label"], "description": t["description"], "is_custom": True} for t in custom]
    return config_topics + custom_as_topics


@router.get("/topics/favorites")
async def get_favorite_topics(db: aiosqlite.Connection = Depends(get_db_session)):
    """Return list of favorited topic IDs."""
    raw = await pref_dal.get_preference(db, "favorite_topics")
    favorites: list[str] = json.loads(raw) if raw else []
    return {"favorites": favorites}


@router.put("/topics/{topic_id}/favorite")
async def toggle_topic_favorite(
    topic_id: str = Path(min_length=1, max_length=100),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Toggle a topic's favorite status."""
    topics = get_conversation_topics()
    valid_ids = {t["id"] for t in topics}
    custom_topics = await conv_dal.list_custom_topics(db)
    valid_ids |= {t["id"] for t in custom_topics}
    if topic_id not in valid_ids:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    raw = await pref_dal.get_preference(db, "favorite_topics")
    favorites: list[str] = json.loads(raw) if raw else []

    if topic_id in favorites:
        favorites.remove(topic_id)
        is_favorite = False
    else:
        favorites.append(topic_id)
        is_favorite = True

    await pref_dal.set_preference(db, "favorite_topics", json.dumps(favorites))
    return {"topic_id": topic_id, "is_favorite": is_favorite, "favorites": favorites}


class CreateCustomTopicRequest(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    scenario: str = Field(min_length=5, max_length=500)
    goal: str = Field(default="Have a natural conversation", max_length=300)


@router.get("/custom-topics")
async def get_custom_topics(db: aiosqlite.Connection = Depends(get_db_session)):
    """List all user-created custom topics."""
    return await conv_dal.list_custom_topics(db)


@router.post("/custom-topics")
async def create_custom_topic(req: CreateCustomTopicRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    """Create a new custom conversation scenario."""
    import re as _re
    topic_id = "custom_" + _re.sub(r"[^a-z0-9]+", "_", req.label.lower()).strip("_")[:40]
    existing = await conv_dal.list_custom_topics(db)
    if any(t["id"] == topic_id for t in existing):
        raise HTTPException(status_code=409, detail=f"A custom topic with ID '{topic_id}' already exists")
    return await conv_dal.create_custom_topic(db, topic_id, req.label, req.description, req.scenario, req.goal)


@router.delete("/custom-topics/{topic_id}")
async def delete_custom_topic(topic_id: str = Path(min_length=1), db: aiosqlite.Connection = Depends(get_db_session)):
    """Delete a custom topic."""
    deleted = await conv_dal.delete_custom_topic(db, topic_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Custom topic '{topic_id}' not found")
    return {"deleted": True}


async def _extract_reply_helpers(
    copilot: Any, ai_message: str, topic_label: str, difficulty: str
) -> tuple[list[str], list[str], list[dict]]:
    """Generate reply suggestions, extract key phrases, and identify grammar notes in a single LLM call."""
    try:
        prompt = (
            f"Given this AI message in a {topic_label} conversation at {difficulty} level:\n"
            f'"{ai_message}"\n\n'
            "Do three things:\n"
            "1. Suggest 2-3 short English phrases the user could reply with. "
            "Keep them natural, varied, and appropriate for the difficulty level.\n"
            "2. Identify 2-4 useful English phrases, idioms, or expressions from the message "
            "that a language learner should pay attention to. Pick phrases that appear "
            "verbatim in the message.\n"
            "3. Identify 1-3 interesting grammar patterns in the message (e.g. conditionals, "
            "phrasal verbs, tense usage, passive voice). For each, give the exact phrase from "
            "the message, the grammar point name, and a brief explanation.\n\n"
            'Return JSON: {"suggestions": ["reply1", "reply2"], "key_phrases": ["phrase1", "phrase2"], '
            '"grammar_notes": [{"phrase": "exact phrase from message", "grammar_point": "Present Perfect", '
            '"explanation": "Used for actions with current relevance"}]}'
        )
        result = await copilot.ask_json(
            "You are an English conversation helper. Return ONLY valid JSON.",
            prompt,
        )
        suggestions = result.get("suggestions", [])
        if not isinstance(suggestions, list):
            suggestions = []
        suggestions = [str(s) for s in suggestions[:3] if s]

        phrases = result.get("key_phrases", [])
        if not isinstance(phrases, list):
            phrases = []
        lower_msg = ai_message.lower()
        phrases = [str(p) for p in phrases[:4] if p and str(p).lower() in lower_msg]

        grammar_notes = result.get("grammar_notes", [])
        if not isinstance(grammar_notes, list):
            grammar_notes = []
        grammar_notes = [
            {"phrase": str(n["phrase"]), "grammar_point": str(n["grammar_point"]), "explanation": str(n["explanation"])}
            for n in grammar_notes[:3]
            if isinstance(n, dict) and n.get("phrase") and n.get("grammar_point") and n.get("explanation")
            and str(n["phrase"]).lower() in lower_msg
        ]

        return suggestions, phrases, grammar_notes
    except Exception as e:
        logger.warning("Reply helpers generation failed (non-fatal): %s", e)
        return [], [], []


def _swap_scenario_roles(scenario: str) -> str:
    """Swap AI/user roles in a scenario string for role-swap mode.

    E.g. 'You are a hotel front desk clerk. The user is a guest checking in.'
    becomes 'You are a guest checking in. The user is a hotel front desk clerk.'
    """
    ai_match = re.search(r"You are (.+?)\.", scenario)
    user_match = re.search(r"The user is (.+?)\.?$", scenario)
    if ai_match and user_match:
        ai_role = ai_match.group(1).strip()
        user_role = user_match.group(1).strip()
        return f"You are {user_role}. The user is {ai_role}."
    return scenario


@router.post("/start", response_model=StartResponse)
async def start_conversation(req: StartRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    topics = get_conversation_topics()
    # Try config topics first, then fall back to custom topics
    try:
        topic_data = validate_topic(topics, req.topic)
    except HTTPException:
        custom_topics = await conv_dal.list_custom_topics(db)
        custom_match = next((t for t in custom_topics if t["id"] == req.topic), None)
        if not custom_match:
            raise
        topic_data = custom_match
    topic_label = topic_data["label"]

    conversation_id = await conv_dal.create_conversation(db, req.topic, req.difficulty, role_swap=req.role_swap, personality=req.personality)

    copilot = get_copilot_service()

    difficulty_instructions = {
        "beginner": "\nIMPORTANT: Use simple vocabulary and short sentences (5-8 words). Speak slowly and clearly. If the user makes mistakes, gently correct them with the right phrase. Avoid idioms and complex grammar.",
        "intermediate": "\nUse natural conversational English. Mix simple and moderate vocabulary. Correct significant grammar errors but keep the conversation flowing.",
        "advanced": "\nUse natural, fluent English including idioms, phrasal verbs, and complex sentence structures. Challenge the user with nuanced vocabulary. Only correct subtle errors. Discuss topics in depth.",
    }

    scenario = topic_data.get("scenario", topic_label)
    user_role_name = ""
    if req.role_swap:
        # Extract the user's role before swapping (the original AI role becomes user's role)
        ai_match = re.search(r"You are (.+?)\.", scenario)
        if ai_match:
            user_role_name = ai_match.group(1).strip()
        scenario = _swap_scenario_roles(scenario)

    system = get_prompt("conversation_partner").format(
        scenario=scenario,
        role=extract_role(scenario),
        goal=topic_data.get("goal", "Have a natural conversation"),
    ) + difficulty_instructions[req.difficulty] + PERSONALITY_INSTRUCTIONS[req.personality]

    # Inject stored memory facts for personalised conversations
    memory_raw = await pref_dal.get_preference(db, CONVERSATION_MEMORY_KEY)
    if memory_raw:
        try:
            memory_facts: list[str] = json.loads(memory_raw)
            if isinstance(memory_facts, list) and memory_facts:
                system += (
                    "\n\nThings you know about this student from past conversations: "
                    + "; ".join(str(f) for f in memory_facts[:10])
                    + ". Use these naturally when relevant — don't list them explicitly."
                )
        except (json.JSONDecodeError, TypeError):
            pass

    async def _get_briefing() -> list[str]:
        prompt = (
            f"The user is practicing English by role-playing as '{user_role_name}' in a {topic_label} scenario. "
            f"List exactly 4 short professional English phrases that a {user_role_name} would commonly say. "
            "Return ONLY a JSON array of strings, no explanation."
        )
        try:
            raw = await safe_llm_call(
                lambda: copilot.ask("You are a helpful English teacher.", prompt),
                context="role_briefing",
            )
            parsed = json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
            if isinstance(parsed, list):
                return [str(p) for p in parsed[:4]]
        except Exception:
            logger.warning("Failed to generate role briefing phrases")
        return []

    role_briefing: list[str] = []
    if req.role_swap and user_role_name:
        # Run opening greeting and role-briefing concurrently to halve latency.
        t0 = time.monotonic()
        opening_task = safe_llm_call(
            lambda: copilot.ask(system, "Start the scenario. Greet the user in character.", label="conversation_start"),
            context="start_conversation",
        )
        briefing_task = _get_briefing()
        results = await asyncio.gather(opening_task, briefing_task, return_exceptions=True)
        opening_result, briefing_result = results
        if isinstance(opening_result, BaseException):
            await conv_dal.delete_conversation(db, conversation_id)
            raise opening_result
        opening = opening_result
        # Briefing failure is non-fatal.
        if isinstance(briefing_result, BaseException):
            logger.warning("Role briefing task raised: %s", briefing_result)
            role_briefing = []
        else:
            role_briefing = briefing_result
        logger.info("Parallel start LLM calls completed (%.1fs)", time.monotonic() - t0)
    else:
        try:
            opening = await safe_llm_call(
                lambda: copilot.ask(system, "Start the scenario. Greet the user in character.", label="conversation_start"),
                context="start_conversation",
            )
        except Exception:
            await conv_dal.delete_conversation(db, conversation_id)
            raise

    await conv_dal.add_message(db, conversation_id, "assistant", opening)

    suggestions: list[str] = []
    key_phrases: list[str] = []
    grammar_notes: list[dict] = []

    return {
        "conversation_id": conversation_id,
        "message": opening,
        "topic": req.topic,
        "phrase_suggestions": suggestions,
        "key_phrases": key_phrases,
        "grammar_notes": grammar_notes,
        "user_role": user_role_name,
        "role_briefing": role_briefing,
    }


def _canonicalize_error(e: dict[str, Any]) -> dict[str, Any]:
    """Canonicalize error dict keys to {original, correction, explanation}."""
    result = dict(e)
    for key in ("wrong", "incorrect", "incorrect_part"):
        if key in result and "original" not in result:
            result["original"] = result.pop(key)
    for key in ("correct", "corrected", "right", "fixed"):
        if key in result and "correction" not in result:
            result["correction"] = result.pop(key)
    for key in ("reason", "why", "note", "description"):
        if key in result and "explanation" not in result:
            result["explanation"] = result.pop(key)
    return result


def _canonicalize_suggestion(s: dict[str, Any]) -> dict[str, Any]:
    """Canonicalize suggestion dict keys to {original, better, explanation}."""
    result = dict(s)
    for key in ("current", "text", "sentence"):
        if key in result and "original" not in result:
            result["original"] = result.pop(key)
    for key in ("improved", "suggested", "alternative", "better_version"):
        if key in result and "better" not in result:
            result["better"] = result.pop(key)
    for key in ("reason", "why", "note"):
        if key in result and "explanation" not in result:
            result["explanation"] = result.pop(key)
    return result


def _normalize_grammar_feedback(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize LLM grammar feedback to ensure consistent types."""
    result = dict(raw)
    result["corrected_text"] = str(result.get("corrected_text") or "")
    raw_errors = result.get("errors")
    # Normalize errors to list of dicts, preserving non-list truthy values
    if isinstance(raw_errors, list):
        result["errors"] = [
            _canonicalize_error(e) if isinstance(e, dict) else {"original": "", "correction": "", "explanation": str(e)}
            for e in raw_errors
            if isinstance(e, (dict, str)) and (not isinstance(e, str) or e.strip())
        ]
    elif isinstance(raw_errors, dict):
        result["errors"] = [_canonicalize_error(raw_errors)]
    elif isinstance(raw_errors, str) and raw_errors.strip():
        result["errors"] = [{"original": "", "correction": "", "explanation": raw_errors}]
    else:
        result["errors"] = []
    suggestions = result.get("suggestions")
    if isinstance(suggestions, list):
        result["suggestions"] = [
            _canonicalize_suggestion(s) if isinstance(s, dict) else {"original": "", "better": str(s), "explanation": ""}
            for s in suggestions
            if isinstance(s, (dict, str)) and (not isinstance(s, str) or s.strip())
        ]
    elif isinstance(suggestions, dict):
        result["suggestions"] = [_canonicalize_suggestion(suggestions)]
    elif isinstance(suggestions, str) and suggestions.strip():
        result["suggestions"] = [{"original": "", "better": suggestions, "explanation": ""}]
    else:
        result["suggestions"] = []
    # Infer is_correct from errors when LLM omits the field or provides null
    if "is_correct" in raw and raw["is_correct"] is not None:
        result["is_correct"] = coerce_bool(raw["is_correct"])
    else:
        # Use raw_errors truthiness to detect LLM-indicated errors even if normalization empties the list
        has_errors = bool(raw_errors) if not isinstance(raw_errors, list) else len(result["errors"]) > 0
        result["is_correct"] = not has_errors
    return result


def _normalize_summary(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize LLM conversation summary to ensure consistent types."""
    result = dict(raw)
    kv = result.get("key_vocabulary")
    if isinstance(kv, str):
        result["key_vocabulary"] = [w.strip() for w in kv.split(",") if w.strip()]
    elif isinstance(kv, list):
        result["key_vocabulary"] = [str(item) for item in kv if item is not None]
    else:
        result["key_vocabulary"] = []
    if not isinstance(result.get("communication_level"), str):
        result["communication_level"] = str(result.get("communication_level") or "unknown")
    if not isinstance(result.get("tip"), str):
        result["tip"] = str(result.get("tip") or "")
    if not isinstance(result.get("summary"), str):
        result["summary"] = str(result.get("summary") or "")
    return result


@router.post("/message", response_model=MessageResponse)
async def send_message(req: MessageRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    conv = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not conv:
        status = await conv_dal.get_conversation_status(db, req.conversation_id)
        if status is not None:
            raise HTTPException(status_code=409, detail="Conversation is already ended")
        raise HTTPException(status_code=404, detail="Conversation not found")

    topics = get_conversation_topics()
    topic_data = next((t for t in topics if t["id"] == conv["topic"]), None)
    if topic_data is None:
        custom_topics = await conv_dal.list_custom_topics(db)
        topic_data = next((t for t in custom_topics if t["id"] == conv["topic"]), None)
    topic_label = topic_data["label"] if topic_data else conv["topic"]

    user_msg_id = await conv_dal.add_message(db, req.conversation_id, "user", req.content)

    history = await conv_dal.format_history_text(db, req.conversation_id, max_turns=MESSAGE_HISTORY_MAX_TURNS)

    copilot = get_copilot_service()

    # Prepare prompts
    grammar_prompt = get_prompt("grammar_checker").format(user_message=req.content)
    scenario = topic_data.get("scenario", topic_label) if topic_data else topic_label
    if conv.get("role_swap"):
        scenario = _swap_scenario_roles(scenario)
    system = get_prompt("conversation_partner").format(
        scenario=scenario,
        role=extract_role(scenario),
        goal=topic_data.get("goal", "Have a natural conversation") if topic_data else "Have a natural conversation",
    )
    # Append personality style if stored on the conversation
    personality = conv.get("personality") or "patient_teacher"
    if personality in PERSONALITY_INSTRUCTIONS:
        system += PERSONALITY_INSTRUCTIONS[personality]

    # Inject stored memory facts for continuity
    memory_raw = await pref_dal.get_preference(db, CONVERSATION_MEMORY_KEY)
    if memory_raw:
        try:
            memory_facts_msg: list[str] = json.loads(memory_raw)
            if isinstance(memory_facts_msg, list) and memory_facts_msg:
                system += (
                    "\n\nThings you know about this student from past conversations: "
                    + "; ".join(str(f) for f in memory_facts_msg[:10])
                    + ". Use these naturally when relevant — don't list them explicitly."
                )
        except (json.JSONDecodeError, TypeError):
            pass

    conv_prompt = f"Conversation so far:\n{history}\n\nContinue the scenario naturally. Stay in character and respond to what the user just said."

    # Run grammar check and conversation response in PARALLEL
    # Grammar check is non-fatal — if it fails, we still return the AI response
    t0 = time.monotonic()

    async def _safe_grammar_check():
        try:
            return await copilot.ask_json(
                "You are an English grammar and expression checker. Return ONLY valid JSON.",
                grammar_prompt,
                label="conversation_message",
            )
        except Exception as e:
            logger.warning("Grammar check failed (non-fatal): %s", e)
            return None

    try:
        feedback, ai_response = await asyncio.gather(
            _safe_grammar_check(),
            safe_llm_call(lambda: copilot.ask(system, conv_prompt, label="conversation_message"), context="send_message"),
        )
    except Exception:
        await conv_dal.delete_message(db, user_msg_id)
        raise
    logger.info("Parallel LLM calls completed (%.1fs)", time.monotonic() - t0)

    # Re-check conversation status after slow LLM calls (auto-end or manual end may have fired)
    still_active = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not still_active:
        await conv_dal.delete_message(db, user_msg_id)
        raise HTTPException(status_code=409, detail="Conversation ended while processing message")

    # Save feedback + AI response
    if feedback is not None:
        feedback = _normalize_grammar_feedback(feedback)
        await conv_dal.update_message_feedback(db, user_msg_id, feedback)
    await conv_dal.add_message(db, req.conversation_id, "assistant", ai_response)

    # Reply helpers (suggestions, key phrases, grammar notes) are fetched lazily
    # by the frontend via POST /api/conversation/helpers to reduce response latency.
    return {"message": ai_response, "feedback": feedback, "phrase_suggestions": [], "key_phrases": [], "grammar_notes": []}


@router.post("/helpers", response_model=HelpersResponse)
async def conversation_helpers(req: HelpersRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    """Generate reply helpers (suggestions, key phrases, grammar notes) for the latest
    assistant message in a conversation. Called lazily by the frontend after /start
    or /message so the user-visible AI reply is not blocked on this extra LLM call.

    Accepts conversations in any status (active or ended). Returns 404 if not found.
    On LLM failure, returns empty arrays (never 500).
    """
    # Try active first, then any status
    conv = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not conv:
        rows = await db.execute_fetchall(
            "SELECT * FROM conversations WHERE id = ?",
            (req.conversation_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Conversation not found")
        conv = dict(rows[0])

    history = await conv_dal.get_conversation_history(db, req.conversation_id)
    last_assistant = next(
        (m for m in reversed(history) if m.get("role") == "assistant"),
        None,
    )
    if not last_assistant:
        return {"phrase_suggestions": [], "key_phrases": [], "grammar_notes": []}

    # Resolve topic label (config or custom)
    topics = get_conversation_topics()
    topic_data = next((t for t in topics if t["id"] == conv["topic"]), None)
    if topic_data is None:
        custom_topics = await conv_dal.list_custom_topics(db)
        topic_data = next((t for t in custom_topics if t["id"] == conv["topic"]), None)
    topic_label = topic_data["label"] if topic_data else conv["topic"]
    difficulty = conv.get("difficulty", "intermediate")

    copilot = get_copilot_service()
    try:
        suggestions, key_phrases, grammar_notes = await _extract_reply_helpers(
            copilot, last_assistant["content"], topic_label, difficulty
        )
    except Exception as e:
        logger.warning("conversation_helpers failed (non-fatal): %s", e)
        return {"phrase_suggestions": [], "key_phrases": [], "grammar_notes": []}

    return {
        "phrase_suggestions": suggestions,
        "key_phrases": key_phrases,
        "grammar_notes": grammar_notes,
    }


@router.post("/end", response_model=EndResponse)
async def end_conversation(req: EndRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    status = await conv_dal.get_conversation_status(db, req.conversation_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if status != "active":
        raise HTTPException(status_code=409, detail="Conversation is already ended")

    new_facts: list[str] = []
    if req.skip_summary:
        summary = {
            "note": "Session ended without summary",
            "key_vocabulary": [],
            "communication_level": "unknown",
            "tip": "",
        }
    else:
        history_text = await conv_dal.format_history_text(db, req.conversation_id)
        copilot = get_copilot_service()
        summary_prompt = get_prompt("conversation_summary").format(conversation=history_text)
        extract_prompt = (
            f"From this English practice conversation, extract 2-3 personal facts about "
            f"the student (NOT the AI). Facts like: their job, hobbies, family, travel "
            f"plans, preferences, hometown, etc. Only include facts the student themselves "
            f"stated. If no personal facts were shared, return an empty array.\n\n"
            f"Conversation:\n{history_text}\n\n"
            f'Return JSON: {{"facts": ["fact1", "fact2"]}}'
        )

        async def _summary_task() -> dict:
            try:
                return await safe_llm_call(
                    lambda: copilot.ask_json(
                        "You are an English learning assistant. Return ONLY valid JSON.",
                        summary_prompt,
                        label="conversation_end",
                    ),
                    context="end_conversation",
                )
            except HTTPException:
                logger.warning("Summary generation failed for conversation %s; using fallback", req.conversation_id)
                return {
                    "note": "Summary could not be generated",
                    "key_vocabulary": [],
                    "communication_level": "unknown",
                    "tip": "",
                }

        async def _memory_task() -> list[str]:
            try:
                extracted = await copilot.ask_json(
                    "You are a fact extractor. Return ONLY valid JSON.",
                    extract_prompt,
                    label="conversation_end",
                )
                facts = extracted.get("facts", []) if isinstance(extracted, dict) else []
                if isinstance(facts, list) and facts:
                    return [str(f).strip() for f in facts if f and str(f).strip()][:3]
                return []
            except Exception as e:
                logger.warning("Memory extraction failed (non-fatal): %s", e)
                return []

        t0 = time.monotonic()
        summary, new_facts = await asyncio.gather(_summary_task(), _memory_task())
        logger.info("end_conversation parallel LLM calls completed (%.1fs)", time.monotonic() - t0)

    summary = _normalize_summary(summary)

    metrics = await conv_dal.get_conversation_metrics(db, req.conversation_id)
    summary["performance"] = metrics

    transitioned = await conv_dal.end_conversation(db, req.conversation_id, summary=summary)
    if not transitioned:
        raise HTTPException(status_code=409, detail="Conversation was already ended")

    # Merge extracted personal facts into cross-session memory (non-fatal)
    if new_facts:
        try:
            existing_raw = await pref_dal.get_preference(db, CONVERSATION_MEMORY_KEY)
            existing_facts: list[str] = []
            if existing_raw:
                try:
                    existing_facts = json.loads(existing_raw)
                    if not isinstance(existing_facts, list):
                        existing_facts = []
                except (json.JSONDecodeError, TypeError):
                    existing_facts = []
            # Deduplicate (case-insensitive) and cap at 10
            seen_lower = {f.lower() for f in existing_facts}
            for fact in new_facts:
                if fact.lower() not in seen_lower:
                    existing_facts.append(fact)
                    seen_lower.add(fact.lower())
            merged = existing_facts[-10:]  # keep most recent 10
            await pref_dal.set_preference(db, CONVERSATION_MEMORY_KEY, json.dumps(merged))
        except Exception as e:
            logger.warning("Memory persistence failed (non-fatal): %s", e)

    return {"summary": summary}


@router.get("/{conversation_id}/summary")
async def get_summary(conversation_id: int = Path(ge=1), db: aiosqlite.Connection = Depends(get_db_session)):
    """Retrieve a stored conversation summary."""
    summary = await conv_dal.get_conversation_summary(db, conversation_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="Summary not found")
    normalized = _normalize_summary(summary)
    if "performance" not in normalized:
        normalized["performance"] = await conv_dal.get_conversation_metrics(db, conversation_id)
    return {"summary": normalized}


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
    topics = get_conversation_topics() + await conv_dal.list_custom_topics(db)
    conversations = [
        {**c, "topic_id": c["topic"], "topic": get_topic_label(topics, c["topic"])} for c in conversations
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
    topics = get_conversation_topics() + await conv_dal.list_custom_topics(db)
    data["topic"] = get_topic_label(topics, data["topic"])
    return data


@router.get("/grammar-accuracy")
async def grammar_accuracy(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get grammar accuracy statistics across all conversations."""
    result = await conv_dal.get_grammar_accuracy(db)
    topics = get_conversation_topics() + await conv_dal.list_custom_topics(db)
    result["by_topic"] = [
        {**item, "topic": get_topic_label(topics, item["topic"])}
        for item in result["by_topic"]
    ]
    return result


@router.get("/topic-recommendations")
async def topic_recommendations(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get conversation topic recommendations based on practice history and grammar accuracy."""
    topics = get_conversation_topics()
    custom_topics = await conv_dal.list_custom_topics(db)
    all_topics = topics + custom_topics
    all_topic_keys = [t["id"] for t in all_topics]
    recs = await conv_dal.get_topic_recommendations(db, all_topic_keys)
    return [
        {**r, "topic_id": r["topic"], "topic": get_topic_label(all_topics, r["topic"])} for r in recs
    ]


class TopicMasteryItem(BaseModel):
    tier: str
    sessions: int
    avg_grammar: float
    highest_difficulty: str


@router.get("/topic-mastery")
async def get_topic_mastery(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get per-topic mastery tiers computed from ended conversation summaries."""
    mastery = await conv_dal.get_topic_mastery(db)
    return mastery


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
    topics = get_conversation_topics() + await conv_dal.list_custom_topics(db)
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
    topics = get_conversation_topics() + await conv_dal.list_custom_topics(db)
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


@router.get("/{conversation_id}/shadowing-phrases")
async def get_shadowing_phrases(
    conversation_id: int = Path(ge=1),
    limit: int = Query(6, ge=1, le=20),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Extract phrases suitable for shadowing practice from a conversation."""
    phrases = await conv_dal.get_shadowing_phrases(db, conversation_id, limit=limit)
    if phrases is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation_id": conversation_id, "phrases": phrases}


def _safe_quiz_index(value: Any) -> int | None:
    """Coerce an LLM-returned correct_index to int in range 0-3, or None."""
    if value is None:
        return None
    try:
        idx = int(value)
    except (ValueError, TypeError):
        return None
    if 0 <= idx <= 3:
        return idx
    return None


class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    correct_index: int = Field(ge=0, le=3)
    explanation: str


class QuizResponse(BaseModel):
    conversation_id: int
    questions: list[QuizQuestion]


@router.post("/{conversation_id}/quiz", response_model=QuizResponse)
async def generate_conversation_quiz(
    conversation_id: int = Path(ge=1),
    count: int = Query(default=4, ge=2, le=8),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Generate comprehension quiz questions from a completed conversation."""
    status = await conv_dal.get_conversation_status(db, conversation_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if status != "ended":
        raise HTTPException(status_code=400, detail="Conversation must be ended before generating a quiz")

    history = await conv_dal.format_history_text(db, conversation_id)
    summary = await conv_dal.get_conversation_summary(db, conversation_id)
    key_vocab = ", ".join(summary.get("key_vocabulary", [])) if summary else "N/A"

    quiz_prompt = get_prompt("conversation_quiz").format(
        conversation=history, vocabulary=key_vocab, count=count,
    )

    copilot = get_copilot_service()
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English quiz generator. Return ONLY valid JSON.",
                quiz_prompt,
            ),
            context="conversation_quiz",
        )
    except HTTPException:
        logger.warning("Quiz generation failed for conversation %s", conversation_id)
        raise HTTPException(status_code=502, detail="Quiz generation failed")

    questions = result.get("questions", [])
    validated: list[dict[str, Any]] = []
    for q in questions[:count]:
        if not isinstance(q, dict) or "question" not in q:
            continue
        opts = q.get("options")
        if not isinstance(opts, list) or len(opts) != 4:
            continue
        raw_idx = q.get("correct_index")
        if raw_idx is None:
            raw_idx = q.get("correct_answer")
        if raw_idx is None:
            raw_idx = q.get("answer_index")
        if raw_idx is None:
            raw_idx = q.get("answer")
        idx = _safe_quiz_index(raw_idx)
        if idx is None:
            continue
        validated.append({
            "question": str(q["question"]),
            "options": [str(o) for o in opts],
            "correct_index": idx,
            "explanation": str(q.get("explanation", "")),
        })

    if not validated:
        raise HTTPException(status_code=502, detail="Failed to generate valid quiz questions")

    return {"conversation_id": conversation_id, "questions": validated}


class DifficultyRecommendationStats(BaseModel):
    accuracy: float
    avg_words: float
    sessions_analyzed: int


class DifficultyRecommendationResponse(BaseModel):
    current_difficulty: str
    recommended_difficulty: str
    reason: str
    stats: DifficultyRecommendationStats


@router.get("/difficulty-recommendation", response_model=DifficultyRecommendationResponse)
async def difficulty_recommendation(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get a difficulty level recommendation based on recent performance."""
    return await conv_dal.get_difficulty_recommendation(db)


@router.get("/{conversation_id}/rephrase-sentences")
async def get_rephrase_sentences(
    conversation_id: int = Path(ge=1),
    limit: int = Query(5, ge=1, le=10),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Extract sentences suitable for rephrase practice from a conversation."""
    sentences = await conv_dal.get_rephrase_sentences(db, conversation_id, limit=limit)
    if sentences is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation_id": conversation_id, "sentences": sentences}


class RephraseEvaluateRequest(BaseModel):
    original: str = Field(min_length=1, max_length=500)
    user_rephrase: str = Field(min_length=1, max_length=500)


class RephraseEvaluateResponse(BaseModel):
    meaning_preserved: bool
    naturalness_score: float
    variety_score: float
    overall_score: float
    feedback: str


@router.post("/rephrase-evaluate", response_model=RephraseEvaluateResponse)
async def evaluate_rephrase(
    body: RephraseEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a user's rephrase of a sentence using LLM."""
    copilot = get_copilot_service()
    prompt = (
        f"Original sentence: \"{body.original}\"\n"
        f"User's rephrase: \"{body.user_rephrase}\"\n\n"
        "Evaluate the rephrase. Return JSON with:\n"
        "- meaning_preserved (bool): does the rephrase keep the same meaning?\n"
        "- naturalness_score (1-10): how natural does the rephrase sound?\n"
        "- variety_score (1-10): how different is it from the original (word choice, structure)?\n"
        "- overall_score (1-10): overall quality combining all factors\n"
        "- feedback (string): brief encouraging feedback (1-2 sentences)"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English teacher evaluating sentence rephrasing. Return ONLY valid JSON.",
                prompt,
            ),
            context="rephrase_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Rephrase evaluation failed")

    return {
        "meaning_preserved": bool(result.get("meaning_preserved", False)),
        "naturalness_score": min(10, max(1, float(result.get("naturalness_score", 5)))),
        "variety_score": min(10, max(1, float(result.get("variety_score", 5)))),
        "overall_score": min(10, max(1, float(result.get("overall_score", 5)))),
        "feedback": str(result.get("feedback", "")),
    }


class RetellEvaluateRequest(BaseModel):
    original_summary: str = Field(min_length=1, max_length=2000)
    user_retelling: str = Field(min_length=1, max_length=2000)


class RetellEvaluateResponse(BaseModel):
    content_coverage: float
    grammar_score: float
    fluency_score: float
    vocabulary_score: float
    overall_score: float
    feedback: str
    model_retelling: str


@router.post("/retelling/evaluate", response_model=RetellEvaluateResponse)
async def evaluate_retelling(
    body: RetellEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a user's spoken retelling of a conversation summary."""
    copilot = get_copilot_service()
    prompt = (
        f"Original conversation summary:\n\"{body.original_summary}\"\n\n"
        f"User's spoken retelling:\n\"{body.user_retelling}\"\n\n"
        "Evaluate the retelling. Return JSON with:\n"
        "- content_coverage (1-10): how well did the user cover the key events and topics?\n"
        "- grammar_score (1-10): grammatical accuracy of the retelling\n"
        "- fluency_score (1-10): how fluent and natural does it sound?\n"
        "- vocabulary_score (1-10): variety and appropriateness of vocabulary used\n"
        "- overall_score (1-10): overall quality combining all factors\n"
        "- feedback (string): brief encouraging feedback highlighting strengths and one area to improve (2-3 sentences)\n"
        "- model_retelling (string): provide a natural, fluent model retelling of the same conversation summary (3-5 sentences)"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English teacher evaluating spoken retelling exercises. Return ONLY valid JSON.",
                prompt,
            ),
            context="retelling_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Retelling evaluation failed")

    return {
        "content_coverage": min(10, max(1, float(result.get("content_coverage", 5)))),
        "grammar_score": min(10, max(1, float(result.get("grammar_score", 5)))),
        "fluency_score": min(10, max(1, float(result.get("fluency_score", 5)))),
        "vocabulary_score": min(10, max(1, float(result.get("vocabulary_score", 5)))),
        "overall_score": min(10, max(1, float(result.get("overall_score", 5)))),
        "feedback": str(result.get("feedback", "")),
        "model_retelling": str(result.get("model_retelling", "")),
    }


class SessionAveragesResponse(BaseModel):
    session_count: int
    avg_grammar_accuracy_rate: float
    avg_avg_words_per_message: float
    avg_vocabulary_diversity: float
    avg_total_user_messages: float


@router.get("/session-averages", response_model=SessionAveragesResponse)
async def get_session_averages(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get historical average performance metrics across past sessions."""
    return await conv_dal.get_historical_session_averages(db)


@router.get("/random-grammar-mistake")
async def random_grammar_mistake(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Return a random grammar mistake from the user's conversation history."""
    result = await conv_dal.get_random_grammar_mistake(db)
    if result is None:
        raise HTTPException(status_code=404, detail="No grammar mistakes found")
    return result


class TopicWarmupRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    difficulty: str = Field(default="intermediate")


class WarmupPhrase(BaseModel):
    phrase: str
    hint: str


class TopicWarmupResponse(BaseModel):
    topic: str
    topic_label: str
    difficulty: str
    phrases: list[WarmupPhrase]


@router.post("/topic-warmup", response_model=TopicWarmupResponse)
async def get_topic_warmup(
    req: TopicWarmupRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Generate warm-up phrases for a conversation topic."""
    topics = get_conversation_topics() + await conv_dal.list_custom_topics(db)
    valid_ids = {t["id"] for t in topics}
    if req.topic not in valid_ids:
        raise HTTPException(status_code=404, detail=f"Topic '{req.topic}' not found")

    label = get_topic_label(topics, req.topic)
    copilot = get_copilot_service()

    system = (
        "You are an English tutor. Generate exactly 4 key phrases a learner "
        f"would need for a {label} scenario at {req.difficulty} level. "
        "Return JSON: {\"phrases\": [{\"phrase\": \"...\", \"hint\": \"...\"}]}. "
        "Each hint is a short context note (e.g., 'when arriving'). "
        "Phrases should be practical and commonly used."
    )

    result = await safe_llm_call(
        lambda: copilot.ask_json(system, f"Generate warm-up phrases for: {label}"),
        context="topic_warmup",
    )
    if not result or "phrases" not in result:
        raise HTTPException(status_code=502, detail="Failed to generate warm-up phrases")

    phrases = [
        WarmupPhrase(phrase=p["phrase"], hint=p.get("hint", ""))
        for p in result["phrases"][:4]
    ]

    return TopicWarmupResponse(
        topic=req.topic,
        topic_label=label,
        difficulty=req.difficulty,
        phrases=phrases,
    )


@router.get("/{conversation_id}/topic-progress")
async def get_topic_progress(
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get performance comparison with the previous conversation on the same topic."""
    result = await conv_dal.get_topic_progress(db, conversation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found or no performance data")
    return result


# ---------------------------------------------------------------------------
# Conversation hint — directional guidance for stuck learners
# ---------------------------------------------------------------------------

class ConversationHintResponse(BaseModel):
    hint: str


@router.post("/{conversation_id}/hint", response_model=ConversationHintResponse)
async def get_conversation_hint(
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Generate a directional hint for a stuck learner during an active conversation."""
    conv = await conv_dal.get_active_conversation(db, conversation_id)
    if not conv:
        status = await conv_dal.get_conversation_status(db, conversation_id)
        if status is not None:
            raise HTTPException(status_code=409, detail="Conversation is already ended")
        raise HTTPException(status_code=404, detail="Conversation not found")

    topics = get_conversation_topics()
    topic_data = next((t for t in topics if t["id"] == conv["topic"]), None)
    if topic_data is None:
        custom_topics = await conv_dal.list_custom_topics(db)
        topic_data = next((t for t in custom_topics if t["id"] == conv["topic"]), None)
    topic_label = topic_data["label"] if topic_data else conv["topic"]

    history = await conv_dal.format_history_text(db, conversation_id)
    if not history.strip():
        return ConversationHintResponse(hint="Try introducing yourself or asking a question to get started!")

    copilot = get_copilot_service()

    system_prompt = (
        "You are an English conversation coach. The learner is stuck and needs a "
        "brief directional hint about WHAT to say next — NOT the actual reply. "
        "Give guidance like 'Try asking about the room price' or 'You could mention "
        "your symptoms'. Keep it to one short sentence. Do NOT provide a ready-made "
        "reply the learner can copy."
    )
    user_prompt = (
        f"Scenario: {topic_label} (difficulty: {conv.get('difficulty', 'intermediate')})\n\n"
        f"Conversation so far:\n{history}\n\n"
        "The learner is stuck. Give a brief hint about what they could say next."
    )

    try:
        hint_text = await safe_llm_call(
            lambda: copilot.ask(system_prompt, user_prompt),
            context="conversation_hint",
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to generate hint")

    # Clean up the hint text — remove quotes or surrounding whitespace
    hint_text = hint_text.strip().strip('"').strip("'")
    if not hint_text:
        hint_text = "Try asking a follow-up question about what was just said."

    return ConversationHintResponse(hint=hint_text)


# ---------------------------------------------------------------------------
# Save conversation vocabulary to SRS bank
# ---------------------------------------------------------------------------

class SaveVocabularyRequest(BaseModel):
    words: list[str] = Field(min_length=1, max_length=50)


class SavedWordItem(BaseModel):
    word: str
    meaning: str


class SaveVocabularyResponse(BaseModel):
    saved_count: int
    words: list[SavedWordItem]


@router.post("/{conversation_id}/save-vocabulary", response_model=SaveVocabularyResponse)
async def save_conversation_vocabulary(
    req: SaveVocabularyRequest,
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Save key vocabulary from a conversation to the SRS vocabulary bank."""
    # Verify conversation exists
    exists = await conv_dal.conversation_exists(db, conversation_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Load conversation history for context
    history = await conv_dal.format_history_text(db, conversation_id)

    # Deduplicate and clean words
    seen: set[str] = set()
    unique_words: list[str] = []
    for w in req.words:
        w_clean = w.strip()
        if w_clean and w_clean.lower() not in seen:
            seen.add(w_clean.lower())
            unique_words.append(w_clean)

    if not unique_words:
        raise HTTPException(status_code=400, detail="No valid words provided")

    # Use LLM to generate definitions and examples based on conversation context
    copilot = get_copilot_service()
    words_list = ", ".join(unique_words)
    prompt = (
        f"Given this English conversation:\n{history}\n\n"
        f"For each of these vocabulary words/phrases: [{words_list}]\n\n"
        "Provide a definition and an example sentence for each, based on how "
        "they were used in the conversation above.\n\n"
        "Return JSON: {\"words\": [{\"word\": \"...\", \"meaning\": \"...\", "
        "\"example_sentence\": \"...\"}]}"
    )
    try:
        result = await copilot.ask_json(
            "You are an English vocabulary assistant. Return ONLY valid JSON.",
            prompt,
        )
        llm_words = result.get("words") or result.get("items") or []
    except Exception as e:
        logger.warning("LLM vocab generation failed for conversation %s: %s", conversation_id, e)
        # Fallback: save words with basic definitions
        llm_words = [{"word": w, "meaning": f"Vocabulary from conversation", "example_sentence": ""} for w in unique_words]

    # Build questions list for save_words (matches expected format)
    questions: list[dict[str, Any]] = []
    for w in unique_words:
        w_lower = w.lower()
        # Find matching LLM entry
        llm_entry = next(
            (lw for lw in llm_words if isinstance(lw, dict) and (lw.get("word") or "").lower() == w_lower),
            None,
        )
        questions.append({
            "word": w,
            "meaning": (llm_entry or {}).get("meaning") or f"Vocabulary from conversation",
            "example_sentence": (llm_entry or {}).get("example_sentence") or "",
            "difficulty": 1,
        })

    # Save via vocab DAL with topic 'conversation'
    saved = await vocab_dal.save_words(db, "conversation", questions)

    # Initialize SRS progress for each saved word
    for word_entry in saved:
        word_id = word_entry["id"]
        # Check if progress already exists
        progress_rows = await db.execute_fetchall(
            "SELECT word_id FROM vocabulary_progress WHERE word_id = ?", (word_id,)
        )
        if not progress_rows:
            await db.execute(
                """INSERT INTO vocabulary_progress
                   (word_id, correct_count, incorrect_count, level, last_reviewed, next_review_at)
                   VALUES (?, 0, 0, 0, NULL, datetime('now'))""",
                (word_id,),
            )
    await db.commit()

    return SaveVocabularyResponse(
        saved_count=len(saved),
        words=[SavedWordItem(word=s["word"], meaning=s["meaning"]) for s in saved],
    )


# ---------------------------------------------------------------------------
# Self-Assessment reflection card
# ---------------------------------------------------------------------------

class SelfAssessmentRequest(BaseModel):
    confidence_rating: int = Field(ge=1, le=5)
    fluency_rating: int = Field(ge=1, le=5)
    comprehension_rating: int = Field(ge=1, le=5)


class SelfAssessmentResponse(BaseModel):
    conversation_id: int
    confidence_rating: int
    fluency_rating: int
    comprehension_rating: int
    created_at: str | None = None


@router.post("/{conversation_id}/self-assessment", response_model=SelfAssessmentResponse)
async def save_self_assessment(
    req: SelfAssessmentRequest,
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Save or update a self-assessment for a conversation."""
    exists = await conv_dal.conversation_exists(db, conversation_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Conversation not found")

    result = await conv_dal.save_self_assessment(
        db, conversation_id, req.confidence_rating, req.fluency_rating, req.comprehension_rating
    )
    return SelfAssessmentResponse(**result)


@router.get("/{conversation_id}/self-assessment", response_model=SelfAssessmentResponse)
async def get_self_assessment(
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Retrieve a self-assessment for a conversation."""
    exists = await conv_dal.conversation_exists(db, conversation_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Conversation not found")

    assessment = await conv_dal.get_self_assessment(db, conversation_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Self-assessment not found")

    return SelfAssessmentResponse(**assessment)


# ---------------------------------------------------------------------------
# Express It Better drill
# ---------------------------------------------------------------------------


class ExpressBetterPair(BaseModel):
    original: str
    upgraded: str
    explanation: str


class ExpressBetterResponse(BaseModel):
    conversation_id: int
    pairs: list[ExpressBetterPair]


@router.post("/{conversation_id}/express-better", response_model=ExpressBetterResponse)
async def get_express_better(
    conversation_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Generate upgraded versions of user messages showing how a fluent speaker would express them."""
    status = await conv_dal.get_conversation_status(db, conversation_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if status != "ended":
        raise HTTPException(status_code=400, detail="Conversation must be ended first")

    user_messages = await conv_dal.get_user_messages(db, conversation_id, limit=4)
    if not user_messages:
        return ExpressBetterResponse(conversation_id=conversation_id, pairs=[])

    numbered = "\n".join(f"{i+1}. \"{m}\"" for i, m in enumerate(user_messages))
    prompt = (
        "A language learner wrote these messages during a conversation:\n"
        f"{numbered}\n\n"
        "For each message, show how a fluent English speaker would express the same idea "
        "more naturally and with richer vocabulary. Provide:\n"
        "- original: the learner's exact message\n"
        "- upgraded: a more natural/advanced version\n"
        "- explanation: brief note (1-2 sentences) on what changed and why it sounds better\n\n"
        'Return JSON: {"pairs": [{"original": "...", "upgraded": "...", "explanation": "..."}]}'
    )

    copilot = get_copilot_service()
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English fluency coach. Return ONLY valid JSON.",
                prompt,
            ),
            context="express_better",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Express It Better generation failed")

    raw_pairs = result.get("pairs", [])
    pairs: list[dict[str, str]] = []
    for p in raw_pairs:
        if not isinstance(p, dict):
            continue
        original = str(p.get("original", "")).strip()
        upgraded = str(p.get("upgraded", "")).strip()
        explanation = str(p.get("explanation", "")).strip()
        if original and upgraded:
            pairs.append({"original": original, "upgraded": upgraded, "explanation": explanation})

    return ExpressBetterResponse(conversation_id=conversation_id, pairs=pairs)
