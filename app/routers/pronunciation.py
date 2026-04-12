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
