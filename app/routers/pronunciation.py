"""Pronunciation check API endpoints."""

from __future__ import annotations

import json
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
from app.dal import vocabulary as vocab_dal
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


class CorrectionSentenceItem(BaseModel):
    text: str
    original: str
    topic: str
    difficulty: str
    error_type: str


class CorrectionSentencesResponse(BaseModel):
    sentences: list[CorrectionSentenceItem]


@router.get("/sentences/corrections", response_model=CorrectionSentencesResponse)
async def get_correction_sentences(
    limit: int = Query(default=10, ge=1, le=50),
    difficulty: str | None = Query(default=None, pattern="^(beginner|intermediate|advanced)$"),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get corrected sentences from grammar feedback for pronunciation practice."""
    sentences = await pron_dal.get_sentences_from_corrections(db, limit=limit, difficulty=difficulty)
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


class SentenceMasteryItem(BaseModel):
    reference_text: str
    attempt_count: int
    first_score: float
    latest_score: float
    best_score: float
    improvement: float
    status: str


class SentenceMasteryResponse(BaseModel):
    sentences: list[SentenceMasteryItem]
    total_count: int
    mastered_count: int
    improving_count: int
    needs_work_count: int


@router.get("/sentence-mastery", response_model=SentenceMasteryResponse)
async def get_sentence_mastery(
    min_attempts: int = Query(default=2, ge=2, le=20),
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get mastery overview for sentences practiced multiple times."""
    return await pron_dal.get_sentence_mastery_overview(db, min_attempts=min_attempts, limit=limit)


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


class MinimalPairsResultItem(BaseModel):
    phoneme_contrast: str
    word_a: str
    word_b: str
    is_correct: bool


class MinimalPairsResultsRequest(BaseModel):
    results: list[MinimalPairsResultItem] = Field(..., min_length=1, max_length=30)


@router.post("/minimal-pairs/results")
async def save_minimal_pairs_results(
    body: MinimalPairsResultsRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Save minimal pairs exercise results for tracking."""
    count = await pron_dal.save_minimal_pairs_results(
        db, [r.model_dump() for r in body.results]
    )
    return {"saved": count}


class PhonemeContrastStat(BaseModel):
    phoneme_contrast: str
    attempts: int
    correct: int
    accuracy: float


@router.get("/minimal-pairs/stats", response_model=list[PhonemeContrastStat])
async def get_minimal_pairs_stats(
    limit: int = Query(default=20, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get per-phoneme-contrast accuracy stats across all sessions."""
    return await pron_dal.get_phoneme_contrast_stats(db, limit=limit)


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
    topic: str = Query(default="", description="Optional topic ID to focus the passage on"),
    _rl=Depends(require_rate_limit),
):
    """Generate a listening comprehension quiz with a passage and questions."""
    copilot = get_copilot_service()
    topic_phrase = "about an everyday topic"
    if topic:
        topics_list = get_conversation_topics()
        label = get_topic_label(topics_list, topic)
        topic_phrase = f"about a {label} scenario"
    prompt = (
        f"Generate a short English listening comprehension exercise at {difficulty} level.\n"
        f"Create a passage of 3-6 sentences {topic_phrase}.\n"
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


class QuickListeningCompResponse(BaseModel):
    passage: str
    question: str
    options: list[str]
    correct_index: int
    explanation: str
    difficulty: str


@router.get("/quick-listening-comp", response_model=QuickListeningCompResponse)
async def get_quick_listening_comp(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate a short listening comprehension passage with a multiple-choice question."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a short listening comprehension exercise for a {difficulty}-level English learner.\n"
        "Create a short passage (2-4 sentences) on an everyday topic, then a comprehension question "
        "with 4 answer options where exactly one is correct.\n"
        "Return JSON with:\n"
        "- passage (string): a short passage (2-4 sentences)\n"
        "- question (string): a comprehension question about the passage\n"
        "- options (array of 4 strings): answer choices\n"
        "- correct_index (integer 0-3): index of the correct option\n"
        "- explanation (string): brief explanation of why the answer is correct (1 sentence)"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English listening comprehension teacher. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="quick_listening_comp",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Listening comprehension generation failed")

    options = [str(o) for o in result.get("options", [])[:4]]
    if len(options) < 4:
        options.extend([""] * (4 - len(options)))

    correct_index = int(result.get("correct_index", 0))
    correct_index = max(0, min(3, correct_index))

    return {
        "passage": str(result.get("passage", "")),
        "question": str(result.get("question", "")),
        "options": options,
        "correct_index": correct_index,
        "explanation": str(result.get("explanation", "")),
        "difficulty": difficulty,
    }


class QuickSpeakPromptResponse(BaseModel):
    prompt: str
    context_hint: str
    difficulty: str
    suggested_phrases: list[str]


@router.get("/quick-speak", response_model=QuickSpeakPromptResponse)
async def get_quick_speak_prompt(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate a random situational speaking prompt for quick-speak warm-up."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a speaking prompt for a {difficulty}-level English learner.\n"
        "Give them a topic to speak about for 30 seconds.\n"
        "Return JSON with:\n"
        "- prompt (string): the speaking topic/question (1-2 sentences)\n"
        "- context_hint (string): brief context to help them get started (1 sentence)\n"
        "- difficulty (string): the difficulty level\n"
        "- suggested_phrases (array of 3 strings): useful phrases they could use"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="quick_speak_prompt",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Prompt generation failed")

    return {
        "prompt": str(result.get("prompt", "Describe your typical day.")),
        "context_hint": str(result.get("context_hint", "Think about what you do from morning to evening.")),
        "difficulty": difficulty,
        "suggested_phrases": [str(p) for p in result.get("suggested_phrases", [])[:3]],
    }


class QuickSpeakEvaluateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)
    transcript: str = Field(min_length=1, max_length=2000)
    duration_seconds: int = Field(ge=1, le=120)


class QuickSpeakEvaluateResponse(BaseModel):
    fluency_score: float
    relevance_score: float
    grammar_score: float
    vocabulary_score: float
    overall_score: float
    word_count: int
    wpm: float
    feedback: str
    suggestions: list[str]


@router.post("/quick-speak/evaluate", response_model=QuickSpeakEvaluateResponse)
async def evaluate_quick_speak(
    body: QuickSpeakEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a quick-speak warm-up attempt."""
    word_count = len(body.transcript.split())
    wpm = round(word_count / (body.duration_seconds / 60), 1) if body.duration_seconds > 0 else 0

    copilot = get_copilot_service()
    eval_prompt = (
        f"Speaking prompt: \"{body.prompt}\"\n"
        f"User's spoken transcript ({body.duration_seconds}s, {word_count} words, {wpm} WPM):\n"
        f"\"{body.transcript}\"\n\n"
        "Evaluate this speaking attempt. Return JSON with:\n"
        "- fluency_score (1-10): flow and pace of speech\n"
        "- relevance_score (1-10): how well they addressed the prompt\n"
        "- grammar_score (1-10): grammatical accuracy\n"
        "- vocabulary_score (1-10): range and appropriateness of words\n"
        "- overall_score (1-10): overall speaking quality\n"
        "- feedback (string): encouraging feedback (2-3 sentences)\n"
        "- suggestions (array of 2 strings): specific improvement tips"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach. Return ONLY valid JSON.",
                eval_prompt,
            ),
            context="quick_speak_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "fluency_score": clamp(result.get("fluency_score", 5)),
        "relevance_score": clamp(result.get("relevance_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "vocabulary_score": clamp(result.get("vocabulary_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "word_count": word_count,
        "wpm": wpm,
        "feedback": str(result.get("feedback", "")),
        "suggestions": [str(s) for s in result.get("suggestions", [])[:3]],
    }


class ListeningQuizResultRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    difficulty: str = Field(min_length=1, max_length=50)
    total_questions: int = Field(ge=1, le=100)
    correct_count: int = Field(ge=0)
    score: float = Field(ge=0, le=100)
    topic: str = Field(default="", max_length=100)
    passage: str = Field(default="", max_length=10000)
    questions: list[dict] = Field(default_factory=list)


class ListeningQuizResultResponse(BaseModel):
    id: int
    message: str


@router.post("/listening-quiz/results", response_model=ListeningQuizResultResponse)
async def save_listening_quiz_result(
    req: ListeningQuizResultRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Save a listening quiz result."""
    if req.correct_count > req.total_questions:
        raise HTTPException(status_code=422, detail="correct_count cannot exceed total_questions")
    result_id = await pron_dal.save_listening_quiz_result(
        db, req.title, req.difficulty, req.total_questions, req.correct_count, req.score, req.topic,
        req.passage, json.dumps(req.questions),
    )
    return {"id": result_id, "message": "Result saved"}


@router.get("/listening-quiz/history")
async def get_listening_quiz_history(
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get recent listening quiz results."""
    return await pron_dal.get_listening_quiz_history(db, limit=limit)


@router.get("/listening-quiz/difficulty-recommendation")
async def get_listening_difficulty_recommendation(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Recommend a listening quiz difficulty based on recent performance."""
    return await pron_dal.get_listening_difficulty_recommendation(db)


@router.get("/listening-quiz/{quiz_id}")
async def get_listening_quiz_detail(
    quiz_id: int = Path(ge=1),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get a single listening quiz result with passage and questions for replay."""
    detail = await pron_dal.get_listening_quiz_detail(db, quiz_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return detail


# ── Passage Vocabulary Extraction ───────────────────────────


class PassageVocabRequest(BaseModel):
    passage: str = Field(min_length=10, max_length=10000)


class PassageVocabWord(BaseModel):
    word: str
    part_of_speech: str
    meaning: str
    context_sentence: str


class PassageVocabResponse(BaseModel):
    words: list[PassageVocabWord]


@router.post("/passage-vocabulary", response_model=PassageVocabResponse)
async def extract_passage_vocabulary(
    req: PassageVocabRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
    _rl=Depends(require_rate_limit),
):
    """Extract key vocabulary words from a listening passage using LLM."""
    copilot = get_copilot_service()
    prompt = (
        f"Extract 5-8 key English vocabulary words from the following passage that would be most useful for an English learner.\n\n"
        f"Passage:\n{req.passage}\n\n"
        "Return JSON with:\n"
        '- words (array): each with "word", "part_of_speech", "meaning" (brief definition), '
        '"context_sentence" (the exact sentence from the passage where the word appears)\n'
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English vocabulary extraction assistant. Return ONLY valid JSON.",
                prompt,
            ),
            context="passage_vocabulary",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Vocabulary extraction failed")

    words_raw = result.get("words", [])
    validated: list[dict[str, str]] = []
    for w in words_raw[:8]:
        if not isinstance(w, dict):
            continue
        word = str(w.get("word", "")).strip()
        if not word:
            continue
        validated.append({
            "word": word,
            "part_of_speech": str(w.get("part_of_speech", "")),
            "meaning": str(w.get("meaning", "")),
            "context_sentence": str(w.get("context_sentence", "")),
        })
    return {"words": validated}


class SavePassageVocabRequest(BaseModel):
    words: list[dict] = Field(min_length=1, max_length=20)


@router.post("/passage-vocabulary/save")
async def save_passage_vocabulary(
    req: SavePassageVocabRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Save extracted passage vocabulary words to the vocabulary bank under 'listening' topic."""
    questions = [
        {
            "word": w.get("word", ""),
            "meaning": w.get("meaning", ""),
            "example_sentence": w.get("context_sentence", w.get("example_sentence", "")),
        }
        for w in req.words
        if w.get("word")
    ]
    if not questions:
        raise HTTPException(status_code=422, detail="No valid words to save")
    saved = await vocab_dal.save_words(db, "listening", questions)
    return {"saved_count": len(saved), "words": saved}


# ── Response Drill ──────────────────────────────────────────

class ResponseDrillPrompt(BaseModel):
    situation: str
    speaker_says: str
    expected_response_type: str
    difficulty: str


class ResponseDrillPromptsResponse(BaseModel):
    prompts: list[ResponseDrillPrompt]


@router.get("/response-drill", response_model=ResponseDrillPromptsResponse)
async def get_response_drill_prompts(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    count: int = Query(default=6, ge=1, le=10),
    _rl=Depends(require_rate_limit),
):
    """Generate situational prompts for response speaking drill."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate {count} conversational situation prompts for a {difficulty}-level English learner.\n"
        "Each prompt presents a real-life situation where someone says something and the learner must respond.\n"
        "Return JSON with a 'prompts' array. Each item has:\n"
        "- situation (string): brief setting (e.g., 'At a restaurant')\n"
        "- speaker_says (string): what the other person says (1-2 sentences)\n"
        "- expected_response_type (string): what kind of response is expected (e.g., 'ordering food', 'greeting')\n"
        "- difficulty (string): the difficulty level\n"
        "Use varied scenarios: hotel, restaurant, airport, doctor, shopping, workplace."
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English conversation coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="response_drill",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Prompt generation failed")

    prompts = result.get("prompts", [])[:count]
    return {
        "prompts": [
            {
                "situation": str(p.get("situation", "General")),
                "speaker_says": str(p.get("speaker_says", "Hello, how can I help you?")),
                "expected_response_type": str(p.get("expected_response_type", "reply")),
                "difficulty": difficulty,
            }
            for p in prompts
        ]
    }


class ResponseDrillEvalRequest(BaseModel):
    situation: str = Field(min_length=1, max_length=500)
    speaker_says: str = Field(min_length=1, max_length=500)
    user_response: str = Field(min_length=1, max_length=2000)


class ResponseDrillEvalResponse(BaseModel):
    appropriateness_score: float
    grammar_score: float
    naturalness_score: float
    overall_score: float
    feedback: str
    model_response: str


@router.post("/response-drill/evaluate", response_model=ResponseDrillEvalResponse)
async def evaluate_response_drill(
    req: ResponseDrillEvalRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a user's spoken response to a situational prompt."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Situation: {req.situation}\n"
        f"Speaker says: \"{req.speaker_says}\"\n"
        f"User responded: \"{req.user_response}\"\n\n"
        "Evaluate the user's response. Return JSON with:\n"
        "- appropriateness_score (number 1-10): how appropriate/relevant is the response\n"
        "- grammar_score (number 1-10): grammar correctness\n"
        "- naturalness_score (number 1-10): how natural the response sounds\n"
        "- overall_score (number 1-10): overall quality\n"
        "- feedback (string): brief constructive feedback\n"
        "- model_response (string): an example of a natural response"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach evaluating conversational responses. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="response_drill_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "appropriateness_score": clamp(result.get("appropriateness_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "naturalness_score": clamp(result.get("naturalness_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "feedback": str(result.get("feedback", "")),
        "model_response": str(result.get("model_response", "")),
    }


# ── Sentence Expand Drill ──────────────────────────────────────

class SentenceExpandSeed(BaseModel):
    seed: str
    context: str
    difficulty: str


class SentenceExpandSeedsResponse(BaseModel):
    seeds: list[SentenceExpandSeed]


@router.get("/sentence-expand", response_model=SentenceExpandSeedsResponse)
async def get_sentence_expand_seeds(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    count: int = Query(default=5, ge=1, le=10),
    _rl=Depends(require_rate_limit),
):
    """Generate short seed sentences for expansion practice."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate {count} short English seed sentences (3-5 words each) at {difficulty} level.\n"
        "The user will expand each seed into a longer, more detailed sentence.\n"
        "Return JSON with a 'seeds' array. Each item has:\n"
        "- seed (string): the short sentence (3-5 words)\n"
        "- context (string): a hint about how to expand it (1 sentence)\n"
        "- difficulty (string): the difficulty level\n"
        "Use varied topics: daily life, travel, work, hobbies, food, weather."
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English fluency coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="sentence_expand",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Seed generation failed")

    seeds = result.get("seeds", [])[:count]
    return {
        "seeds": [
            {
                "seed": str(s.get("seed", "I like coffee.")),
                "context": str(s.get("context", "Add details about when, where, how.")),
                "difficulty": difficulty,
            }
            for s in seeds
        ]
    }


class SentenceExpandEvalRequest(BaseModel):
    seed: str = Field(min_length=1, max_length=200)
    expanded: str = Field(min_length=1, max_length=2000)


class SentenceExpandEvalResponse(BaseModel):
    grammar_score: float
    creativity_score: float
    complexity_score: float
    overall_score: float
    word_count_added: int
    feedback: str
    model_expansion: str


@router.post("/sentence-expand/evaluate", response_model=SentenceExpandEvalResponse)
async def evaluate_sentence_expand(
    req: SentenceExpandEvalRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a user's sentence expansion."""
    copilot = get_copilot_service()
    seed_words = len(req.seed.split())
    expanded_words = len(req.expanded.split())
    prompt_text = (
        f"Seed sentence: \"{req.seed}\"\n"
        f"User's expansion: \"{req.expanded}\"\n\n"
        "Evaluate how well the user expanded the seed sentence. Return JSON with:\n"
        "- grammar_score (number 1-10): grammatical correctness of the expansion\n"
        "- creativity_score (number 1-10): how creative and detailed the expansion is\n"
        "- complexity_score (number 1-10): sentence complexity and vocabulary richness\n"
        "- overall_score (number 1-10): overall quality\n"
        "- feedback (string): brief constructive feedback\n"
        "- model_expansion (string): an example of a great expansion of the seed"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English fluency coach evaluating sentence expansions. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="sentence_expand_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "creativity_score": clamp(result.get("creativity_score", 5)),
        "complexity_score": clamp(result.get("complexity_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "word_count_added": max(0, expanded_words - seed_words),
        "feedback": str(result.get("feedback", "")),
        "model_expansion": str(result.get("model_expansion", "")),
    }


# ── Listen-and-Summarize evaluation ──────────────────────────────

class ListeningSummaryEvalRequest(BaseModel):
    passage: str = Field(..., min_length=10, max_length=5000)
    user_summary: str = Field(..., min_length=3, max_length=2000)


class ListeningSummaryEvalResponse(BaseModel):
    content_coverage_score: float
    accuracy_score: float
    grammar_score: float
    conciseness_score: float
    overall_score: float
    feedback: str
    model_summary: str


@router.post("/listening-summary/evaluate", response_model=ListeningSummaryEvalResponse)
async def evaluate_listening_summary(req: ListeningSummaryEvalRequest, _rl=Depends(require_rate_limit)):
    """Evaluate a user's spoken summary of a listening passage."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Original passage:\n\"{req.passage}\"\n\n"
        f"User's summary:\n\"{req.user_summary}\"\n\n"
        "Evaluate the user's summary of the passage. Return JSON with:\n"
        "- content_coverage_score (number 1-10): how well the summary covers the key points\n"
        "- accuracy_score (number 1-10): factual accuracy relative to the passage\n"
        "- grammar_score (number 1-10): grammar and sentence structure quality\n"
        "- conciseness_score (number 1-10): how concise and well-organized the summary is\n"
        "- overall_score (number 1-10): overall quality\n"
        "- feedback (string): brief constructive feedback on how to improve\n"
        "- model_summary (string): a concise model summary of the passage for comparison"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English fluency coach evaluating listening comprehension summaries. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="listening_summary_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "content_coverage_score": clamp(result.get("content_coverage_score", 5)),
        "accuracy_score": clamp(result.get("accuracy_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "conciseness_score": clamp(result.get("conciseness_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "feedback": str(result.get("feedback", "")),
        "model_summary": str(result.get("model_summary", "")),
    }


# ── Listening Discussion ──────────────────────────────────────────

class ListeningDiscussionQuestionRequest(BaseModel):
    passage: str = Field(..., min_length=10, max_length=5000)


class ListeningDiscussionQuestionResponse(BaseModel):
    question: str
    hints: list[str]


class ListeningDiscussionEvalRequest(BaseModel):
    passage: str = Field(..., min_length=10, max_length=5000)
    question: str = Field(..., min_length=5, max_length=1000)
    user_response: str = Field(..., min_length=3, max_length=3000)
    duration_seconds: float = Field(default=0, ge=0)


class ListeningDiscussionEvalResponse(BaseModel):
    argument_score: float
    relevance_score: float
    grammar_score: float
    vocabulary_score: float
    overall_score: float
    feedback: str
    model_answer: str


@router.post("/listening-discussion/question", response_model=ListeningDiscussionQuestionResponse)
async def generate_listening_discussion_question(req: ListeningDiscussionQuestionRequest, _rl=Depends(require_rate_limit)):
    """Generate a discussion question based on a listening passage."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Passage:\n\"{req.passage}\"\n\n"
        "Based on this passage, create ONE thought-provoking discussion question that asks the learner "
        "to express their personal opinion about the topic. Also provide 2-3 short starter phrases "
        "they could use to begin their response.\n"
        "Return JSON with:\n"
        "- question (string): the discussion question\n"
        "- hints (array of strings): 2-3 starter phrases like 'I think...', 'In my opinion...'"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English discussion facilitator. Generate discussion questions for listening passages. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="listening_discussion_question",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Question generation failed")

    hints = result.get("hints", ["I think...", "In my opinion..."])
    if not isinstance(hints, list):
        hints = ["I think...", "In my opinion..."]

    return {
        "question": str(result.get("question", "What do you think about the topic discussed in the passage?")),
        "hints": [str(h) for h in hints[:3]],
    }


@router.post("/listening-discussion/evaluate", response_model=ListeningDiscussionEvalResponse)
async def evaluate_listening_discussion(req: ListeningDiscussionEvalRequest, _rl=Depends(require_rate_limit)):
    """Evaluate a user's spoken discussion response about a listening passage."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Original passage:\n\"{req.passage}\"\n\n"
        f"Discussion question:\n\"{req.question}\"\n\n"
        f"User's spoken response:\n\"{req.user_response}\"\n\n"
        f"Speaking duration: {req.duration_seconds:.1f} seconds\n\n"
        "Evaluate the user's response. Return JSON with:\n"
        "- argument_score (number 1-10): coherence and depth of their opinion/argument\n"
        "- relevance_score (number 1-10): how well it connects to the passage topic\n"
        "- grammar_score (number 1-10): grammar and sentence structure quality\n"
        "- vocabulary_score (number 1-10): range and appropriateness of vocabulary\n"
        "- overall_score (number 1-10): overall quality\n"
        "- feedback (string): brief constructive feedback\n"
        "- model_answer (string): a model response to the discussion question for comparison"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English fluency coach evaluating spoken discussion responses. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="listening_discussion_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "argument_score": clamp(result.get("argument_score", 5)),
        "relevance_score": clamp(result.get("relevance_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "vocabulary_score": clamp(result.get("vocabulary_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "feedback": str(result.get("feedback", "")),
        "model_answer": str(result.get("model_answer", "")),
    }


# ── Sentence Transform Drill ──────────────────────────────────────

class SentenceTransformExercise(BaseModel):
    original_sentence: str
    transformation_type: str
    instruction: str
    expected_answer: str
    difficulty: str


class SentenceTransformExercisesResponse(BaseModel):
    exercises: list[SentenceTransformExercise]


@router.get("/sentence-transform", response_model=SentenceTransformExercisesResponse)
async def get_sentence_transform_exercises(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    count: int = Query(default=5, ge=1, le=10),
    _rl=Depends(require_rate_limit),
):
    """Generate sentence transformation exercises for grammar+speaking drill."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate {count} sentence transformation exercises for a {difficulty}-level English learner.\n"
        "Each exercise gives a sentence and a grammar transformation the learner must apply while speaking.\n"
        "Return JSON with an 'exercises' array. Each item has:\n"
        "- original_sentence (string): the starting sentence (1-2 sentences)\n"
        "- transformation_type (string): short label like 'past tense', 'question', 'passive voice', 'negative', 'conditional', 'reported speech'\n"
        "- instruction (string): clear instruction, e.g., 'Change this sentence to the past tense'\n"
        "- expected_answer (string): the correct transformed sentence\n"
        "- difficulty (string): the difficulty level\n"
        "Use varied transformation types. Keep sentences natural and practical."
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English grammar coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="sentence_transform",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Exercise generation failed")

    exercises = result.get("exercises", [])[:count]
    return {
        "exercises": [
            {
                "original_sentence": str(e.get("original_sentence", "I go to school every day.")),
                "transformation_type": str(e.get("transformation_type", "past tense")),
                "instruction": str(e.get("instruction", "Change to past tense")),
                "expected_answer": str(e.get("expected_answer", "I went to school every day.")),
                "difficulty": difficulty,
            }
            for e in exercises
        ]
    }


class SentenceTransformEvalRequest(BaseModel):
    original_sentence: str = Field(min_length=1, max_length=500)
    transformation_type: str = Field(min_length=1, max_length=100)
    expected_answer: str = Field(min_length=1, max_length=500)
    user_response: str = Field(min_length=1, max_length=2000)


class SentenceTransformEvalResponse(BaseModel):
    grammar_score: float
    transformation_score: float
    naturalness_score: float
    overall_score: float
    feedback: str
    correct_version: str


@router.post("/sentence-transform/evaluate", response_model=SentenceTransformEvalResponse)
async def evaluate_sentence_transform(
    req: SentenceTransformEvalRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a user's spoken sentence transformation."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Original sentence: \"{req.original_sentence}\"\n"
        f"Transformation required: {req.transformation_type}\n"
        f"Expected answer: \"{req.expected_answer}\"\n"
        f"User said: \"{req.user_response}\"\n\n"
        "Evaluate the user's transformation. Return JSON with:\n"
        "- grammar_score (number 1-10): grammar correctness of the transformed sentence\n"
        "- transformation_score (number 1-10): how correctly the transformation was applied\n"
        "- naturalness_score (number 1-10): how natural the result sounds\n"
        "- overall_score (number 1-10): overall quality\n"
        "- feedback (string): brief constructive feedback\n"
        "- correct_version (string): the correct transformed sentence"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English grammar coach evaluating sentence transformations. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="sentence_transform_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "transformation_score": clamp(result.get("transformation_score", 5)),
        "naturalness_score": clamp(result.get("naturalness_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "feedback": str(result.get("feedback", "")),
        "correct_version": str(result.get("correct_version", req.expected_answer)),
    }


# ── Listening Spoken Q&A Drill ──────────────────────────────────────

class ListeningQAEvalRequest(BaseModel):
    passage: str = Field(min_length=1, max_length=5000)
    question: str = Field(min_length=1, max_length=500)
    correct_answer: str = Field(min_length=1, max_length=500)
    user_spoken_answer: str = Field(min_length=1, max_length=2000)


class ListeningQAEvalResponse(BaseModel):
    content_accuracy_score: float
    grammar_score: float
    vocabulary_score: float
    overall_score: float
    feedback: str
    model_answer: str


@router.post("/listening-qa/evaluate", response_model=ListeningQAEvalResponse)
async def evaluate_listening_qa(
    req: ListeningQAEvalRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a spoken answer to a listening comprehension question."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Listening passage: \"{req.passage[:1000]}\"\n"
        f"Question: \"{req.question}\"\n"
        f"Correct answer: \"{req.correct_answer}\"\n"
        f"User spoke: \"{req.user_spoken_answer}\"\n\n"
        "Evaluate the user's spoken answer to this listening comprehension question. Return JSON with:\n"
        "- content_accuracy_score (number 1-10): how accurately they answered the question\n"
        "- grammar_score (number 1-10): grammar correctness of their spoken answer\n"
        "- vocabulary_score (number 1-10): vocabulary usage quality\n"
        "- overall_score (number 1-10): overall quality\n"
        "- feedback (string): brief constructive feedback\n"
        "- model_answer (string): an example of a good spoken answer to this question"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English comprehension coach evaluating spoken answers. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="listening_qa_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "content_accuracy_score": clamp(result.get("content_accuracy_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "vocabulary_score": clamp(result.get("vocabulary_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "feedback": str(result.get("feedback", "")),
        "model_answer": str(result.get("model_answer", "")),
    }


# --- Quick Listen & Respond ---

class ListenRespondPromptResponse(BaseModel):
    question: str
    difficulty: str
    topic_hint: str


@router.get("/listen-respond-prompt", response_model=ListenRespondPromptResponse)
async def get_listen_respond_prompt(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate a conversational question for listen-and-respond exercise."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a conversational question for a {difficulty}-level English learner.\n"
        "The question should require a thoughtful spoken response (not yes/no).\n"
        "Return JSON with:\n"
        "- question (string): a natural conversational question (1-2 sentences)\n"
        "- topic_hint (string): the topic area (e.g. 'daily life', 'travel', 'work')\n"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English conversation coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="listen_respond_prompt",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Prompt generation failed")

    return {
        "question": str(result.get("question", "What do you usually do on weekends?")),
        "difficulty": difficulty,
        "topic_hint": str(result.get("topic_hint", "daily life")),
    }


class ListenRespondEvaluateRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    transcript: str = Field(min_length=1, max_length=2000)
    duration_seconds: int = Field(ge=1, le=120)


class ListenRespondEvaluateResponse(BaseModel):
    comprehension_score: float
    relevance_score: float
    grammar_score: float
    fluency_score: float
    overall_score: float
    feedback: str
    model_answer: str


@router.post("/listen-respond/evaluate", response_model=ListenRespondEvaluateResponse)
async def evaluate_listen_respond(
    body: ListenRespondEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a listen-and-respond attempt."""
    word_count = len(body.transcript.split())
    copilot = get_copilot_service()
    eval_prompt = (
        f"Question asked (audio only, user had to listen): \"{body.question}\"\n"
        f"User's spoken response ({body.duration_seconds}s, {word_count} words):\n"
        f"\"{body.transcript}\"\n\n"
        "Evaluate whether the user understood the question and responded appropriately.\n"
        "Return JSON with:\n"
        "- comprehension_score (1-10): did they understand the question?\n"
        "- relevance_score (1-10): how relevant is their response?\n"
        "- grammar_score (1-10): grammatical accuracy\n"
        "- fluency_score (1-10): natural flow of speech\n"
        "- overall_score (1-10): overall quality\n"
        "- feedback (string): encouraging feedback (2-3 sentences)\n"
        "- model_answer (string): an example good response (1-2 sentences)"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach. Return ONLY valid JSON.",
                eval_prompt,
            ),
            context="listen_respond_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "comprehension_score": clamp(result.get("comprehension_score", 5)),
        "relevance_score": clamp(result.get("relevance_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "fluency_score": clamp(result.get("fluency_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "feedback": str(result.get("feedback", "")),
        "model_answer": str(result.get("model_answer", "")),
    }


class QuickRephrasePromptResponse(BaseModel):
    original_sentence: str
    instruction: str
    difficulty: str


@router.get("/quick-rephrase", response_model=QuickRephrasePromptResponse)
async def get_quick_rephrase_prompt(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate a sentence with rephrase instruction for quick practice."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a {difficulty}-level English sentence for a rephrase exercise.\n"
        "The learner will rewrite the sentence using different words while keeping the same meaning.\n"
        "Return JSON with:\n"
        "- original_sentence (string): a natural English sentence (8-20 words)\n"
        "- instruction (string): a brief instruction like 'Use a synonym for the underlined word' "
        "or 'Change the sentence structure' or 'Make it more formal' (1 short sentence)\n"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English teacher creating rephrase exercises. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="quick_rephrase_prompt",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Prompt generation failed")

    return {
        "original_sentence": str(result.get("original_sentence", "The weather is really nice today.")),
        "instruction": str(result.get("instruction", "Rephrase using different words while keeping the same meaning.")),
        "difficulty": difficulty,
    }


# ── Quick Opinion Practice ──────────────────────────────────────


class OpinionPromptResponse(BaseModel):
    question: str
    hint: str
    difficulty: str
    discourse_markers: list[str]


@router.get("/opinion-prompt", response_model=OpinionPromptResponse)
async def get_opinion_prompt(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate a debatable opinion question for speaking practice."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a debatable opinion question for a {difficulty}-level English learner.\n"
        "The question should invite the learner to state and defend a personal opinion.\n"
        "Return JSON with:\n"
        "- question (string): a debatable question (1-2 sentences)\n"
        "- hint (string): brief hint on how to structure the answer (1 sentence)\n"
        "- difficulty (string): the difficulty level\n"
        "- discourse_markers (array of 4 strings): helpful discourse markers like 'I believe...', 'On the other hand...'"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="opinion_prompt",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Prompt generation failed")

    return {
        "question": str(result.get("question", "Do you prefer working from home or in an office?")),
        "hint": str(result.get("hint", "State your position clearly, then give reasons.")),
        "difficulty": difficulty,
        "discourse_markers": [str(m) for m in result.get("discourse_markers", ["I believe...", "For example...", "On the other hand...", "In conclusion..."])[:4]],
    }


class OpinionEvaluateRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    transcript: str = Field(min_length=1, max_length=2000)
    duration_seconds: int = Field(ge=1, le=120)


class OpinionEvaluateResponse(BaseModel):
    argument_structure_score: float
    coherence_score: float
    grammar_score: float
    vocabulary_score: float
    overall_score: float
    word_count: int
    wpm: float
    feedback: str
    model_answer: str


@router.post("/opinion-prompt/evaluate", response_model=OpinionEvaluateResponse)
async def evaluate_opinion(
    body: OpinionEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a spoken opinion attempt."""
    word_count = len(body.transcript.split())
    wpm = round(word_count / (body.duration_seconds / 60), 1) if body.duration_seconds > 0 else 0

    copilot = get_copilot_service()
    eval_prompt = (
        f"Opinion question: \"{body.question}\"\n"
        f"User's spoken response ({body.duration_seconds}s, {word_count} words, {wpm} WPM):\n"
        f"\"{body.transcript}\"\n\n"
        "Evaluate this opinion response. Return JSON with:\n"
        "- argument_structure_score (1-10): clear position statement + supporting reasons\n"
        "- coherence_score (1-10): logical flow and use of discourse markers\n"
        "- grammar_score (1-10): grammatical accuracy\n"
        "- vocabulary_score (1-10): range and appropriateness of vocabulary\n"
        "- overall_score (1-10): overall quality of the opinion expression\n"
        "- feedback (string): encouraging feedback (2-3 sentences)\n"
        "- model_answer (string): a well-structured model answer to the question (3-4 sentences)"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach specializing in argumentation. Return ONLY valid JSON.",
                eval_prompt,
            ),
            context="opinion_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "argument_structure_score": clamp(result.get("argument_structure_score", 5)),
        "coherence_score": clamp(result.get("coherence_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "vocabulary_score": clamp(result.get("vocabulary_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "word_count": word_count,
        "wpm": wpm,
        "feedback": str(result.get("feedback", "")),
        "model_answer": str(result.get("model_answer", "")),
    }


# ── Quick Question Formation ────────────────────────────────────


class QuestionFormationPromptResponse(BaseModel):
    answer_sentence: str
    expected_question: str
    hint: str
    difficulty: str


@router.get("/question-formation", response_model=QuestionFormationPromptResponse)
async def get_question_formation_prompt(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate an answer sentence for the learner to form the corresponding question."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a question formation exercise for a {difficulty}-level English learner.\n"
        "Provide an answer sentence and the question that would produce that answer.\n"
        "Return JSON with:\n"
        "- answer_sentence (string): a statement/answer (e.g., 'I have been living here for 5 years.')\n"
        "- expected_question (string): the correct question (e.g., 'How long have you been living here?')\n"
        "- hint (string): a brief hint about the question type (e.g., 'Use a wh-question with how long')\n"
        "- difficulty (string): the difficulty level"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English grammar coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="question_formation_prompt",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Prompt generation failed")

    return {
        "answer_sentence": str(result.get("answer_sentence", "I go to the gym three times a week.")),
        "expected_question": str(result.get("expected_question", "How often do you go to the gym?")),
        "hint": str(result.get("hint", "Ask about frequency.")),
        "difficulty": difficulty,
    }


class QuestionFormationEvaluateRequest(BaseModel):
    answer_sentence: str = Field(min_length=1, max_length=500)
    expected_question: str = Field(min_length=1, max_length=500)
    user_question: str = Field(min_length=1, max_length=1000)


class QuestionFormationEvaluateResponse(BaseModel):
    grammar_score: float
    accuracy_score: float
    naturalness_score: float
    overall_score: float
    feedback: str
    corrected_question: str


@router.post("/question-formation/evaluate", response_model=QuestionFormationEvaluateResponse)
async def evaluate_question_formation(
    body: QuestionFormationEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a learner's question formation attempt."""
    copilot = get_copilot_service()
    eval_prompt = (
        f"Answer sentence: \"{body.answer_sentence}\"\n"
        f"Expected question: \"{body.expected_question}\"\n"
        f"Learner's question: \"{body.user_question}\"\n\n"
        "Evaluate this question formation attempt. Return JSON with:\n"
        "- grammar_score (1-10): grammatical correctness of the question\n"
        "- accuracy_score (1-10): does the question correctly target the answer\n"
        "- naturalness_score (1-10): does it sound natural in English\n"
        "- overall_score (1-10): overall quality\n"
        "- feedback (string): encouraging feedback (2-3 sentences)\n"
        "- corrected_question (string): the best version of the question"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English grammar coach. Return ONLY valid JSON.",
                eval_prompt,
            ),
            context="question_formation_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "accuracy_score": clamp(result.get("accuracy_score", 5)),
        "naturalness_score": clamp(result.get("naturalness_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "feedback": str(result.get("feedback", "")),
        "corrected_question": str(result.get("corrected_question", body.expected_question)),
    }


# ── Quick Storytelling ────────────────────────────────────


class StoryPromptResponse(BaseModel):
    story_beginning: str
    suggested_words: list[str]
    difficulty: str


@router.get("/story-prompt", response_model=StoryPromptResponse)
async def get_story_prompt(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate a story beginning for storytelling speaking practice."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a creative story beginning for a {difficulty}-level English learner.\n"
        "The opening should be 1-2 sentences that set a scene and invite continuation.\n"
        "Return JSON with:\n"
        "- story_beginning (string): an engaging opening 1-2 sentences\n"
        "- suggested_words (array of 5 strings): useful narrative vocabulary/phrases "
        "like 'suddenly', 'after that', 'meanwhile'\n"
        "- difficulty (string): the difficulty level"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach specializing in narrative skills. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="story_prompt",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Story prompt generation failed")

    return {
        "story_beginning": str(result.get("story_beginning", "Last weekend, I was walking through an old market when I noticed something unusual...")),
        "suggested_words": [str(w) for w in result.get("suggested_words", ["suddenly", "after that", "meanwhile", "finally", "to my surprise"])[:5]],
        "difficulty": difficulty,
    }


class StoryEvaluateRequest(BaseModel):
    story_beginning: str = Field(min_length=1, max_length=500)
    transcript: str = Field(min_length=1, max_length=3000)
    duration_seconds: int = Field(ge=1, le=120)


class StoryEvaluateResponse(BaseModel):
    coherence_score: float
    grammar_score: float
    vocabulary_score: float
    narrative_flow_score: float
    overall_score: float
    word_count: int
    wpm: float
    feedback: str
    model_continuation: str


@router.post("/story-prompt/evaluate", response_model=StoryEvaluateResponse)
async def evaluate_story(
    body: StoryEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a spoken story continuation."""
    word_count = len(body.transcript.split())
    wpm = round(word_count / (body.duration_seconds / 60), 1) if body.duration_seconds > 0 else 0

    copilot = get_copilot_service()
    eval_prompt = (
        f"Story beginning: \"{body.story_beginning}\"\n"
        f"User's spoken continuation ({body.duration_seconds}s, {word_count} words, {wpm} WPM):\n"
        f"\"{body.transcript}\"\n\n"
        "Evaluate this story continuation. Return JSON with:\n"
        "- coherence_score (1-10): logical connection to the story opening\n"
        "- grammar_score (1-10): grammatical accuracy including correct tenses\n"
        "- vocabulary_score (1-10): range and richness of descriptive language\n"
        "- narrative_flow_score (1-10): use of sequencing language (then, after that, finally) and pacing\n"
        "- overall_score (1-10): overall quality of the story continuation\n"
        "- feedback (string): encouraging feedback (2-3 sentences)\n"
        "- model_continuation (string): a well-crafted model continuation (3-4 sentences)"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English speaking coach specializing in narrative storytelling. Return ONLY valid JSON.",
                eval_prompt,
            ),
            context="story_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Story evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "coherence_score": clamp(result.get("coherence_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "vocabulary_score": clamp(result.get("vocabulary_score", 5)),
        "narrative_flow_score": clamp(result.get("narrative_flow_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "word_count": word_count,
        "wpm": wpm,
        "feedback": str(result.get("feedback", "")),
        "model_continuation": str(result.get("model_continuation", "")),
    }


# ── Quick Follow-Up Question ────────────────────────────────────


class FollowUpPromptResponse(BaseModel):
    statement: str
    topic_hint: str
    difficulty: str


@router.get("/follow-up-prompt", response_model=FollowUpPromptResponse)
async def get_follow_up_prompt(
    difficulty: str = Query(default="intermediate", pattern="^(beginner|intermediate|advanced)$"),
    _rl=Depends(require_rate_limit),
):
    """Generate a conversational statement for follow-up question practice."""
    copilot = get_copilot_service()
    prompt_text = (
        f"Generate a conversational statement that a {difficulty}-level English learner "
        "could ask a natural follow-up question about.\n"
        "The statement should be 1-2 sentences that share a personal experience or opinion.\n"
        "Return JSON with:\n"
        "- statement (string): a conversational statement (1-2 sentences)\n"
        "- topic_hint (string): brief topic category like 'hobbies', 'travel', 'work'\n"
        "- difficulty (string): the difficulty level"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English conversation coach. Return ONLY valid JSON.",
                prompt_text,
            ),
            context="follow_up_prompt",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Follow-up prompt generation failed")

    return {
        "statement": str(result.get("statement", "I just got back from a two-week trip to Japan.")),
        "topic_hint": str(result.get("topic_hint", "travel")),
        "difficulty": difficulty,
    }


class FollowUpEvaluateRequest(BaseModel):
    statement: str = Field(min_length=1, max_length=500)
    user_question: str = Field(min_length=1, max_length=2000)
    duration_seconds: int = Field(ge=1, le=120)


class FollowUpEvaluateResponse(BaseModel):
    relevance_score: float
    depth_score: float
    grammar_score: float
    naturalness_score: float
    overall_score: float
    word_count: int
    wpm: float
    feedback: str
    model_questions: list[str]


@router.post("/follow-up-prompt/evaluate", response_model=FollowUpEvaluateResponse)
async def evaluate_follow_up(
    body: FollowUpEvaluateRequest,
    _rl=Depends(require_rate_limit),
):
    """Evaluate a spoken follow-up question attempt."""
    word_count = len(body.user_question.split())
    wpm = round(word_count / (body.duration_seconds / 60), 1) if body.duration_seconds > 0 else 0

    copilot = get_copilot_service()
    eval_prompt = (
        f"Original statement: \"{body.statement}\"\n"
        f"User's follow-up question ({body.duration_seconds}s, {word_count} words):\n"
        f"\"{body.user_question}\"\n\n"
        "Evaluate this follow-up question. Return JSON with:\n"
        "- relevance_score (1-10): how relevant the question is to the statement\n"
        "- depth_score (1-10): how thoughtful and engaging the question is\n"
        "- grammar_score (1-10): grammatical accuracy of the question\n"
        "- naturalness_score (1-10): how natural the question sounds in conversation\n"
        "- overall_score (1-10): overall quality\n"
        "- feedback (string): encouraging feedback (2-3 sentences)\n"
        "- model_questions (array of 3 strings): example good follow-up questions"
    )
    try:
        result = await safe_llm_call(
            lambda: copilot.ask_json(
                "You are an English conversation coach specializing in active listening. Return ONLY valid JSON.",
                eval_prompt,
            ),
            context="follow_up_evaluate",
        )
    except HTTPException:
        raise HTTPException(status_code=502, detail="Follow-up evaluation failed")

    def clamp(val: Any, lo: float = 1, hi: float = 10) -> float:
        try:
            return min(hi, max(lo, float(val)))
        except (ValueError, TypeError):
            return 5.0

    return {
        "relevance_score": clamp(result.get("relevance_score", 5)),
        "depth_score": clamp(result.get("depth_score", 5)),
        "grammar_score": clamp(result.get("grammar_score", 5)),
        "naturalness_score": clamp(result.get("naturalness_score", 5)),
        "overall_score": clamp(result.get("overall_score", 5)),
        "word_count": word_count,
        "wpm": wpm,
        "feedback": str(result.get("feedback", "")),
        "model_questions": [str(q) for q in result.get("model_questions", ["What was your favorite part?", "How did you feel about it?", "Would you do it again?"])[:3]],
    }


# ---------------------------------------------------------------------------
# Speaking Journal
# ---------------------------------------------------------------------------

_SPEAKING_JOURNAL_PROMPTS_BY_DIFFICULTY: dict[str, list[str]] = {
    "beginner": [
        "Describe your morning routine.",
        "Talk about your favorite food.",
        "What do you do on weekends?",
        "Describe your best friend.",
        "Talk about your family.",
        "What is your favorite animal and why?",
        "Describe the weather today.",
        "What do you like to do after work or school?",
        "Talk about your favorite place in your city.",
        "Describe what you had for breakfast.",
    ],
    "intermediate": [
        "Describe your ideal weekend.",
        "Talk about a skill you want to learn.",
        "Describe your favorite place to relax.",
        "What would you do with an extra hour each day?",
        "Talk about a book or movie that changed your perspective.",
        "Describe a memorable meal you've had.",
        "What advice would you give your younger self?",
        "Talk about a hobby you enjoy.",
        "What does a perfect vacation look like for you?",
        "Talk about someone who inspires you.",
    ],
    "advanced": [
        "Describe a challenge you've overcome.",
        "Talk about a cultural difference you find interesting.",
        "What would your dream job look like?",
        "Talk about a lesson you learned the hard way.",
        "What makes a good friend?",
        "Talk about a technology that amazes you.",
        "Describe a tradition you enjoy and its significance.",
        "What societal change would you like to see in the next decade?",
        "Talk about a time when failure taught you more than success.",
        "Describe how your perspective on life has changed over the years.",
    ],
}

_SPEAKING_JOURNAL_PROMPTS = [
    p for prompts in _SPEAKING_JOURNAL_PROMPTS_BY_DIFFICULTY.values() for p in prompts
]


class SpeakingJournalEntry(BaseModel):
    prompt: str
    transcript: str
    duration_seconds: int = Field(ge=1)


class SpeakingJournalEntryResponse(BaseModel):
    id: int
    prompt: str
    transcript: str
    word_count: int
    unique_word_count: int
    duration_seconds: int
    wpm: float
    filler_word_count: int = 0
    created_at: str


class SpeakingJournalEntriesResponse(BaseModel):
    entries: list[SpeakingJournalEntryResponse]


@router.get("/speaking-journal/prompt")
async def get_speaking_journal_prompt(
    db: aiosqlite.Connection = Depends(get_db_session),
    exclude: str | None = Query(None, description="Current prompt to exclude"),
    difficulty: str | None = Query(None, description="Difficulty level: beginner, intermediate, advanced"),
):
    """Get a speaking journal prompt, avoiding today's already-used prompts."""
    import random

    pool = _SPEAKING_JOURNAL_PROMPTS
    if difficulty and difficulty in _SPEAKING_JOURNAL_PROMPTS_BY_DIFFICULTY:
        pool = _SPEAKING_JOURNAL_PROMPTS_BY_DIFFICULTY[difficulty]

    used = await pron_dal.get_today_used_journal_prompts(db)
    if exclude and exclude not in used:
        used.append(exclude)
    available = [p for p in pool if p not in used]
    if not available:
        available = [p for p in pool if p != exclude]
    if not available:
        available = list(pool)
    prompt = random.choice(available)
    return {"prompt": prompt}


_FILLER_WORDS = re.compile(
    r"\b(?:um|uh|erm|er|ah|like|you know|basically|i mean|sort of|kind of|actually|literally|right|okay so|well)\b",
    re.IGNORECASE,
)


def _count_filler_words(transcript: str) -> int:
    """Count common English filler words in a transcript."""
    return len(_FILLER_WORDS.findall(transcript))


@router.post("/speaking-journal", response_model=SpeakingJournalEntryResponse)
async def save_speaking_journal(
    entry: SpeakingJournalEntry,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Save a speaking journal entry with computed metrics."""
    words = entry.transcript.split()
    word_count = len(words)
    unique_word_count = len(set(w.lower().strip(".,!?;:'\"") for w in words if w.strip(".,!?;:'\"") ))
    wpm = round((word_count / max(entry.duration_seconds, 1)) * 60, 1)
    filler_word_count = _count_filler_words(entry.transcript)

    result = await pron_dal.save_speaking_journal_entry(
        db,
        prompt=entry.prompt,
        transcript=entry.transcript,
        word_count=word_count,
        unique_word_count=unique_word_count,
        duration_seconds=entry.duration_seconds,
        wpm=wpm,
        filler_word_count=filler_word_count,
    )
    return {
        "id": result["id"],
        "prompt": entry.prompt,
        "transcript": entry.transcript,
        "word_count": word_count,
        "unique_word_count": unique_word_count,
        "duration_seconds": entry.duration_seconds,
        "wpm": wpm,
        "filler_word_count": filler_word_count,
        "created_at": "",
    }


@router.get("/speaking-journal/entries", response_model=SpeakingJournalEntriesResponse)
async def get_speaking_journal_entries(
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get recent speaking journal entries."""
    entries = await pron_dal.get_speaking_journal_entries(db, limit=limit)
    return {"entries": entries}


class SpeakingJournalEntrySummary(BaseModel):
    id: int
    word_count: int
    wpm: float
    duration_seconds: int
    vocabulary_diversity: float
    created_at: str


class SpeakingJournalDateStats(BaseModel):
    date: str
    count: int
    avg_wpm: float
    avg_vocabulary_diversity: float


class SpeakingJournalProgressResponse(BaseModel):
    total_entries: int
    total_speaking_time_seconds: int
    avg_wpm: float
    avg_vocabulary_diversity: float
    wpm_trend: str
    entries_by_date: list[SpeakingJournalDateStats]
    longest_entry: SpeakingJournalEntrySummary | None
    highest_wpm: SpeakingJournalEntrySummary | None
    best_vocabulary_diversity: SpeakingJournalEntrySummary | None


@router.get("/speaking-journal/progress", response_model=SpeakingJournalProgressResponse)
async def get_speaking_journal_progress(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get speaking journal progress analytics."""
    return await pron_dal.get_speaking_journal_progress(db)


class FillerWordItem(BaseModel):
    word: str
    count: int


class FillerDailyTrend(BaseModel):
    date: str
    filler_count: int
    density_per_min: float
    entries: int


class FillerAnalysisResponse(BaseModel):
    total_entries: int
    filler_breakdown: list[FillerWordItem]
    daily_trend: list[FillerDailyTrend]
    trend_direction: str
    fluency_cleanliness_score: int


@router.get("/speaking-journal/filler-analysis", response_model=FillerAnalysisResponse)
async def get_filler_analysis(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Analyze filler word patterns across speaking journal entries."""
    return await pron_dal.get_filler_word_analysis(db)


class VocabUpgradeRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=5000)


class VocabUpgradeItem(BaseModel):
    original: str
    upgraded: str
    explanation: str
    example: str


class VocabUpgradeResponse(BaseModel):
    upgrades: list[VocabUpgradeItem]


@router.post("/speaking-journal/vocab-upgrade", response_model=VocabUpgradeResponse)
async def get_vocab_upgrade_suggestions(
    req: VocabUpgradeRequest,
    _rl=Depends(require_rate_limit),
):
    """Analyze a speaking journal transcript and suggest vocabulary upgrades."""
    copilot = get_copilot_service()

    prompt = (
        "Analyze this English speech transcript and find 3-5 basic or common words "
        "that the speaker used. For each word, suggest a more advanced or sophisticated "
        "alternative that would make their speech sound more natural and fluent.\n\n"
        f"Transcript: \"{req.transcript}\"\n\n"
        "Return JSON with this exact structure:\n"
        '{"upgrades": [{"original": "basic word from transcript", '
        '"upgraded": "better alternative", '
        '"explanation": "why the upgrade is better", '
        '"example": "example sentence using the upgraded word"}]}\n\n'
        "Rules:\n"
        "- Only pick words that actually appear in the transcript\n"
        "- Suggest natural, commonly-used alternatives (not obscure words)\n"
        "- Keep explanations concise (one sentence)\n"
        "- Return 3-5 upgrades. If the transcript is too short, return fewer."
    )

    result = await safe_llm_call(
        lambda: copilot.ask_json(
            "You are an English vocabulary coach. Return ONLY valid JSON.",
            prompt,
        ),
        context="vocab_upgrade",
    )

    if not result or "upgrades" not in result:
        return VocabUpgradeResponse(upgrades=[])

    upgrades = []
    for item in result.get("upgrades", [])[:5]:
        if all(k in item for k in ("original", "upgraded", "explanation", "example")):
            upgrades.append(VocabUpgradeItem(
                original=str(item["original"]),
                upgraded=str(item["upgraded"]),
                explanation=str(item["explanation"]),
                example=str(item["example"]),
            ))

    return VocabUpgradeResponse(upgrades=upgrades)


class GrammarCheckRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=5000)


class GrammarCorrection(BaseModel):
    original: str
    corrected: str
    explanation: str


class GrammarCheckResponse(BaseModel):
    grammar_score: float
    corrections: list[GrammarCorrection]
    overall_feedback: str


@router.post("/speaking-journal/grammar-check", response_model=GrammarCheckResponse)
async def get_grammar_check(
    req: GrammarCheckRequest,
    _rl=Depends(require_rate_limit),
):
    """Analyze a speaking journal transcript for grammar errors."""
    copilot = get_copilot_service()

    prompt = (
        "Analyze this English speech transcript for grammar errors. "
        "Find any grammatical mistakes, awkward phrasing, or incorrect word usage.\n\n"
        f"Transcript: \"{req.transcript}\"\n\n"
        "Return JSON with this exact structure:\n"
        '{"grammar_score": 8.5, '
        '"corrections": [{"original": "phrase with error", '
        '"corrected": "corrected phrase", '
        '"explanation": "why this is wrong"}], '
        '"overall_feedback": "brief overall assessment"}\n\n'
        "Rules:\n"
        "- grammar_score is 0-10 (10 = perfect grammar)\n"
        "- Only flag genuine grammar errors, not stylistic preferences\n"
        "- Keep explanations concise (one sentence)\n"
        "- If the transcript has perfect grammar, return score 10 with empty corrections\n"
        "- Return at most 5 corrections, prioritizing the most important ones"
    )

    result = await safe_llm_call(
        lambda: copilot.ask_json(
            "You are an English grammar teacher. Return ONLY valid JSON.",
            prompt,
        ),
        context="grammar_check",
    )

    if not result or "grammar_score" not in result:
        return GrammarCheckResponse(
            grammar_score=0.0,
            corrections=[],
            overall_feedback="Unable to analyze grammar at this time.",
        )

    corrections = []
    for item in result.get("corrections", [])[:5]:
        if all(k in item for k in ("original", "corrected", "explanation")):
            corrections.append(GrammarCorrection(
                original=str(item["original"]),
                corrected=str(item["corrected"]),
                explanation=str(item["explanation"]),
            ))

    score = float(result.get("grammar_score", 0))
    score = max(0.0, min(10.0, score))

    return GrammarCheckResponse(
        grammar_score=score,
        corrections=corrections,
        overall_feedback=str(result.get("overall_feedback", "")),
    )


class ModelAnswerRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    user_transcript: str = Field(min_length=1, max_length=5000)


class ModelAnswerResponse(BaseModel):
    model_answer: str
    key_phrases: list[str]
    comparison_tip: str


@router.post("/speaking-journal/model-answer", response_model=ModelAnswerResponse)
async def get_model_answer(
    req: ModelAnswerRequest,
    _rl=Depends(require_rate_limit),
):
    """Generate a model answer for the speaking journal prompt."""
    copilot = get_copilot_service()

    llm_prompt = (
        "A learner was given this speaking prompt and recorded their response. "
        "Generate a natural, fluent model answer to the same prompt.\n\n"
        f"Prompt: \"{req.prompt}\"\n"
        f"Learner's response: \"{req.user_transcript}\"\n\n"
        "Return JSON with this exact structure:\n"
        '{"model_answer": "A natural, fluent 3-5 sentence response to the prompt", '
        '"key_phrases": ["useful phrase 1", "useful phrase 2", "useful phrase 3"], '
        '"comparison_tip": "Brief tip comparing their attempt with the model"}\n\n'
        "Rules:\n"
        "- The model answer should be natural and conversational (B2-C1 level)\n"
        "- Pick 3-4 key phrases from the model answer worth learning\n"
        "- Keep the comparison tip encouraging and constructive (one sentence)\n"
        "- Do NOT repeat the learner's exact words in the model answer"
    )

    result = await safe_llm_call(
        lambda: copilot.ask_json(
            "You are an English speaking coach. Return ONLY valid JSON.",
            llm_prompt,
        ),
        context="model_answer",
    )

    if not result or "model_answer" not in result:
        return ModelAnswerResponse(
            model_answer="",
            key_phrases=[],
            comparison_tip="Unable to generate model answer at this time.",
        )

    key_phrases = [str(p) for p in result.get("key_phrases", [])[:5]]

    return ModelAnswerResponse(
        model_answer=str(result.get("model_answer", "")),
        key_phrases=key_phrases,
        comparison_tip=str(result.get("comparison_tip", "")),
    )
