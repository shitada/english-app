"""Conversation API endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import get_conversation_topics, get_prompt
from app.copilot_client import get_copilot_service
from app.dal import conversation as conv_dal
from app.database import get_db_session
from app.utils import get_topic_label, safe_llm_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversation", tags=["conversation"])


class StartRequest(BaseModel):
    topic: str = Field(min_length=1)
    difficulty: Literal["beginner", "intermediate", "advanced"] = "intermediate"


class MessageRequest(BaseModel):
    conversation_id: int = Field(ge=1)
    content: str = Field(min_length=1)


class EndRequest(BaseModel):
    conversation_id: int = Field(ge=1)


class StartResponse(BaseModel):
    conversation_id: int
    message: str
    topic: str


class MessageResponse(BaseModel):
    message: str
    feedback: dict[str, Any]


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


class ConversationListResponse(BaseModel):
    conversations: list[ConversationListItem]


@router.get("/topics")
async def list_topics():
    return get_conversation_topics()


@router.post("/start", response_model=StartResponse)
async def start_conversation(req: StartRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    topics = get_conversation_topics()
    topic_data = next((t for t in topics if t["id"] == req.topic), None)
    topic_label = topic_data["label"] if topic_data else req.topic

    conversation_id = await conv_dal.create_conversation(db, req.topic, req.difficulty)

    copilot = get_copilot_service()

    difficulty_instructions = {
        "beginner": "\nIMPORTANT: Use simple vocabulary and short sentences (5-8 words). Speak slowly and clearly. If the user makes mistakes, gently correct them with the right phrase. Avoid idioms and complex grammar.",
        "intermediate": "\nUse natural conversational English. Mix simple and moderate vocabulary. Correct significant grammar errors but keep the conversation flowing.",
        "advanced": "\nUse natural, fluent English including idioms, phrasal verbs, and complex sentence structures. Challenge the user with nuanced vocabulary. Only correct subtle errors. Discuss topics in depth.",
    }

    system = get_prompt("conversation_partner").format(
        scenario=topic_data.get("scenario", topic_label) if topic_data else topic_label,
        role=topic_data.get("scenario", "a conversation partner") if topic_data else "a conversation partner",
        goal=topic_data.get("goal", "Have a natural conversation") if topic_data else "Have a natural conversation",
    ) + difficulty_instructions[req.difficulty]
    opening = await safe_llm_call(
        copilot.ask(system, "Start the scenario. Greet the user in character."),
        context="start_conversation",
    )

    await conv_dal.add_message(db, conversation_id, "assistant", opening)

    return {
        "conversation_id": conversation_id,
        "message": opening,
        "topic": req.topic,
    }


@router.post("/message", response_model=MessageResponse)
async def send_message(req: MessageRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    conv = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or already ended")

    topics = get_conversation_topics()
    topic_data = next((t for t in topics if t["id"] == conv["topic"]), None)
    topic_label = topic_data["label"] if topic_data else conv["topic"]

    await conv_dal.add_message(db, req.conversation_id, "user", req.content)

    history = await conv_dal.format_history_text(db, req.conversation_id)

    copilot = get_copilot_service()

    # Prepare prompts
    grammar_prompt = get_prompt("grammar_checker").format(user_message=req.content)
    system = get_prompt("conversation_partner").format(
        scenario=topic_data.get("scenario", topic_label) if topic_data else topic_label,
        role=topic_data.get("scenario", "a conversation partner") if topic_data else "a conversation partner",
        goal=topic_data.get("goal", "Have a natural conversation") if topic_data else "Have a natural conversation",
    )
    conv_prompt = f"Conversation so far:\n{history}\n\nContinue the scenario naturally. Stay in character and respond to what the user just said."

    # Run grammar check and conversation response in PARALLEL
    t0 = time.monotonic()
    feedback, ai_response = await safe_llm_call(
        asyncio.gather(
            copilot.ask_json(
                "You are an English grammar and expression checker. Return ONLY valid JSON.",
                grammar_prompt,
            ),
            copilot.ask(system, conv_prompt),
        ),
        context="send_message",
    )
    logger.info("Parallel LLM calls completed (%.1fs)", time.monotonic() - t0)

    # Save feedback + AI response
    await conv_dal.update_message_feedback(db, req.conversation_id, "user", req.content, feedback)
    await conv_dal.add_message(db, req.conversation_id, "assistant", ai_response)

    return {"message": ai_response, "feedback": feedback}


@router.post("/end", response_model=EndResponse)
async def end_conversation(req: EndRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    conv = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    history = await conv_dal.format_history_text(db, req.conversation_id)

    copilot = get_copilot_service()
    summary_prompt = get_prompt("conversation_summary").format(conversation=history)
    summary = await safe_llm_call(
        copilot.ask_json(
            "You are an English learning assistant. Return ONLY valid JSON.",
            summary_prompt,
        ),
        context="end_conversation",
    )

    await conv_dal.end_conversation(db, req.conversation_id)

    return {"summary": summary}


@router.get("/{conversation_id}/history")
async def get_history(conversation_id: int, db: aiosqlite.Connection = Depends(get_db_session)):
    rows = await conv_dal.get_conversation_history(db, conversation_id)
    messages = []
    for r in rows:
        msg = {"role": r["role"], "content": r["content"], "created_at": r["created_at"]}
        if r["feedback_json"]:
            msg["feedback"] = json.loads(r["feedback_json"])
        messages.append(msg)
    return {"messages": messages}


@router.get("/list", response_model=ConversationListResponse)
async def list_conversations(
    topic: str | None = None,
    limit: int = 20,
    offset: int = 0,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """List past conversations with message counts."""
    conversations = await conv_dal.list_conversations(db, topic=topic, limit=limit, offset=offset)
    return {"conversations": conversations}
