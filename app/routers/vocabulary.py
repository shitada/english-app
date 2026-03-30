"""Vocabulary quiz API endpoints."""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.config import get_vocabulary_topics, get_prompt
from app.copilot_client import get_copilot_service
from app.dal import vocabulary as vocab_dal
from app.database import get_db_session
from app.utils import get_topic_label, safe_llm_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vocabulary", tags=["vocabulary"])


class AnswerRequest(BaseModel):
    word_id: int = Field(ge=1)
    is_correct: bool


class QuizQuestionItem(BaseModel):
    id: int
    word: str
    meaning: str
    example_sentence: str
    difficulty: int
    wrong_options: list[str]


class QuizResponse(BaseModel):
    questions: list[QuizQuestionItem]


class AnswerResponse(BaseModel):
    word_id: int
    is_correct: bool
    new_level: int
    next_review: str


class ProgressItem(BaseModel):
    word: str
    topic: str
    correct_count: int
    incorrect_count: int
    level: int
    last_reviewed: str
    next_review_at: str


class ProgressResponse(BaseModel):
    progress: list[ProgressItem]


@router.get("/topics")
async def list_topics():
    return get_vocabulary_topics()


@router.get("/quiz")
async def generate_quiz(
    topic: str,
    count: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    existing = await vocab_dal.get_words_by_topic(db, topic)

    if len(existing) >= count:
        due_ids = await vocab_dal.get_due_word_ids(db, topic, count)
        words = []
        for r in existing:
            if r["id"] in due_ids:
                words.insert(0, r)
            else:
                words.append(r)
        words = words[:count]
        all_meanings = [r["meaning"] for r in existing]
        return {"questions": vocab_dal.build_quiz(words, all_meanings)}

    # Generate new words via LLM
    topic_label = get_topic_label(get_vocabulary_topics(), topic)
    copilot = get_copilot_service()
    prompt = get_prompt("vocabulary_quiz_generator").format(topic=topic_label, count=count)
    result = await safe_llm_call(
        copilot.ask_json(
            "You are an English vocabulary teacher. Return ONLY valid JSON.",
            prompt,
        ),
        context="generate_quiz",
    )

    words = await vocab_dal.save_words(db, topic, result.get("questions", []))
    return {"questions": words}


@router.post("/answer", response_model=AnswerResponse)
async def submit_answer(
    req: AnswerRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    word = await vocab_dal.get_word(db, req.word_id)
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")

    result = await vocab_dal.update_progress(db, req.word_id, req.is_correct)
    return result


@router.get("/progress", response_model=ProgressResponse)
async def get_progress(
    topic: str | None = None,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    progress = await vocab_dal.get_progress(db, topic)
    return {"progress": progress}
