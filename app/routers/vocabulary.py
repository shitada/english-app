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
from app.utils import get_topic_label, safe_llm_call, validate_topic

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


class WordBankItem(BaseModel):
    id: int
    word: str
    meaning: str
    example_sentence: str
    topic: str
    difficulty: int


class WordBankResponse(BaseModel):
    total_count: int
    words: list[WordBankItem]


@router.get("/topics")
async def list_topics():
    return get_vocabulary_topics()


@router.get("/words", response_model=WordBankResponse)
async def browse_words(
    q: str | None = None,
    topic: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Browse and search saved vocabulary words."""
    total, words = await vocab_dal.search_words(db, q, topic, limit, offset)
    return {"total_count": total, "words": words}


@router.get("/quiz")
async def generate_quiz(
    topic: str,
    count: int = Query(default=10, ge=1, le=50),
    mode: str = Query(default="multiple_choice", pattern="^(multiple_choice|fill_blank)$"),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    validate_topic(get_vocabulary_topics(), topic)
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
            return {"quiz_type": "fill_blank", "questions": vocab_dal.build_fill_blank_quiz(words)}
        all_meanings = [r["meaning"] for r in existing]
        return {"quiz_type": "multiple_choice", "questions": vocab_dal.build_quiz(words, all_meanings)}

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
        return {"quiz_type": "fill_blank", "questions": vocab_dal.build_fill_blank_quiz(words)}
    return {"quiz_type": "multiple_choice", "questions": words}


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


class DeleteWordResponse(BaseModel):
    deleted: bool


@router.delete("/{word_id}", response_model=DeleteWordResponse)
async def delete_word(
    word_id: int,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Delete a vocabulary word and its progress."""
    deleted = await vocab_dal.delete_word(db, word_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Word not found")
    return {"deleted": True}


class UpdateWordRequest(BaseModel):
    meaning: str | None = Field(default=None, max_length=500)
    example_sentence: str | None = Field(default=None, max_length=500)
    difficulty: int | None = Field(default=None, ge=1, le=5)


class UpdateWordResponse(BaseModel):
    id: int
    topic: str
    word: str
    meaning: str
    example_sentence: str
    difficulty: int


@router.put("/{word_id}", response_model=UpdateWordResponse)
async def update_word(
    word_id: int,
    req: UpdateWordRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Update a vocabulary word's meaning, example, or difficulty."""
    result = await vocab_dal.update_word(
        db, word_id,
        meaning=req.meaning,
        example_sentence=req.example_sentence,
        difficulty=req.difficulty,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Word not found")
    return result


class ExportWordItem(BaseModel):
    id: int
    word: str
    meaning: str
    example_sentence: str
    topic: str
    difficulty: int
    correct_count: int
    incorrect_count: int
    level: int
    last_reviewed: str | None
    next_review_at: str | None


class ExportResponse(BaseModel):
    words: list[ExportWordItem]
    total_count: int


@router.get("/export", response_model=ExportResponse)
async def export_words(
    topic: str | None = None,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Export vocabulary words with progress data."""
    words = await vocab_dal.export_words(db, topic)
    return {"words": words, "total_count": len(words)}


class TopicSummaryItem(BaseModel):
    topic: str
    total_words: int
    reviewed_words: int
    mastered_words: int
    avg_level: float


class TopicSummaryResponse(BaseModel):
    topics: list[TopicSummaryItem]


@router.get("/topic-summary", response_model=TopicSummaryResponse)
async def get_topic_summary(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get per-topic vocabulary progress summary."""
    topics = await vocab_dal.get_topic_summary(db)
    return {"topics": topics}


class ForecastDayItem(BaseModel):
    date: str
    count: int


class ReviewForecastResponse(BaseModel):
    overdue_count: int
    total_upcoming: int
    daily_forecast: list[ForecastDayItem]


@router.get("/forecast", response_model=ReviewForecastResponse)
async def get_review_forecast(
    days: int = Query(default=14, ge=1, le=90),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get vocabulary review workload forecast for the next N days."""
    return await vocab_dal.get_review_forecast(db, days=days)


class AttemptItem(BaseModel):
    id: int
    word_id: int
    word: str
    topic: str
    is_correct: bool
    answered_at: str


class AttemptHistoryResponse(BaseModel):
    total_count: int
    attempts: list[AttemptItem]


@router.get("/attempts", response_model=AttemptHistoryResponse)
async def get_attempt_history(
    word_id: int | None = None,
    topic: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = 0,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get vocabulary quiz attempt history with optional filters."""
    return await vocab_dal.get_attempt_history(
        db, word_id=word_id, topic=topic, limit=limit, offset=offset
    )


class TopicAccuracyItem(BaseModel):
    topic: str
    correct_count: int
    incorrect_count: int
    total_attempts: int
    accuracy_rate: float


class TopicAccuracyResponse(BaseModel):
    topics: list[TopicAccuracyItem]


@router.get("/topic-accuracy", response_model=TopicAccuracyResponse)
async def get_topic_accuracy(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get per-topic vocabulary quiz accuracy rates."""
    topics = await vocab_dal.get_topic_accuracy(db)
    return {"topics": topics}


class WordImportItem(BaseModel):
    word: str = Field(min_length=1, max_length=100)
    meaning: str = Field(min_length=1, max_length=500)
    example_sentence: str = Field(default="", max_length=500)
    topic: str = Field(min_length=1)
    difficulty: int = Field(default=1, ge=1, le=5)


class BatchImportRequest(BaseModel):
    words: list[WordImportItem] = Field(min_length=1, max_length=100)


class BatchImportResponse(BaseModel):
    imported_count: int
    skipped_count: int
    words: list[dict]


@router.post("/import", response_model=BatchImportResponse)
async def batch_import(
    req: BatchImportRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Import a batch of vocabulary words."""
    words_data = [w.model_dump() for w in req.words]
    return await vocab_dal.batch_import_words(db, words_data)


class ToggleFavoriteResponse(BaseModel):
    word_id: int
    is_favorite: bool


@router.post("/{word_id}/favorite", response_model=ToggleFavoriteResponse)
async def toggle_favorite(
    word_id: int,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Toggle a word's favorite status."""
    result = await vocab_dal.toggle_favorite(db, word_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Word not found")
    return result


class FavoriteWordItem(BaseModel):
    id: int
    topic: str
    word: str
    meaning: str
    example_sentence: str | None
    difficulty: int


class FavoritesResponse(BaseModel):
    total_count: int
    words: list[FavoriteWordItem]


@router.get("/favorites", response_model=FavoritesResponse)
async def get_favorites(
    topic: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = 0,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get favorited vocabulary words."""
    return await vocab_dal.get_favorites(db, topic=topic, limit=limit, offset=offset)


class UpdateNotesRequest(BaseModel):
    notes: str | None = None


@router.put("/{word_id}/notes")
async def update_notes(
    word_id: int,
    req: UpdateNotesRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Update or clear notes for a vocabulary word."""
    updated = await vocab_dal.update_notes(db, word_id, req.notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Word not found")
    word = await vocab_dal.get_word_with_notes(db, word_id)
    return word


@router.get("/{word_id}/detail")
async def get_word_detail(
    word_id: int,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get full word detail including progress, notes, and similar words."""
    detail = await vocab_dal.get_word_detail(db, word_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Word not found")
    return detail
