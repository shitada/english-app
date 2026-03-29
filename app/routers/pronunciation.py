"""Pronunciation check API endpoints."""

from __future__ import annotations

import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import get_prompt
from app.copilot_client import get_copilot_service
from app.dal import pronunciation as pron_dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pronunciation", tags=["pronunciation"])


class CheckRequest(BaseModel):
    reference_text: str = Field(min_length=1)
    user_transcription: str = Field(min_length=1)


@router.get("/sentences")
async def get_sentences(db: aiosqlite.Connection = Depends(get_db_session)):
    sentences = await pron_dal.get_sentences_from_conversations(db)
    return {"sentences": sentences}


@router.post("/check")
async def check_pronunciation(req: CheckRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    copilot = get_copilot_service()

    prompt = get_prompt("pronunciation_checker").format(
        reference_text=req.reference_text,
        user_transcription=req.user_transcription,
    )
    try:
        feedback = await copilot.ask_json(
            "You are an English pronunciation coach. Return ONLY valid JSON.",
            prompt,
        )
    except Exception as e:
        logger.error("LLM error in check_pronunciation: %s", e)
        raise HTTPException(status_code=502, detail="AI service temporarily unavailable")

    await pron_dal.save_attempt(
        db, req.reference_text, req.user_transcription, feedback, feedback.get("overall_score", 0),
    )

    return feedback


@router.get("/history")
async def get_pronunciation_history(db: aiosqlite.Connection = Depends(get_db_session)):
    attempts = await pron_dal.get_history(db)
    return {"attempts": attempts}
