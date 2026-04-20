"""Elastic Sentence drill — progressive sentence expansion API."""

from __future__ import annotations

import logging
import random
import re
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import elastic_sentence as es_dal
from app.database import get_db_session
from app.prompts import ELASTIC_SENTENCE_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/elastic-sentence", tags=["elastic-sentence"])

Difficulty = Literal["short", "medium", "long"]

_TARGET_WORDS: dict[str, int] = {"short": 6, "medium": 10, "long": 14}

# ---------------------------------------------------------------------------
# Fallback bank — used when Copilot fails or returns invalid output.
# Each item has a target + pre-computed chain of progressively longer fragments.
# ---------------------------------------------------------------------------
FALLBACK_BANK: dict[str, list[dict[str, Any]]] = {
    "short": [
        {
            "target": "I'd like some coffee please",
            "chain": [
                "coffee",
                "some coffee",
                "like some coffee",
                "I'd like some coffee",
                "I'd like some coffee please",
            ],
        },
        {
            "target": "Could you open the window",
            "chain": [
                "the window",
                "open the window",
                "you open the window",
                "Could you open the window",
            ],
        },
        {
            "target": "We should leave right now",
            "chain": [
                "right now",
                "leave right now",
                "should leave right now",
                "We should leave right now",
            ],
        },
    ],
    "medium": [
        {
            "target": "I usually grab a coffee on the way to work",
            "chain": [
                "coffee",
                "a coffee",
                "grab a coffee",
                "usually grab a coffee",
                "I usually grab a coffee on the way",
                "I usually grab a coffee on the way to work",
            ],
        },
        {
            "target": "She told me she would call me back later today",
            "chain": [
                "call me",
                "call me back",
                "would call me back",
                "she would call me back",
                "She told me she would call me back later",
                "She told me she would call me back later today",
            ],
        },
    ],
    "long": [
        {
            "target": "If you have some time this weekend we should try that new ramen place",
            "chain": [
                "this weekend",
                "some time this weekend",
                "have some time this weekend",
                "If you have some time this weekend",
                "If you have some time this weekend we should try",
                "If you have some time this weekend we should try that new ramen place",
            ],
        },
        {
            "target": "Honestly I think the presentation today went much better than any of us expected",
            "chain": [
                "much better",
                "went much better",
                "the presentation went much better",
                "I think the presentation today went much better",
                "Honestly I think the presentation today went much better than any of us",
                "Honestly I think the presentation today went much better than any of us expected",
            ],
        },
    ],
}


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

_WORD_RE = re.compile(r"[a-z0-9']+")


def normalize_words(text: str) -> list[str]:
    return _WORD_RE.findall((text or "").lower())


def compute_accuracy(expected: str, transcript: str) -> float:
    """Percent of expected tokens present in the transcript (order-independent)."""
    exp = normalize_words(expected)
    if not exp:
        return 0.0
    tr = set(normalize_words(transcript))
    hits = sum(1 for w in exp if w in tr)
    return round(100.0 * hits / len(exp), 1)


def word_count(text: str) -> int:
    return len(normalize_words(text))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class GenerateRequest(BaseModel):
    difficulty: Difficulty = "medium"


class ElasticSentenceItem(BaseModel):
    difficulty: Difficulty
    target: str
    chain: list[str]


class SubmitRequest(BaseModel):
    difficulty: Difficulty
    target: str = Field(min_length=1, max_length=400)
    chain: list[str] = Field(default_factory=list, max_length=16)
    max_reached: int = Field(ge=0, le=16)
    accuracy: float = Field(ge=0, le=100)
    transcript: str = Field(default="", max_length=600)


class SubmitResponse(BaseModel):
    id: int
    difficulty: Difficulty
    target: str
    chain_len: int
    max_reached: int
    accuracy: float
    longest_words: int


class StatsResponse(BaseModel):
    total_sessions: int
    avg_accuracy_last_20: float
    longest_words: int
    last_session_at: str | None = None


class RecentSession(BaseModel):
    id: int
    difficulty: str
    target_sentence: str
    chain: list[str]
    chain_len: int
    max_reached: int
    accuracy: float
    longest_words: int
    created_at: str | None = None


# ---------------------------------------------------------------------------
# Validation of Copilot output
# ---------------------------------------------------------------------------


def _validate_chain(raw: Any, difficulty: str) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    target = str(raw.get("target", "")).strip()
    chain_raw = raw.get("chain")
    if not target or not isinstance(chain_raw, list):
        return None

    chain = [str(s).strip() for s in chain_raw if isinstance(s, (str,)) and str(s).strip()]
    if not (4 <= len(chain) <= 8):
        return None

    # Strictly increasing word count
    last_wc = 0
    for step in chain:
        wc = word_count(step)
        if wc <= last_wc:
            return None
        last_wc = wc

    # Final step must match target token set (exact word list, case-insensitive)
    if normalize_words(chain[-1]) != normalize_words(target):
        return None

    # Target word count must be close to expected
    expected = _TARGET_WORDS.get(difficulty, 10)
    final_wc = word_count(target)
    if abs(final_wc - expected) > 4:
        return None

    return {"target": target, "chain": chain}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _fallback_item(difficulty: str) -> dict[str, Any]:
    bank = FALLBACK_BANK.get(difficulty) or FALLBACK_BANK["medium"]
    return random.choice(bank)


@router.post("/generate", response_model=ElasticSentenceItem)
async def generate(payload: GenerateRequest) -> ElasticSentenceItem:
    """Generate a target + expansion chain for the requested difficulty."""
    difficulty = payload.difficulty
    try:
        service = get_copilot_service()
        raw = await service.ask_json(
            ELASTIC_SENTENCE_PROMPT(),
            f"Generate one elastic-sentence chain at '{difficulty}' difficulty "
            f"(~{_TARGET_WORDS[difficulty]} words).",
        )
        cleaned = _validate_chain(raw, difficulty)
        if cleaned is not None:
            return ElasticSentenceItem(
                difficulty=difficulty,
                target=cleaned["target"],
                chain=cleaned["chain"],
            )
        logger.info("elastic_sentence: copilot output invalid; using fallback")
    except Exception as exc:  # noqa: BLE001
        logger.warning("elastic_sentence generation failed, using fallback: %s", exc)

    pick = _fallback_item(difficulty)
    return ElasticSentenceItem(
        difficulty=difficulty,
        target=pick["target"],
        chain=list(pick["chain"]),
    )


@router.post("/submit", response_model=SubmitResponse)
async def submit(
    payload: SubmitRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SubmitResponse:
    """Persist a completed elastic-sentence session."""
    longest = word_count(payload.target) if payload.accuracy >= 60.0 else 0
    # If user didn't reach the final step, use the step they reached.
    if payload.max_reached < len(payload.chain) and payload.max_reached > 0:
        # Use the reached step's word count as the longest successful utterance.
        step_text = payload.chain[payload.max_reached - 1] if payload.chain else payload.target
        longest = max(longest, word_count(step_text))

    try:
        new_id = await es_dal.create_session(
            db,
            difficulty=payload.difficulty,
            target_sentence=payload.target,
            chain=payload.chain,
            max_reached=payload.max_reached,
            accuracy=payload.accuracy,
            longest_words=longest,
        )
    except Exception:
        logger.exception("Failed to record elastic_sentence session")
        raise HTTPException(status_code=500, detail="Failed to record session")

    return SubmitResponse(
        id=new_id,
        difficulty=payload.difficulty,
        target=payload.target,
        chain_len=len(payload.chain),
        max_reached=payload.max_reached,
        accuracy=payload.accuracy,
        longest_words=longest,
    )


@router.get("/recent", response_model=list[RecentSession])
async def recent(
    limit: int = 10,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> list[RecentSession]:
    limit = max(1, min(50, int(limit)))
    try:
        rows = await es_dal.recent_sessions(db, limit=limit)
    except Exception:
        logger.exception("Failed to fetch elastic_sentence recent sessions")
        raise HTTPException(status_code=500, detail="Failed to fetch recent")
    return [RecentSession(**r) for r in rows]


@router.get("/stats", response_model=StatsResponse)
async def stats(
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StatsResponse:
    try:
        s = await es_dal.get_stats(db)
    except Exception:
        logger.exception("Failed to fetch elastic_sentence stats")
        raise HTTPException(status_code=500, detail="Failed to fetch stats")
    return StatsResponse(**s)
