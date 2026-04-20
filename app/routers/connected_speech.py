"""Connected Speech Decoder drill API.

Trains listeners to understand reduced/linked forms of natural spoken
English (gonna, wanna, whatcha, lemme, didja, kinda, sorta, ...). TTS
plays a reduced-form casual phrase; the user types the fully-expanded
standard form.

Endpoints:
  * GET  /api/connected-speech/session  — returns N items
  * POST /api/connected-speech/attempt  — grades and persists a single attempt
  * GET  /api/connected-speech/stats    — per-category accuracy + recent streak
"""

from __future__ import annotations

import json
import logging
import random
from pathlib import Path
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dal import connected_speech as cs_dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/connected-speech", tags=["connected-speech"])


# ---------------------------------------------------------------------------
# Item bank — loaded from JSON at import time
# ---------------------------------------------------------------------------

_BANK_PATH = Path(__file__).resolve().parent.parent / "data" / "connected_speech_bank.json"


def _load_bank() -> list[dict[str, Any]]:
    try:
        with _BANK_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, list):
                raise ValueError("bank file must contain a JSON array")
            return data
    except Exception:  # noqa: BLE001
        logger.exception("Failed to load connected_speech_bank.json")
        return []


ITEM_BANK: list[dict[str, Any]] = _load_bank()
VALID_DIFFICULTIES: set[str] = {"easy", "medium", "hard"}
VALID_CATEGORIES: set[str] = {it["category"] for it in ITEM_BANK}


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SessionItem(BaseModel):
    id: str
    reduced: str
    expanded: str
    category: str
    difficulty: str


class SessionResponse(BaseModel):
    difficulty: str | None = None
    items: list[SessionItem]


class AttemptRequest(BaseModel):
    reduced: str = Field(min_length=1, max_length=400)
    expanded: str = Field(min_length=1, max_length=400)
    user_answer: str = Field(default="", max_length=400)
    category: str | None = Field(default=None, max_length=40)
    time_ms: int | None = Field(default=None, ge=0, le=600_000)


class AttemptResponse(BaseModel):
    id: int
    correct: bool
    normalized_expected: str
    normalized_user: str


class CategoryStat(BaseModel):
    category: str
    attempts: int
    correct: int
    accuracy: float


class StatsResponse(BaseModel):
    stats: list[CategoryStat]
    recent_streak: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/session", response_model=SessionResponse)
async def get_session(
    difficulty: Literal["easy", "medium", "hard"] | None = Query(default=None),
    count: int = Query(default=8, ge=1, le=20),
) -> SessionResponse:
    """Return ``count`` shuffled items, optionally filtered by difficulty."""
    if not ITEM_BANK:
        raise HTTPException(status_code=500, detail="Item bank unavailable")

    pool = ITEM_BANK
    if difficulty is not None:
        pool = [it for it in ITEM_BANK if it.get("difficulty") == difficulty]
        if not pool:
            raise HTTPException(
                status_code=404,
                detail=f"No items for difficulty: {difficulty}",
            )

    k = min(count, len(pool))
    picks = random.sample(pool, k=k)
    items = [
        SessionItem(
            id=str(p["id"]),
            reduced=str(p["reduced"]),
            expanded=str(p["expanded"]),
            category=str(p.get("category", "other")),
            difficulty=str(p.get("difficulty", "medium")),
        )
        for p in picks
    ]
    return SessionResponse(difficulty=difficulty, items=items)


@router.post("/attempt", response_model=AttemptResponse)
async def submit_attempt(
    payload: AttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> AttemptResponse:
    """Grade the user's answer and persist the attempt."""
    normalized_expected = cs_dal.normalize_answer(payload.expanded)
    normalized_user = cs_dal.normalize_answer(payload.user_answer)
    correct = normalized_expected == normalized_user and bool(normalized_expected)

    try:
        new_id = await cs_dal.insert_attempt(
            db,
            reduced=payload.reduced,
            expanded=payload.expanded,
            user_answer=payload.user_answer or "",
            correct=correct,
            category=payload.category,
            time_ms=payload.time_ms,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist connected-speech attempt")
        raise HTTPException(status_code=500, detail="Failed to persist attempt")

    return AttemptResponse(
        id=new_id,
        correct=correct,
        normalized_expected=normalized_expected,
        normalized_user=normalized_user,
    )


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    lookback_days: int = Query(default=30, ge=1, le=365),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StatsResponse:
    """Per-category accuracy and current recent correct-streak."""
    try:
        stats = await cs_dal.stats_by_category(db, lookback_days=lookback_days)
        streak = await cs_dal.recent_streak(db)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute connected-speech stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")

    return StatsResponse(
        stats=[CategoryStat(**s) for s in stats],
        recent_streak=streak,
    )


@router.get("/categories")
async def list_categories() -> dict[str, list[str]]:
    """Return the list of reduction categories in the bank (filter UIs)."""
    return {"categories": sorted(VALID_CATEGORIES)}
