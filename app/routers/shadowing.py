"""Quick Shadowing Drill API — listen-and-repeat sentence practice."""

from __future__ import annotations

import logging
import random
import re
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import shadowing as shadow_dal
from app.database import get_db_session
from app.prompts import SHADOWING_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/shadowing", tags=["shadowing"])


# ---------------------------------------------------------------------------
# Fallback sentences (used when Copilot fails / returns invalid data).
# Each sentence is 8-18 words.
# ---------------------------------------------------------------------------
FALLBACK_SENTENCES: list[dict[str, Any]] = [
    {
        "sentence": "I usually grab a coffee on my way to work in the morning.",
        "focus_tip": "Link 'grab a' smoothly and reduce 'to' to /tə/.",
        "target_seconds": 4.0,
    },
    {
        "sentence": "Could you let me know when the meeting is going to start tomorrow?",
        "focus_tip": "Rising intonation on the question; reduce 'going to' to 'gonna'.",
        "target_seconds": 4.5,
    },
    {
        "sentence": "She told me she would call back later, but I never heard from her again.",
        "focus_tip": "Stress 'never' and 'again'; soften unstressed function words.",
        "target_seconds": 5.0,
    },
    {
        "sentence": "If you have time this weekend, we should try that new ramen place downtown.",
        "focus_tip": "Link 'have time' and 'should try'; keep a steady rhythm.",
        "target_seconds": 5.0,
    },
    {
        "sentence": "Honestly, I think the presentation went better than any of us expected today.",
        "focus_tip": "Sentence stress on 'better' and 'expected'.",
        "target_seconds": 5.0,
    },
    {
        "sentence": "Let me know if you need a hand with anything before the deadline next Friday.",
        "focus_tip": "Reduce 'need a' to /niː.də/; keep 'next Friday' crisp.",
        "target_seconds": 5.0,
    },
    {
        "sentence": "It took me a while to figure out how the new software actually works.",
        "focus_tip": "Stress 'figure out' and 'actually'; reduce 'to' to schwa.",
        "target_seconds": 4.5,
    },
    {
        "sentence": "We're planning to head out around seven so we can beat the traffic.",
        "focus_tip": "Contraction 'we're'; link 'head out' and 'beat the'.",
        "target_seconds": 4.5,
    },
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ShadowingSentence(BaseModel):
    sentence: str
    focus_tip: str
    target_seconds: float


class ShadowingAttemptRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=400)
    transcript: str = Field(default="", max_length=600)
    accuracy: float = Field(ge=0, le=100)
    timing_score: float = Field(ge=0, le=100)
    duration_ms: int = Field(ge=0, le=600_000)


class ShadowingAttemptResponse(BaseModel):
    id: int
    sentence: str
    transcript: str
    accuracy: float
    timing_score: float
    combined_score: float
    duration_ms: int


class ShadowingStatsResponse(BaseModel):
    total_attempts: int
    avg_combined_last_20: float
    best_combined: float
    last_attempt_at: str | None = None


# ---------------------------------------------------------------------------
# Scoring helpers (server-side, also covered by unit tests)
# ---------------------------------------------------------------------------

_WORD_RE = re.compile(r"[a-z0-9']+")


def _normalize_words(text: str) -> list[str]:
    """Lowercase + strip punctuation; return list of word tokens."""
    return _WORD_RE.findall((text or "").lower())


def compute_accuracy(expected: str, transcript: str) -> float:
    """Percent of expected words that appear in the transcript (case/punct-insensitive)."""
    expected_words = _normalize_words(expected)
    if not expected_words:
        return 0.0
    transcript_set = set(_normalize_words(transcript))
    hits = sum(1 for w in expected_words if w in transcript_set)
    return round(100.0 * hits / len(expected_words), 1)


def compute_timing_score(actual_seconds: float, target_seconds: float) -> float:
    """100 - min(100, |actual - target|/target * 100); clamped to [0, 100]."""
    if target_seconds <= 0:
        return 0.0
    diff_pct = abs(actual_seconds - target_seconds) / target_seconds * 100.0
    score = 100.0 - min(100.0, diff_pct)
    return round(max(0.0, min(100.0, score)), 1)


def combined_score(accuracy: float, timing_score: float) -> float:
    return round((float(accuracy) + float(timing_score)) / 2.0, 1)


# ---------------------------------------------------------------------------
# Sentence generation
# ---------------------------------------------------------------------------

def _validate_sentence_payload(raw: Any) -> dict[str, Any] | None:
    """Validate Copilot output; return clean dict or None."""
    if not isinstance(raw, dict):
        return None
    sentence = str(raw.get("sentence", "")).strip()
    focus_tip = str(raw.get("focus_tip", "")).strip()
    target_seconds = raw.get("target_seconds", 4.0)
    try:
        target_seconds = float(target_seconds)
    except (TypeError, ValueError):
        return None

    word_count = len(_normalize_words(sentence))
    if not (8 <= word_count <= 18):
        return None
    if not focus_tip:
        focus_tip = "Match the speaker's rhythm and natural sentence stress."
    if not (1.5 <= target_seconds <= 12.0):
        # crude fallback: ~0.4s per word
        target_seconds = max(2.0, min(8.0, word_count * 0.4))
    return {
        "sentence": sentence,
        "focus_tip": focus_tip,
        "target_seconds": round(target_seconds, 2),
    }


@router.post("/sentence", response_model=ShadowingSentence)
async def generate_sentence() -> ShadowingSentence:
    """Generate a shadowing sentence (Copilot, with fallback)."""
    try:
        service = get_copilot_service()
        raw = await service.ask_json(
            SHADOWING_PROMPT(),
            "Generate one shadowing sentence now.",
        )
        cleaned = _validate_sentence_payload(raw)
        if cleaned is not None:
            return ShadowingSentence(**cleaned)
        logger.info("shadowing copilot output invalid; using fallback")
    except Exception as exc:  # noqa: BLE001
        logger.warning("shadowing generation failed, using fallback: %s", exc)

    pick = random.choice(FALLBACK_SENTENCES)
    return ShadowingSentence(**pick)


@router.post("/attempt", response_model=ShadowingAttemptResponse)
async def submit_attempt(
    payload: ShadowingAttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ShadowingAttemptResponse:
    """Persist a single shadowing attempt and echo a combined score."""
    try:
        new_id = await shadow_dal.record_attempt(
            db,
            sentence=payload.sentence,
            transcript=payload.transcript or "",
            accuracy=payload.accuracy,
            timing_score=payload.timing_score,
            duration_ms=payload.duration_ms,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record shadowing attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")

    return ShadowingAttemptResponse(
        id=new_id,
        sentence=payload.sentence,
        transcript=payload.transcript or "",
        accuracy=payload.accuracy,
        timing_score=payload.timing_score,
        combined_score=combined_score(payload.accuracy, payload.timing_score),
        duration_ms=payload.duration_ms,
    )


@router.get("/stats", response_model=ShadowingStatsResponse)
async def get_stats(
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ShadowingStatsResponse:
    """Return cumulative shadowing stats for the progress badge."""
    try:
        stats = await shadow_dal.get_stats(db)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to fetch shadowing stats")
        raise HTTPException(status_code=500, detail="Failed to fetch stats")
    return ShadowingStatsResponse(**stats)
