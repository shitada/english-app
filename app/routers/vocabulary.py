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
from app.rate_limit import require_rate_limit
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


class FillBlankQuestionItem(BaseModel):
    id: int
    meaning: str
    example_with_blank: str
    hint: str
    answer: str
    difficulty: int


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


class LevelCount(BaseModel):
    level: int
    count: int


class TopicBreakdown(BaseModel):
    topic: str
    word_count: int
    mastered_count: int
    avg_level: float


class VocabularyStatsResponse(BaseModel):
    total_words: int
    total_mastered: int
    total_reviews: int
    accuracy_rate: float
    level_distribution: list[LevelCount]
    topic_breakdown: list[TopicBreakdown]


class DueWordItem(BaseModel):
    id: int
    word: str
    meaning: str
    topic: str
    level: int
    next_review_at: str


class DueWordsResponse(BaseModel):
    due_count: int
    words: list[DueWordItem]


class ResetProgressResponse(BaseModel):
    deleted_count: int


class WeakWordItem(BaseModel):
    id: int
    word: str
    meaning: str
    topic: str
    correct_count: int
    incorrect_count: int
    level: int
    error_rate: float


class WeakWordsResponse(BaseModel):
    words: list[WeakWordItem]


@router.get("/topics")
async def list_topics():
    return get_vocabulary_topics()


@router.get("/quiz")
async def generate_quiz(
    topic: str,
    count: int = Query(default=10, ge=1, le=50),
    mode: str = Query(default="multiple_choice", pattern="^(multiple_choice|fill_blank)$"),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
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
        if mode == "fill_blank":
            return {"questions": vocab_dal.build_fill_blank_quiz(words)}
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
    if mode == "fill_blank":
        return {"questions": vocab_dal.build_fill_blank_quiz(words)}
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


@router.get("/due", response_model=DueWordsResponse)
async def get_due_words(
    topic: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get vocabulary words that are due for review."""
    words = await vocab_dal.get_due_words(db, topic, limit)
    return {"due_count": len(words), "words": words}


@router.get("/stats", response_model=VocabularyStatsResponse)
async def get_vocabulary_stats(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get aggregate vocabulary mastery statistics."""
    return await vocab_dal.get_vocabulary_stats(db)


@router.delete("/progress", response_model=ResetProgressResponse)
async def reset_progress(
    topic: str | None = None,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Reset vocabulary progress, optionally filtered by topic."""
    deleted = await vocab_dal.reset_progress(db, topic)
    return {"deleted_count": deleted}


@router.get("/weak-words", response_model=WeakWordsResponse)
async def get_weak_words(
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get vocabulary words with highest error rates."""
    words = await vocab_dal.get_weak_words(db, limit)
    return {"words": words}
