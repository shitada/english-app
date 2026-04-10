"""Pronunciation check API endpoints."""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.config import get_conversation_topics, get_prompt, get_vocabulary_topics
from app.copilot_client import get_copilot_service
from app.dal import pronunciation as pron_dal
from app.database import get_db_session
from app.rate_limit import require_rate_limit
from app.utils import coerce_bool, compute_dictation_score, get_topic_label, safe_llm_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pronunciation", tags=["pronunciation"])


class CheckRequest(BaseModel):
    reference_text: str = Field(min_length=1, max_length=1000)
    user_transcription: str = Field(min_length=1, max_length=1000)
    difficulty: Literal["beginner", "intermediate", "advanced"] | None = None


class SentenceItem(BaseModel):
    text: str
    topic: str
    difficulty: str = "intermediate"


class SentencesResponse(BaseModel):
    sentences: list[SentenceItem]


class AttemptItem(BaseModel):
    id: int
    reference_text: str
    user_transcription: str
    feedback: dict[str, Any] | None
    score: float | None
    difficulty: str | None = None
    created_at: str


class HistoryResponse(BaseModel):
    attempts: list[AttemptItem]


class ScoreByDate(BaseModel):
    date: str
    avg_score: float
    count: int


class MostPracticed(BaseModel):
    text: str
    attempt_count: int
    avg_score: float


class PronunciationProgressResponse(BaseModel):
    total_attempts: int
    avg_score: float
    best_score: float
    scores_by_date: list[ScoreByDate]
    most_practiced: list[MostPracticed]


class ClearHistoryResponse(BaseModel):
    deleted_count: int


class DeleteAttemptResponse(BaseModel):
    deleted: bool


@router.get("/sentences", response_model=SentencesResponse)
async def get_sentences(
    difficulty: str | None = Query(default=None, pattern="^(beginner|intermediate|advanced)$"),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    sentences = await pron_dal.get_sentences_from_conversations(db, difficulty=difficulty)

    # Convert raw topic keys to human-readable labels
    topics = get_conversation_topics()
    sentences = [
        {**s, "topic": get_topic_label(topics, s["topic"])}
        for s in sentences
    ]

    return {"sentences": sentences}


def _parse_score(value: Any) -> float | None:
    """Parse a score value from various LLM string formats to float in [0, 10]."""
    if value is None:
        return None
    try:
        val = float(value)
        return max(0.0, min(10.0, val)) if math.isfinite(val) else None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    if not text:
        return None
    # Handle fraction format (e.g. "80/100", "4/5", "8.5/10")
    frac = re.search(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", text)
    if frac:
        numer = float(frac.group(1))
        denom = float(frac.group(2))
        if denom > 0:
            val = numer / denom * 10.0
            if math.isfinite(val):
                return max(0.0, min(10.0, val))
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if not m:
        return None
    val = float(m.group(1))
    if "%" in text:
        val = val / 10.0
    if not math.isfinite(val):
        return None
    return max(0.0, min(10.0, val))


def _normalize_feedback(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize LLM pronunciation feedback to ensure consistent types."""
    result = dict(raw)

    # overall_score: float or None (never default to 0), clamped to [0, 10]
    result["overall_score"] = _parse_score(result.get("overall_score"))

    # overall_feedback: must be a string
    if not isinstance(result.get("overall_feedback"), str):
        result["overall_feedback"] = str(result.get("overall_feedback") or "")

    # word_feedback: must be a list of dicts, with is_correct coerced to bool
    wf = result.get("word_feedback")
    if not isinstance(wf, list):
        result["word_feedback"] = []
    else:
        items = [item for item in wf if isinstance(item, dict)]
        for item in items:
            if "is_correct" in item and item["is_correct"] is not None:
                item["is_correct"] = coerce_bool(item["is_correct"])
            elif "is_correct" in item:
                # Explicit null → conservatively mark as incorrect
                item["is_correct"] = False
            # Canonicalize LLM key variants → expected/heard
            if "word" in item and "expected" not in item:
                item["expected"] = item.pop("word")
            if "actual" in item and "heard" not in item:
                item["heard"] = item.pop("actual")
            # Normalize phoneme_issues within each word feedback
            pi = item.get("phoneme_issues")
            if not isinstance(pi, list):
                item["phoneme_issues"] = []
            else:
                normalized_pi = []
                for p in pi:
                    if not isinstance(p, dict):
                        continue
                    item_d = {k: str(v) if v is not None else "" for k, v in p.items()}
                    # Canonicalize LLM key variants → target/produced
                    if "target_sound" in item_d and "target" not in item_d:
                        item_d["target"] = item_d.pop("target_sound")
                    if "produced_sound" in item_d and "produced" not in item_d:
                        item_d["produced"] = item_d.pop("produced_sound")
                    normalized_pi.append(item_d)
                item["phoneme_issues"] = normalized_pi
        result["word_feedback"] = items

    # focus_areas: must be a list of strings
    fa = result.get("focus_areas")
    if isinstance(fa, list):
        result["focus_areas"] = [str(item) for item in fa if item is not None]
    elif isinstance(fa, str) and fa.strip():
        result["focus_areas"] = [fa.strip()]
    else:
        result["focus_areas"] = []

    # fluency_score: float or None, clamped to [0, 10]
    result["fluency_score"] = _parse_score(result.get("fluency_score"))

    # fluency_feedback: must be string if present
    if "fluency_feedback" in result and not isinstance(result["fluency_feedback"], str):
        result["fluency_feedback"] = str(result.get("fluency_feedback") or "")

    # common_patterns: must be a list of strings
    cp = result.get("common_patterns")
    if isinstance(cp, list):
        result["common_patterns"] = [str(item) for item in cp if item is not None]
    elif isinstance(cp, str) and cp.strip():
        result["common_patterns"] = [cp.strip()]
    else:
        result["common_patterns"] = []

    return result


@router.post("/check")
async def check_pronunciation(req: CheckRequest, db: aiosqlite.Connection = Depends(get_db_session), _rl=Depends(require_rate_limit)):
    copilot = get_copilot_service()

    prompt = get_prompt("pronunciation_checker").format(
        reference_text=req.reference_text,
        user_transcription=req.user_transcription,
    )
    raw_feedback = await safe_llm_call(
        lambda: copilot.ask_json(
            "You are an English pronunciation coach. Return ONLY valid JSON.",
            prompt,
        ),
        context="check_pronunciation",
    )

    feedback = _normalize_feedback(raw_feedback)

    attempt_id = await pron_dal.save_attempt(
        db, req.reference_text, req.user_transcription, feedback, feedback.get("overall_score"),
        difficulty=req.difficulty,
    )

    return {**feedback, "attempt_id": attempt_id}


@router.get("/history", response_model=HistoryResponse)
async def get_pronunciation_history(db: aiosqlite.Connection = Depends(get_db_session)):
    attempts = await pron_dal.get_history(db)
    return {"attempts": attempts}


@router.get("/progress", response_model=PronunciationProgressResponse)
async def get_pronunciation_progress(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get aggregate pronunciation progress statistics."""
    return await pron_dal.get_progress(db)


@router.delete("/history", response_model=ClearHistoryResponse)
async def clear_history(db: aiosqlite.Connection = Depends(get_db_session)):
    """Clear all pronunciation attempts."""
    deleted = await pron_dal.clear_history(db)
    return {"deleted_count": deleted}


@router.delete("/{attempt_id}", response_model=DeleteAttemptResponse)
async def delete_attempt(attempt_id: int = Path(ge=1), db: aiosqlite.Connection = Depends(get_db_session)):
    """Delete a single pronunciation attempt."""
    deleted = await pron_dal.delete_attempt(db, attempt_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return {"deleted": True}


class ScoreTrendResponse(BaseModel):
    trend: str
    recent_avg: float
    previous_avg: float
    change: float


@router.get("/trend", response_model=ScoreTrendResponse)
async def get_score_trend(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get pronunciation score trend (improving/declining/stable)."""
    return await pron_dal.get_score_trend(db)


class ScoreDistributionItem(BaseModel):
    bucket: str
    label: str
    min_score: float
    max_score: float
    count: int


class ScoreDistributionResponse(BaseModel):
    total_attempts: int
    distribution: list[ScoreDistributionItem]


@router.get("/distribution", response_model=ScoreDistributionResponse)
async def get_score_distribution(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get pronunciation score distribution across quality buckets."""
    return await pron_dal.get_score_distribution(db)


class AttemptRecord(BaseModel):
    text: str
    score: float
    date: str


class PersonalRecordsResponse(BaseModel):
    total_attempts: int
    avg_score: float
    best_score: float
    worst_score: float
    best_attempts: list[AttemptRecord]
    worst_attempts: list[AttemptRecord]


@router.get("/records", response_model=PersonalRecordsResponse)
async def get_personal_records(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get pronunciation personal records and best/worst attempts."""
    return await pron_dal.get_personal_records(db)


@router.get("/weekly-progress")
async def get_weekly_progress(
    weeks: int = Query(default=8, ge=1, le=52),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get pronunciation score averages grouped by week."""
    return await pron_dal.get_weekly_progress(db, weeks=weeks)


@router.get("/sentences/vocabulary")
async def get_vocabulary_sentences(
    difficulty: str | None = Query(default=None, pattern="^(beginner|intermediate|advanced)$"),
    topic: str | None = None,
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get pronunciation practice sentences sourced from vocabulary example sentences."""
    sentences = await pron_dal.get_sentences_from_vocabulary(
        db, limit=limit, difficulty=difficulty, topic=topic
    )
    vocab_topics = get_vocabulary_topics()
    sentences = [
        {**s, "topic": get_topic_label(vocab_topics, s.get("topic", ""))}
        for s in sentences
    ]
    return {"sentences": sentences, "source": "vocabulary", "count": len(sentences)}


class WeaknessHeardAs(BaseModel):
    heard: str
    count: int


class WeaknessItem(BaseModel):
    word: str
    occurrence_count: int
    common_heard_as: list[list]
    tips: list[str]


class WeaknessesResponse(BaseModel):
    weaknesses: list[WeaknessItem]
    total: int


@router.get("/weaknesses", response_model=WeaknessesResponse)
async def get_pronunciation_weaknesses(
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get commonly mispronounced words aggregated from pronunciation feedback."""
    weaknesses = await pron_dal.get_pronunciation_weaknesses(db, limit=limit)
    return {"weaknesses": weaknesses, "total": len(weaknesses)}


class DifficultyProgressItem(BaseModel):
    difficulty: str
    attempt_count: int
    avg_score: float
    best_score: float
    latest_score: float


class DifficultyProgressResponse(BaseModel):
    items: list[DifficultyProgressItem]


@router.get("/difficulty-progress", response_model=DifficultyProgressResponse)
async def get_difficulty_progress(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get pronunciation progress breakdown by difficulty level."""
    items = await pron_dal.get_progress_by_difficulty(db)
    return {"items": items}


class RetrySuggestionItem(BaseModel):
    text: str
    attempt_count: int
    latest_score: float
    worst_score: float
    best_score: float


class RetrySuggestionsResponse(BaseModel):
    suggestions: list[RetrySuggestionItem]
    total: int
    threshold: float


class SentenceAttemptItem(BaseModel):
    id: int
    user_transcription: str
    score: float | None
    difficulty: str | None
    created_at: str


class SentenceAttemptSummary(BaseModel):
    first_score: float
    latest_score: float
    best_score: float
    attempt_count: int
    improvement: float


class SentenceHistoryResponse(BaseModel):
    attempts: list[SentenceAttemptItem]
    summary: SentenceAttemptSummary


@router.get("/sentence-history", response_model=SentenceHistoryResponse)
async def get_sentence_history(
    text: str = Query(..., min_length=1, max_length=1000),
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get pronunciation attempt history for a specific sentence."""
    return await pron_dal.get_sentence_attempts(db, reference_text=text, limit=limit)


@router.get("/retry-suggestions", response_model=RetrySuggestionsResponse)
async def get_retry_suggestions(
    threshold: float = Query(default=7.0, ge=0, le=10),
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get sentences that need re-practicing based on low scores."""
    suggestions = await pron_dal.get_retry_suggestions(db, threshold=threshold, limit=limit)
    return {"suggestions": suggestions, "total": len(suggestions), "threshold": threshold}


class MistakePatternItem(BaseModel):
    target_sound: str
    produced_sound: str
    occurrence_count: int
    example_words: list[str]


class CommonMistakesResponse(BaseModel):
    patterns: list[MistakePatternItem]
    total: int


class DictationRequest(BaseModel):
    reference_text: str = Field(min_length=1, max_length=1000)
    user_typed_text: str = Field(max_length=2000)


class DictationWordResult(BaseModel):
    expected: str
    typed: str
    is_correct: bool


class DictationResponse(BaseModel):
    score: float
    total_words: int
    correct_words: int
    word_results: list[DictationWordResult]


@router.post("/dictation-check", response_model=DictationResponse)
async def check_dictation(req: DictationRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    """Check dictation accuracy by comparing typed text to reference."""
    result = compute_dictation_score(req.reference_text, req.user_typed_text)

    # Persist as a pronunciation attempt so it shows in history
    await pron_dal.save_attempt(
        db,
        req.reference_text,
        req.user_typed_text,
        {"mode": "dictation", "word_results": result["word_results"]},
        result["score"],
    )

    return result


@router.get("/common-mistakes", response_model=CommonMistakesResponse)
async def get_common_mistakes(
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get commonly confused sound patterns aggregated from pronunciation feedback."""
    patterns = await pron_dal.get_common_mistake_patterns(db, limit=limit)
    return {"patterns": patterns, "total": len(patterns)}


class MinimalPairItem(BaseModel):
    word_a: str
    word_b: str
    phoneme_contrast: str
    example_a: str
    example_b: str
    difficulty: str
    play_word: str


class MinimalPairsResponse(BaseModel):
    pairs: list[MinimalPairItem]
    total: int


@router.get("/minimal-pairs", response_model=MinimalPairsResponse)
async def get_minimal_pairs(
    difficulty: str | None = Query(default=None, pattern="^(beginner|intermediate|advanced)$"),
    count: int = Query(default=10, ge=1, le=30),
):
    """Get minimal pairs exercises for listening discrimination practice."""
    pairs = pron_dal.get_minimal_pairs(difficulty=difficulty, count=count)
    return {"pairs": pairs, "total": len(pairs)}


class ListeningQuizQuestion(BaseModel):
    question: str
    options: list[str]
    correct_index: int = Field(ge=0, le=3)
    explanation: str


class ListeningQuizResponse(BaseModel):
    title: str
    passage: str
    questions: list[ListeningQuizQuestion]


@router.post("/listening-quiz", response_model=ListeningQuizResponse)
async def generate_listening_quiz(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    question_count: int = Query(default=5, ge=2, le=8),
    _rl=Depends(require_rate_limit),
):
    """Generate a listening comprehension quiz with a passage and questions."""
    copilot = get_copilot_service()
    prompt = (
        f"Generate a short English listening comprehension exercise at {difficulty} level.\n"
        f"Create a passage of 3-6 sentences about an everyday topic.\n"
        f"Then create {question_count} multiple-choice comprehension questions about the passage.\n\n"
        "Return JSON with:\n"
        "- title (string): a short title for the passage\n"
        "- passage (string): the passage text (3-6 sentences)\n"
        "- questions (array): each with question, options (4 strings), correct_index (0-3), explanation\n"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English listening comprehension quiz generator. Return ONLY valid JSON.",
                prompt,
            ),
            context="listening_quiz",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Listening quiz generation failed")

    title = str(result.get("title", "Listening Exercise"))
    passage = str(result.get("passage", ""))
    if not passage:
        raise HTTPException(status_code=502, detail="Failed to generate passage")

    questions_raw = result.get("questions", [])
    validated: list[dict[str, Any]] = []
    for q in questions_raw[:question_count]:
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
        try:
            idx = int(raw_idx)
        except (ValueError, TypeError):
            continue
        if not (0 <= idx <= 3):
            continue
        validated.append({
            "question": str(q["question"]),
            "options": [str(o) for o in opts],
            "correct_index": idx,
            "explanation": str(q.get("explanation", "")),
        })

    if not validated:
        raise HTTPException(status_code=502, detail="Failed to generate valid questions")

    return {"title": title, "passage": passage, "questions": validated}
