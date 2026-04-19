"""Vocabulary quiz API endpoints."""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Path, Query
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


class DifficultyAdjustment(BaseModel):
    word_id: int
    old_difficulty: int
    new_difficulty: int
    reason: str


class AnswerResponse(BaseModel):
    word_id: int
    is_correct: bool
    new_level: int
    next_review: str
    difficulty_adjustment: DifficultyAdjustment | None = None


class ProgressItem(BaseModel):
    word: str
    topic: str
    correct_count: int
    incorrect_count: int
    level: int
    last_reviewed: str | None = None
    next_review_at: str | None = None


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
    next_review_at: str | None = None


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
    q: str | None = Query(default=None, max_length=200),
    topic: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Browse and search saved vocabulary words."""
    total, words = await vocab_dal.search_words(db, q, topic, limit, offset)
    vocab_topics = get_vocabulary_topics()
    words = [{**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in words]
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
        lambda: copilot.ask_json(
            "You are an English vocabulary teacher. Return ONLY valid JSON.",
            prompt,
        ),
        context="generate_quiz",
    )

    raw_questions = result.get("questions") or result.get("items") or []
    if not isinstance(raw_questions, list):
        raw_questions = []
    words = await vocab_dal.save_words(db, topic, raw_questions)

    # Supplement with existing topic words if LLM produced fewer than requested
    all_words = await vocab_dal.get_words_by_topic(db, topic)
    if len(words) < count:
        word_ids = {w["id"] for w in words}
        for w in all_words:
            if w["id"] not in word_ids:
                words.append(w)
            if len(words) >= count:
                break
    words = words[:count]

    if mode == "fill_blank":
        return {"quiz_type": "fill_blank", "questions": vocab_dal.build_fill_blank_quiz(words)}
    all_meanings = [r["meaning"] for r in all_words]
    return {"quiz_type": "multiple_choice", "questions": vocab_dal.build_quiz(words, all_meanings)}


@router.post("/answer", response_model=AnswerResponse)
async def submit_answer(
    req: AnswerRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    word = await vocab_dal.get_word(db, req.word_id)
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")

    result = await vocab_dal.update_progress(db, req.word_id, req.is_correct)
    adjustment = await vocab_dal.auto_adjust_difficulty(db, req.word_id)
    return {**result, "difficulty_adjustment": adjustment}


@router.get("/progress", response_model=ProgressResponse)
async def get_progress(
    topic: str | None = None,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    progress = await vocab_dal.get_progress(db, topic)
    vocab_topics = get_vocabulary_topics()
    progress = [{**p, "topic": get_topic_label(vocab_topics, p["topic"])} for p in progress]
    return {"progress": progress}


@router.get("/due", response_model=DueWordsResponse)
async def get_due_words(
    topic: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get vocabulary words that are due for review."""
    words = await vocab_dal.get_due_words(db, topic, limit)
    vocab_topics = get_vocabulary_topics()
    words = [{**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in words]
    return {"due_count": len(words), "words": words}


@router.get("/stats", response_model=VocabularyStatsResponse)
async def get_vocabulary_stats(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get aggregate vocabulary mastery statistics."""
    stats = await vocab_dal.get_vocabulary_stats(db)
    topics = get_vocabulary_topics()
    stats["topic_breakdown"] = [
        {**item, "topic": get_topic_label(topics, item["topic"])}
        for item in stats.get("topic_breakdown", [])
    ]
    return stats


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
    vocab_topics = get_vocabulary_topics()
    words = [{**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in words]
    return {"words": words}


class HardWordItem(BaseModel):
    id: int
    word: str
    meaning: str
    topic: str
    correct_count: int
    incorrect_count: int
    level: int
    accuracy: float
    last_reviewed: str | None = None


class HardWordsResponse(BaseModel):
    words: list[HardWordItem]


@router.get("/hard-words", response_model=HardWordsResponse)
async def get_hard_words(
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get words the user struggles with (>=2 attempts, >=2 wrong, accuracy <60%)."""
    words = await vocab_dal.get_hard_words(db, limit)
    vocab_topics = get_vocabulary_topics()
    words = [{**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in words]
    return {"words": words}


class DrillWordItem(BaseModel):
    id: int
    word: str
    meaning: str
    topic: str
    difficulty: int
    example_sentence: str = ""


class DrillResponse(BaseModel):
    words: list[DrillWordItem]
    count: int


@router.get("/drill", response_model=DrillResponse)
async def get_drill_words(
    count: int = Query(default=10, ge=1, le=30),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get words for quick drill mode (prioritizes due and weak words)."""
    words = await vocab_dal.get_drill_words(db, count)
    vocab_topics = get_vocabulary_topics()
    words = [{**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in words]
    return {"words": words, "count": len(words)}


class DeleteWordResponse(BaseModel):
    deleted: bool


@router.delete("/{word_id}", response_model=DeleteWordResponse)
async def delete_word(
    word_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Delete a vocabulary word and its progress."""
    deleted = await vocab_dal.delete_word(db, word_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Word not found")
    return {"deleted": True}


class UpdateWordRequest(BaseModel):
    meaning: str | None = Field(default=None, min_length=1, max_length=500)
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
    word_id: int = Path(ge=1),
    req: UpdateWordRequest = ...,
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
    topic_id: str
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
    vocab_topics = get_vocabulary_topics()
    words = [{**w, "topic_id": w["topic"], "topic": get_topic_label(vocab_topics, w["topic"])} for w in words]
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
    raw_topics = await vocab_dal.get_topic_summary(db)
    vocab_topics = get_vocabulary_topics()
    topics = [
        {**item, "topic": get_topic_label(vocab_topics, item["topic"])}
        for item in raw_topics
    ]
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
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get vocabulary quiz attempt history with optional filters."""
    result = await vocab_dal.get_attempt_history(
        db, word_id=word_id, topic=topic, limit=limit, offset=offset
    )
    vocab_topics = get_vocabulary_topics()
    result["attempts"] = [
        {**a, "topic": get_topic_label(vocab_topics, a["topic"])} for a in result.get("attempts", [])
    ]
    return result


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
    raw_topics = await vocab_dal.get_topic_accuracy(db)
    vocab_topics = get_vocabulary_topics()
    topics = [
        {**item, "topic": get_topic_label(vocab_topics, item["topic"])}
        for item in raw_topics
    ]
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
    vocab_topics = get_vocabulary_topics()
    seen_topics: set[str] = set()
    for w in req.words:
        if w.topic not in seen_topics:
            validate_topic(vocab_topics, w.topic)
            seen_topics.add(w.topic)
    words_data = [w.model_dump() for w in req.words]
    return await vocab_dal.batch_import_words(db, words_data)


class DueCountResponse(BaseModel):
    due_count: int


@router.get("/due-count", response_model=DueCountResponse)
async def get_due_count(db: aiosqlite.Connection = Depends(get_db_session)):
    """Return the number of vocabulary words currently due for SRS review."""
    count = await vocab_dal.get_due_count(db)
    return DueCountResponse(due_count=count)


class ToggleFavoriteResponse(BaseModel):
    word_id: int
    is_favorite: bool


@router.post("/{word_id}/favorite", response_model=ToggleFavoriteResponse)
async def toggle_favorite(
    word_id: int = Path(ge=1),
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
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get favorited vocabulary words."""
    result = await vocab_dal.get_favorites(db, topic=topic, limit=limit, offset=offset)
    vocab_topics = get_vocabulary_topics()
    if "words" in result:
        result["words"] = [{**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in result["words"]]
    return result


class UpdateNotesRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=2000)


@router.put("/{word_id}/notes")
async def update_notes(
    word_id: int = Path(ge=1),
    req: UpdateNotesRequest = ...,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Update or clear notes for a vocabulary word."""
    updated = await vocab_dal.update_notes(db, word_id, req.notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Word not found")
    word = await vocab_dal.get_word_with_notes(db, word_id)
    return word


class SRSLevelStats(BaseModel):
    level: int
    word_count: int
    accuracy: float
    total_reviews: int


class ReviewEfficiency(BaseModel):
    level: int
    avg_reviews: float


class LevelSummary(BaseModel):
    total_words: int
    with_progress: int
    progressing: int
    stalled: int
    mastered: int
    not_reviewed: int


class MasteryVelocity(BaseModel):
    week: str
    words_mastered: int


class SRSAnalyticsResponse(BaseModel):
    retention_by_level: list[SRSLevelStats]
    review_efficiency: list[ReviewEfficiency]
    level_summary: LevelSummary
    mastery_velocity: list[MasteryVelocity]


@router.get("/srs-analytics", response_model=SRSAnalyticsResponse)
async def get_srs_analytics(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get spaced repetition analytics for vocabulary learning."""
    return await vocab_dal.get_srs_analytics(db)


@router.get("/{word_id}/detail")
async def get_word_detail(
    word_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get full word detail including progress, notes, and similar words."""
    detail = await vocab_dal.get_word_detail(db, word_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Word not found")
    vocab_topics = get_vocabulary_topics()
    detail["topic"] = get_topic_label(vocab_topics, detail["topic"])
    return detail


class SentenceBuildItem(BaseModel):
    word_id: int
    hint_word: str
    scrambled_words: list[str]
    correct_sentence: str
    difficulty: int


class SentenceBuildResponse(BaseModel):
    exercises: list[SentenceBuildItem]
    count: int


class SentenceBuildCheckRequest(BaseModel):
    word_id: int = Field(ge=1)
    user_sentence: str = Field(min_length=1, max_length=2000)


class SentenceBuildCheckResponse(BaseModel):
    is_correct: bool
    correct_sentence: str
    word_id: int


@router.get("/sentence-build", response_model=SentenceBuildResponse)
async def get_sentence_build(
    topic: str = Query(..., min_length=1),
    count: int = Query(default=8, ge=1, le=20),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get scrambled sentence exercises for a vocabulary topic."""
    vocab_topics = get_vocabulary_topics()
    validate_topic(vocab_topics, topic)
    exercises = await vocab_dal.get_sentence_build_exercises(db, topic, count)
    return {"exercises": exercises, "count": len(exercises)}


@router.post("/sentence-build/check", response_model=SentenceBuildCheckResponse)
async def check_sentence_build(
    req: SentenceBuildCheckRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Check a user-built sentence against the correct sentence."""
    # Look up the correct sentence
    rows = await db.execute_fetchall(
        "SELECT example_sentence FROM vocabulary_words WHERE id = ?",
        (req.word_id,),
    )
    if not rows or not rows[0]["example_sentence"]:
        raise HTTPException(status_code=404, detail="Word not found or no example sentence")

    correct = rows[0]["example_sentence"].strip()
    is_correct = vocab_dal.check_sentence_build(correct, req.user_sentence)

    # Record progress
    await vocab_dal.update_progress(db, req.word_id, is_correct)

    return {"is_correct": is_correct, "correct_sentence": correct, "word_id": req.word_id}


class SentenceCraftWord(BaseModel):
    id: int
    word: str
    meaning: str


class SentenceCraftWordsResponse(BaseModel):
    words: list[SentenceCraftWord]
    count: int


class SentenceCraftEvalRequest(BaseModel):
    word_ids: list[int] = Field(min_length=1, max_length=10)
    user_sentence: str = Field(min_length=1, max_length=2000)


class WordUsage(BaseModel):
    word: str
    used_correctly: bool
    feedback: str


class SentenceCraftEvalResponse(BaseModel):
    grammar_score: int
    naturalness_score: int
    word_usage: list[WordUsage]
    overall_feedback: str
    model_sentence: str


@router.get("/sentence-craft", response_model=SentenceCraftWordsResponse)
async def get_sentence_craft_words(
    topic: str = Query(..., min_length=1),
    count: int = Query(default=3, ge=1, le=5),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get random vocabulary words for sentence craft exercise."""
    vocab_topics = get_vocabulary_topics()
    validate_topic(vocab_topics, topic)
    words = await vocab_dal.get_random_words_for_craft(db, topic, count)
    return {"words": words, "count": len(words)}


@router.post("/sentence-craft/evaluate", response_model=SentenceCraftEvalResponse)
async def evaluate_sentence_craft(
    req: SentenceCraftEvalRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Evaluate a user-written sentence using the given vocabulary words."""
    words = []
    for wid in req.word_ids:
        rows = await db.execute_fetchall(
            "SELECT word, meaning FROM vocabulary_words WHERE id = ?", (wid,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"Word ID {wid} not found")
        words.append({"id": wid, "word": rows[0]["word"], "meaning": rows[0]["meaning"]})

    word_list_str = ", ".join(f'"{w["word"]}" ({w["meaning"]})' for w in words)
    prompt = (
        f"The user was given these vocabulary words: {word_list_str}\n"
        f"They wrote this sentence: \"{req.user_sentence}\"\n\n"
        "Evaluate the sentence. Return JSON with:\n"
        '- "grammar_score": 1-10 integer\n'
        '- "naturalness_score": 1-10 integer\n'
        '- "word_usage": array of objects with "word", "used_correctly" (bool), "feedback" (string)\n'
        '- "overall_feedback": brief helpful feedback string\n'
        '- "model_sentence": a natural example sentence using all the given words\n'
        "Return ONLY valid JSON."
    )

    copilot = get_copilot_service()
    result = await safe_llm_call(
        lambda: copilot.ask_json(
            "You are an English language evaluator. Assess grammar, naturalness, and vocabulary usage. Return ONLY valid JSON.",
            prompt,
        ),
        context="sentence_craft_evaluate",
    )

    # Normalize result
    return {
        "grammar_score": max(1, min(10, int(result.get("grammar_score", 5)))),
        "naturalness_score": max(1, min(10, int(result.get("naturalness_score", 5)))),
        "word_usage": [
            {
                "word": wu.get("word", ""),
                "used_correctly": bool(wu.get("used_correctly", False)),
                "feedback": str(wu.get("feedback", "")),
            }
            for wu in result.get("word_usage", [])
        ],
        "overall_feedback": str(result.get("overall_feedback", "No feedback available.")),
        "model_sentence": str(result.get("model_sentence", "")),
    }


# ── Tier models ──────────────────────────────────────────

class TierWordItem(BaseModel):
    id: int
    word: str
    meaning: str
    topic: str
    level: int
    correct_count: int
    incorrect_count: int
    error_rate: float


class TiersResponse(BaseModel):
    tiers: dict[str, list[TierWordItem]]
    counts: dict[str, int]


@router.get("/tiers", response_model=TiersResponse)
async def get_tiers(db: aiosqlite.Connection = Depends(get_db_session)):
    """Return vocabulary words grouped by mastery tier."""
    vocab_topics = get_vocabulary_topics()
    raw = await vocab_dal.get_words_by_tier(db)
    tiers: dict[str, list[dict[str, Any]]] = {}
    counts: dict[str, int] = {}
    for tier_name, words in raw.items():
        tiers[tier_name] = [
            {**w, "topic": get_topic_label(vocab_topics, w["topic"])} for w in words
        ]
        counts[tier_name] = len(words)
    return {"tiers": tiers, "counts": counts}


# --- Etymology ---

class EtymologyInfo(BaseModel):
    origin_language: str
    root_words: str
    evolution: str
    fun_fact: str


class EtymologyResponse(BaseModel):
    word_id: int
    word: str
    etymology: EtymologyInfo


@router.get("/{word_id}/etymology", response_model=EtymologyResponse)
async def get_word_etymology(
    word_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Get etymology/word origin, generating via LLM if not cached."""
    import json as _json

    word_text, cached = await vocab_dal.get_etymology(db, word_id)
    if word_text is None:
        raise HTTPException(status_code=404, detail="Word not found")

    if cached:
        try:
            data = _json.loads(cached)
            return {"word_id": word_id, "word": word_text, "etymology": data}
        except Exception:
            pass

    copilot = get_copilot_service()
    user_prompt = (
        f'Give the etymology of the English word "{word_text}". '
        'Return JSON: {"origin_language": "...", "root_words": "...", '
        '"evolution": "1-2 sentences on meaning change", "fun_fact": "one interesting fact"}'
    )

    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English etymologist. Return ONLY valid JSON, no markdown.",
                user_prompt,
            ),
            context="etymology",
        )
    except Exception:
        result = {
            "origin_language": "unknown",
            "root_words": word_text,
            "evolution": "Origin information unavailable.",
            "fun_fact": "",
        }

    await vocab_dal.save_etymology(db, word_id, _json.dumps(result))
    return {"word_id": word_id, "word": word_text, "etymology": result}


# ── Word Family Explorer ─────────────────────────────────────────────────────

class WordFamilyForm(BaseModel):
    part_of_speech: str
    form: str
    example_sentence: str
    pronunciation_tip: str


class WordFamilyResponse(BaseModel):
    word_id: int
    word: str
    forms: list[WordFamilyForm]


@router.get("/{word_id}/word-family", response_model=WordFamilyResponse)
async def get_word_family(
    word_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Get all word forms (noun, verb, adjective, adverb), generating via LLM if not cached."""
    import json as _json

    word_text, cached = await vocab_dal.get_word_family(db, word_id)
    if word_text is None:
        raise HTTPException(status_code=404, detail="Word not found")

    if cached:
        forms = cached.get("forms") or []
        return {"word_id": word_id, "word": word_text, "forms": forms}

    copilot = get_copilot_service()
    user_prompt = (
        f"Generate all word forms (noun, verb, adjective, adverb) for the word '{word_text}'. "
        'Return JSON: {"forms": [{"part_of_speech": "noun|verb|adjective|adverb", '
        '"form": "the word form", "example_sentence": "a short example", '
        '"pronunciation_tip": "a brief tip"}]}'
    )

    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English vocabulary expert. Return ONLY valid JSON, no markdown.",
                user_prompt,
            ),
            context="word_family",
        )
    except Exception:
        result = {
            "forms": [
                {
                    "part_of_speech": "unknown",
                    "form": word_text,
                    "example_sentence": "Information unavailable.",
                    "pronunciation_tip": "",
                }
            ]
        }

    forms = result.get("forms") or []
    await vocab_dal.save_word_family(db, word_id, {"forms": forms})
    return {"word_id": word_id, "word": word_text, "forms": forms}


class EvaluateSentenceUseRequest(BaseModel):
    word: str = Field(min_length=1, max_length=100)
    meaning: str = Field(min_length=1, max_length=500)
    user_sentence: str = Field(min_length=1, max_length=1000)


class EvaluateSentenceUseResponse(BaseModel):
    correctness: int
    naturalness: int
    grammar: int
    overall_score: int
    feedback: str
    model_sentence: str


@router.post("/evaluate-sentence-use", response_model=EvaluateSentenceUseResponse)
async def evaluate_sentence_use(
    req: EvaluateSentenceUseRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate whether the user correctly used a vocabulary word in a spoken sentence."""
    copilot = get_copilot_service()

    system = (
        "You are an English teacher evaluating vocabulary usage in sentences. "
        f'The target word is "{req.word}" (meaning: {req.meaning}). '
        "Evaluate the student's sentence on three criteria (each 1-10): "
        "correctness (is the word used with the right meaning?), "
        "naturalness (does it sound like something a native speaker would say?), "
        "grammar (is the sentence grammatically correct?). "
        "Return JSON: {\"correctness\": N, \"naturalness\": N, \"grammar\": N, "
        "\"feedback\": \"brief constructive feedback\", "
        "\"model_sentence\": \"a natural example sentence using the word\"}"
    )

    result = await safe_llm_call(
        lambda: copilot.ask_json(system, f"Student sentence: \"{req.user_sentence}\""),
        context="evaluate_sentence_use",
    )
    if not result:
        raise HTTPException(status_code=502, detail="Failed to evaluate sentence")

    correctness = min(10, max(1, int(result.get("correctness", 5))))
    naturalness = min(10, max(1, int(result.get("naturalness", 5))))
    grammar = min(10, max(1, int(result.get("grammar", 5))))
    overall = round((correctness + naturalness + grammar) / 3)

    return EvaluateSentenceUseResponse(
        correctness=correctness,
        naturalness=naturalness,
        grammar=grammar,
        overall_score=overall,
        feedback=str(result.get("feedback", "")),
        model_sentence=str(result.get("model_sentence", "")),
    )


# --- Vocabulary Usage Analysis ---


class UsageWordItem(BaseModel):
    word_id: int
    word: str
    topic: str
    conversation_count: int
    journal_count: int
    total_count: int


class NeverUsedWordItem(BaseModel):
    word_id: int
    word: str
    topic: str


class UsageSummary(BaseModel):
    total_studied: int
    total_actively_used: int
    usage_rate: float
    most_used_word: str | None


class VocabularyUsageAnalysisResponse(BaseModel):
    actively_used: list[UsageWordItem]
    never_used: list[NeverUsedWordItem]
    summary: UsageSummary


@router.get("/usage-analysis", response_model=VocabularyUsageAnalysisResponse)
async def get_usage_analysis(db: aiosqlite.Connection = Depends(get_db_session)):
    """Analyse which studied vocabulary words the user actually uses in speaking activities."""
    data = await vocab_dal.get_vocabulary_usage_analysis(db)
    return VocabularyUsageAnalysisResponse(**data)


# ── Collocation Match (autoresearch #661) ─────────────────

class CollocationRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    count: int = Field(default=5, ge=1, le=10)


class CollocationItem(BaseModel):
    word_id: int
    word: str
    prompt_sentence: str
    options: list[str]
    correct_index: int
    explanation: str


class CollocationResponse(BaseModel):
    items: list[CollocationItem]


def _parse_collocation_item(raw: Any, allowed_word_ids: set[int]) -> CollocationItem | None:
    """Validate and coerce one raw LLM item; return None if it doesn't fit the schema."""
    if not isinstance(raw, dict):
        return None
    try:
        word_id = int(raw.get("word_id"))
    except (TypeError, ValueError):
        return None
    if word_id not in allowed_word_ids:
        return None
    word = str(raw.get("word", "")).strip()
    prompt_sentence = str(raw.get("prompt_sentence", "")).strip()
    if not word or "____" not in prompt_sentence:
        return None
    options = raw.get("options")
    if not isinstance(options, list) or len(options) != 4:
        return None
    options = [str(o).strip() for o in options]
    if any(not o for o in options):
        return None
    try:
        correct_index = int(raw.get("correct_index"))
    except (TypeError, ValueError):
        return None
    if correct_index < 0 or correct_index > 3:
        return None
    explanation = str(raw.get("explanation", "")).strip()
    return CollocationItem(
        word_id=word_id,
        word=word,
        prompt_sentence=prompt_sentence,
        options=options,
        correct_index=correct_index,
        explanation=explanation or "Natural collocation.",
    )


@router.post("/collocations", response_model=CollocationResponse)
async def generate_collocations(
    req: CollocationRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Generate Collocation Match items for the user's saved vocabulary in *topic*.

    Pulls random words for the topic, then asks the LLM in a single call to
    produce a multiple-choice item per word where the learner picks the most
    natural collocate to fill a blank. If the LLM fails entirely the endpoint
    returns 503; if some items parse successfully they are returned.
    """
    vocab_topics = get_vocabulary_topics()
    validate_topic(vocab_topics, req.topic)

    words = await vocab_dal.get_random_words_for_craft(db, req.topic, req.count)
    if not words:
        raise HTTPException(
            status_code=404,
            detail=f"No vocabulary words saved for topic '{req.topic}' yet.",
        )

    word_list_str = "\n".join(
        f"- id={w['id']} word=\"{w['word']}\" meaning=\"{w['meaning']}\""
        for w in words
    )
    prompt = get_prompt_collocation_match().format(
        word_list=word_list_str, count=len(words),
    )

    copilot = get_copilot_service()
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English vocabulary coach. Return ONLY valid JSON.",
                prompt,
            ),
            context="vocabulary_collocation_match",
        )
    except HTTPException:
        # safe_llm_call raises 502; surface as 503 per the proposal so the
        # frontend can show a "service unavailable" message.
        raise HTTPException(
            status_code=503,
            detail="Collocation generator temporarily unavailable.",
        )

    raw_items = result.get("items") if isinstance(result, dict) else None
    if not isinstance(raw_items, list):
        raw_items = []

    allowed_ids = {w["id"] for w in words}
    items: list[CollocationItem] = []
    for raw in raw_items:
        parsed = _parse_collocation_item(raw, allowed_ids)
        if parsed is not None:
            items.append(parsed)

    return CollocationResponse(items=items)


def get_prompt_collocation_match() -> str:
    """Late import to avoid circulars and to keep prompt text in app/prompts.py."""
    from app.prompts import VOCABULARY_COLLOCATION_MATCH
    return VOCABULARY_COLLOCATION_MATCH()
