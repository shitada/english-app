"""Sentence Stress Spotlight API.

Tap the words you think carry primary sentence stress, reveal precision/
recall vs. the model answer, then listen with TTS emphasis (or capitalization
fallback) and shadow-record yourself.
"""

from __future__ import annotations

import logging
import random
import re
from html import escape
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import stress_spotlight as ss_dal
from app.database import get_db_session
from app.prompts import STRESS_SPOTLIGHT_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stress-spotlight", tags=["stress-spotlight"])


VALID_DIFFICULTIES = {"beginner", "intermediate", "advanced"}


# ---------------------------------------------------------------------------
# Hand-curated fallback bank used when the LLM is unavailable / malformed.
# stressed_indices are 0-based positions of words that carry primary stress.
# ---------------------------------------------------------------------------
_FALLBACK_ITEMS: list[dict[str, Any]] = [
    {
        "sentence": "I really need a coffee before the meeting starts.",
        "stressed_indices": [1, 3, 5, 7],
        "rationale": "Adverb 'really', main noun 'coffee', preposition target 'meeting', and verb 'starts' carry the beat.",
    },
    {
        "sentence": "She finally finished her project late last night.",
        "stressed_indices": [1, 2, 4, 5, 7],
        "rationale": "Adverbs and content nouns carry stress; pronouns and possessives stay light.",
    },
    {
        "sentence": "We never go to the gym on Sunday mornings.",
        "stressed_indices": [1, 2, 4, 6, 7],
        "rationale": "Negative 'never', main verb 'go', noun 'gym', and the time phrase 'Sunday mornings' are stressed.",
    },
    {
        "sentence": "He told me he was leaving the company next month.",
        "stressed_indices": [1, 4, 6, 8, 9],
        "rationale": "Main verbs and content nouns carry stress; auxiliaries and pronouns are reduced.",
    },
    {
        "sentence": "That movie was way better than I expected last weekend.",
        "stressed_indices": [1, 3, 6, 9],
        "rationale": "Demonstrative 'movie', comparative 'better', main verb 'expected', and time phrase carry stress.",
    },
    {
        "sentence": "Could you please send me the report by tomorrow afternoon?",
        "stressed_indices": [2, 3, 6, 8, 9],
        "rationale": "Main verb 'send', polite 'please', noun 'report', and time phrase carry stress.",
    },
    {
        "sentence": "I think we should book the tickets earlier this time.",
        "stressed_indices": [1, 4, 6, 7, 9],
        "rationale": "Main verbs and content nouns are stressed; pronouns and articles stay unstressed.",
    },
    {
        "sentence": "The new manager wants to change everything in the office.",
        "stressed_indices": [1, 2, 3, 5, 6, 9],
        "rationale": "Adjectives, nouns, and main verbs are stressed; function words remain weak.",
    },
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class StressSpotlightItem(BaseModel):
    sentence: str
    words: list[str]
    stressed_indices: list[int]
    rationale: str
    difficulty: str


class StressSpotlightAttemptRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=400)
    words: list[str] = Field(min_length=1, max_length=40)
    expected_indices: list[int] = Field(default_factory=list, max_length=40)
    user_indices: list[int] = Field(default_factory=list, max_length=40)
    difficulty: str = Field(default="intermediate", max_length=20)


class StressSpotlightAttemptResponse(BaseModel):
    id: int
    precision: float
    recall: float
    f1: float


class StressSpotlightAudioResponse(BaseModel):
    sentence: str
    emphasized_indices: list[int]
    emphasized_words: list[str]
    ssml: str
    fallback_text: str


class StressSpotlightRecentEntry(BaseModel):
    id: int
    sentence: str
    words: list[str]
    expected_indices: list[int]
    user_indices: list[int]
    precision_score: float
    recall_score: float
    f1_score: float
    difficulty: str
    created_at: str


class StressSpotlightRecentResponse(BaseModel):
    items: list[StressSpotlightRecentEntry]


# ---------------------------------------------------------------------------
# Pure helpers (covered by unit tests)
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"\S+")


def split_words(sentence: str) -> list[str]:
    return _TOKEN_RE.findall((sentence or "").strip())


def compute_precision_recall(
    expected: list[int], picked: list[int]
) -> tuple[float, float, float]:
    """Compute (precision, recall, f1) as percentages 0..100, rounded to 1 dp.

    - precision = picks that are correct / picks
    - recall    = picks that are correct / expected
    - f1        = harmonic mean
    Edge cases:
      * If expected is empty AND picked is empty -> (100, 100, 100).
      * If expected is empty AND picked non-empty -> (0, 100, 0).
      * If picked is empty AND expected non-empty -> (100, 0, 0).
    """
    e = set(int(i) for i in expected)
    p = set(int(i) for i in picked)
    if not e and not p:
        return 100.0, 100.0, 100.0
    if not p:
        return 100.0, 0.0, 0.0
    if not e:
        return 0.0, 100.0, 0.0
    tp = len(p & e)
    precision = 100.0 * tp / len(p)
    recall = 100.0 * tp / len(e)
    if precision + recall == 0:
        f1 = 0.0
    else:
        f1 = 2.0 * precision * recall / (precision + recall)
    return round(precision, 1), round(recall, 1), round(f1, 1)


def coerce_payload(raw: Any) -> dict[str, Any] | None:
    """Validate an LLM response. Returns clean dict or None if malformed."""
    if not isinstance(raw, dict):
        return None
    sentence = str(raw.get("sentence") or "").strip()
    if not sentence:
        return None

    raw_words = raw.get("words")
    if isinstance(raw_words, list) and raw_words:
        words = [str(w).strip() for w in raw_words if str(w).strip()]
    else:
        words = split_words(sentence)

    n = len(words)
    if n < 8 or n > 16:
        return None

    raw_indices = raw.get("stressed_indices")
    if not isinstance(raw_indices, list):
        return None

    indices: list[int] = []
    for v in raw_indices:
        try:
            i = int(v)
        except (TypeError, ValueError):
            continue
        if 0 <= i <= n - 1 and i not in indices:
            indices.append(i)
    indices.sort()
    if len(indices) < 2 or len(indices) > 6:
        return None

    rationale = str(raw.get("rationale") or "").strip()
    if not rationale:
        rationale = "Content words (nouns, main verbs, adjectives, adverbs) carry primary stress."

    return {
        "sentence": " ".join(words),
        "words": words,
        "stressed_indices": indices,
        "rationale": rationale,
    }


def build_emphasis_audio(
    words: list[str], emphasize: list[int]
) -> tuple[str, str, list[int], list[str]]:
    """Return (ssml, fallback_text, normalized_indices, emphasized_words).

    SSML uses <emphasis level="strong"> on each emphasized word.
    The fallback text capitalizes emphasized words for engines that don't
    parse SSML (browser SpeechSynthesis being the primary client).
    """
    n = len(words)
    norm: list[int] = []
    seen: set[int] = set()
    for v in emphasize:
        try:
            i = int(v)
        except (TypeError, ValueError):
            continue
        if 0 <= i < n and i not in seen:
            seen.add(i)
            norm.append(i)
    norm.sort()

    ssml_parts: list[str] = ["<speak>"]
    fallback_parts: list[str] = []
    emphasized_words: list[str] = []
    for idx, w in enumerate(words):
        safe = escape(w)
        if idx in seen:
            ssml_parts.append(f'<emphasis level="strong">{safe}</emphasis>')
            # Strip trailing punctuation so capitalization looks tidy
            stripped = re.sub(r"[^A-Za-z0-9\']+$", "", w)
            tail = w[len(stripped):]
            fallback_parts.append(stripped.upper() + tail)
            emphasized_words.append(w)
        else:
            ssml_parts.append(safe)
            fallback_parts.append(w)
        if idx < n - 1:
            ssml_parts.append(" ")
    ssml_parts.append("</speak>")

    return "".join(ssml_parts), " ".join(fallback_parts), norm, emphasized_words


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=StressSpotlightItem)
async def generate(
    difficulty: str = Query(default="intermediate"),
) -> StressSpotlightItem:
    """Generate one sentence with model stress positions."""
    norm = (difficulty or "intermediate").strip().lower()
    if norm not in VALID_DIFFICULTIES:
        norm = "intermediate"

    coerced: dict[str, Any] | None = None
    llm_attempted = False
    try:
        service = get_copilot_service()
        llm_attempted = True
        raw = await service.ask_json(
            STRESS_SPOTLIGHT_PROMPT(),
            f"Generate one {norm}-level sentence-stress item now.",
        )
        coerced = coerce_payload(raw)
        if coerced is None and llm_attempted:
            logger.info("stress-spotlight LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("stress-spotlight generation failed, using fallback: %s", exc)

    if coerced is None:
        item = random.choice(_FALLBACK_ITEMS)
        words = split_words(item["sentence"])
        coerced = {
            "sentence": item["sentence"],
            "words": words,
            "stressed_indices": list(item["stressed_indices"]),
            "rationale": item["rationale"],
        }

    return StressSpotlightItem(
        sentence=coerced["sentence"],
        words=coerced["words"],
        stressed_indices=coerced["stressed_indices"],
        rationale=coerced["rationale"],
        difficulty=norm,
    )


@router.get("/audio", response_model=StressSpotlightAudioResponse)
async def audio(
    sentence: str = Query(min_length=1, max_length=400),
    emphasize: str = Query(default=""),
) -> StressSpotlightAudioResponse:
    """Build SSML + capitalization-fallback text for stress emphasis."""
    words = split_words(sentence)
    if not words:
        raise HTTPException(status_code=400, detail="sentence must contain words")

    indices: list[int] = []
    for tok in (emphasize or "").split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            indices.append(int(tok))
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"emphasize must be comma-separated ints, got: {tok!r}"
            )

    ssml, fallback_text, norm_indices, emphasized_words = build_emphasis_audio(
        words, indices
    )
    return StressSpotlightAudioResponse(
        sentence=" ".join(words),
        emphasized_indices=norm_indices,
        emphasized_words=emphasized_words,
        ssml=ssml,
        fallback_text=fallback_text,
    )


@router.post("/attempt", response_model=StressSpotlightAttemptResponse)
async def submit_attempt(
    payload: StressSpotlightAttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StressSpotlightAttemptResponse:
    """Persist a single attempt and echo precision/recall/f1."""
    n = len(payload.words)
    expected = [i for i in payload.expected_indices if 0 <= int(i) < n]
    picked = [i for i in payload.user_indices if 0 <= int(i) < n]
    precision, recall, f1 = compute_precision_recall(expected, picked)

    difficulty = (payload.difficulty or "intermediate").strip().lower()
    if difficulty not in VALID_DIFFICULTIES:
        difficulty = "intermediate"

    try:
        new_id = await ss_dal.record_attempt(
            db,
            sentence=payload.sentence,
            words=payload.words,
            expected_indices=expected,
            user_indices=picked,
            precision=precision,
            recall=recall,
            f1=f1,
            difficulty=difficulty,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record stress-spotlight attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")

    return StressSpotlightAttemptResponse(
        id=new_id, precision=precision, recall=recall, f1=f1
    )


@router.get("/recent", response_model=StressSpotlightRecentResponse)
async def list_recent(
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StressSpotlightRecentResponse:
    """Return the most recent attempts (default 10)."""
    try:
        rows = await ss_dal.list_recent(db, limit=limit)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to list stress-spotlight attempts")
        raise HTTPException(status_code=500, detail="Failed to fetch recent attempts")

    items = [
        StressSpotlightRecentEntry(
            id=int(r["id"]),
            sentence=str(r["sentence"]),
            words=list(r.get("words") or []),
            expected_indices=list(r.get("expected_indices") or []),
            user_indices=list(r.get("user_indices") or []),
            precision_score=float(r.get("precision_score") or 0.0),
            recall_score=float(r.get("recall_score") or 0.0),
            f1_score=float(r.get("f1_score") or 0.0),
            difficulty=str(r.get("difficulty") or "intermediate"),
            created_at=str(r.get("created_at") or ""),
        )
        for r in rows
    ]
    return StressSpotlightRecentResponse(items=items)
