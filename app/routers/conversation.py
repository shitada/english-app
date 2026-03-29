"""Conversation API endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import time

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import get_conversation_topics, get_prompt
from app.copilot_client import get_copilot_service
from app.dal import conversation as conv_dal
from app.database import get_db_session
from app.utils import get_topic_label

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversation", tags=["conversation"])


class StartRequest(BaseModel):
    topic: str = Field(min_length=1)


class MessageRequest(BaseModel):
    conversation_id: int = Field(ge=1)
    content: str = Field(min_length=1)


class EndRequest(BaseModel):
    conversation_id: int = Field(ge=1)


@router.get("/topics")
async def list_topics():
    return get_conversation_topics()


@router.post("/start")
async def start_conversation(req: StartRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    topics = get_conversation_topics()
    topic_data = next((t for t in topics if t["id"] == req.topic), None)
    topic_label = topic_data["label"] if topic_data else req.topic

    conversation_id = await conv_dal.create_conversation(db, req.topic)

    copilot = get_copilot_service()
    system = get_prompt("conversation_partner").format(
        scenario=topic_data.get("scenario", topic_label) if topic_data else topic_label,
        role=topic_data.get("scenario", "a conversation partner") if topic_data else "a conversation partner",
        goal=topic_data.get("goal", "Have a natural conversation") if topic_data else "Have a natural conversation",
    )
    opening = await copilot.ask(system, "Start the scenario. Greet the user in character.")

    await conv_dal.add_message(db, conversation_id, "assistant", opening)

    return {
        "conversation_id": conversation_id,
        "message": opening,
        "topic": req.topic,
    }


@router.post("/message")
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
    feedback, ai_response = await asyncio.gather(
        copilot.ask_json(
            "You are an English grammar and expression checker. Return ONLY valid JSON.",
            grammar_prompt,
        ),
        copilot.ask(system, conv_prompt),
    )
    logger.info("Parallel LLM calls completed (%.1fs)", time.monotonic() - t0)

    # Save feedback + AI response
    await conv_dal.update_message_feedback(db, req.conversation_id, "user", req.content, feedback)
    await conv_dal.add_message(db, req.conversation_id, "assistant", ai_response)

    return {"message": ai_response, "feedback": feedback}


@router.post("/end")
async def end_conversation(req: EndRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    conv = await conv_dal.get_active_conversation(db, req.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    history = await conv_dal.format_history_text(db, req.conversation_id)

    copilot = get_copilot_service()
    summary_prompt = get_prompt("conversation_summary").format(conversation=history)
    summary = await copilot.ask_json(
        "You are an English learning assistant. Return ONLY valid JSON.",
        summary_prompt,
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
