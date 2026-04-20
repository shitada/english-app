"""Preposition Cloze Drill API.

Fill-in preposition practice with contextual feedback.

Endpoints
---------
    GET  /api/prepositions/session?count=8&level=beginner|intermediate|advanced
        → `{items: [...]}` sampled from the JSON bank.
    POST /api/prepositions/attempt
        Body: {item_id, chosen, response_ms?}
        → {correct, answer, explanation}
    GET  /api/prepositions/stats
        → {attempts, accuracy, per_category, confused_pairs}
"""

from __future__ import annotations

import logging
import random
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dal import prepositions as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prepositions", tags=["prepositions"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PrepositionItem(BaseModel):
    id: str
    sentence_with_blank: str
    options: list[str]
    answer: str
    explanation: str
    category: str
    level: str


class SessionResponse(BaseModel):
    count: int
    level: str | None
    items: list[PrepositionItem]


class AttemptRequest(BaseModel):
    item_id: str = Field(..., min_length=1, max_length=64)
    chosen: str = Field(..., min_length=1, max_length=40)
    response_ms: int | None = Field(default=None, ge=0, le=600_000)


class AttemptResponse(BaseModel):
    correct: bool
    answer: str
    explanation: str


class ConfusedPair(BaseModel):
    correct: str
    chosen: str
    count: int


class CategoryStat(BaseModel):
    category: str
    attempts: int
    correct: int
    accuracy: float


class StatsResponse(BaseModel):
    attempts: int
    correct: int
    accuracy: float
    per_category: list[CategoryStat]
    confused_pairs: list[ConfusedPair]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/session", response_model=SessionResponse)
async def get_session(
    count: int = Query(default=8, ge=1, le=30),
    level: str | None = Query(default=None),
) -> SessionResponse:
    """Return a random session of N preposition cloze items.

    If `level` is provided and matches items in the bank, filter by it.
    """
    level_norm: str | None = None
    if level:
        low = level.strip().lower()
        if low and low not in dal.VALID_LEVELS:
            raise HTTPException(status_code=422, detail="Invalid level")
        level_norm = low or None

    all_items = list(dal.load_items())
    if not all_items:
        raise HTTPException(status_code=500, detail="No preposition items available")

    pool = all_items
    if level_norm:
        filtered = [it for it in all_items if it.get("level") == level_norm]
        if filtered:
            pool = filtered

    rng = random.Random()
    rng.shuffle(pool)
    picked = pool[:count]
    # If bank is smaller than count, just return what we have.

    items = [
        PrepositionItem(
            id=it["id"],
            sentence_with_blank=it["sentence_with_blank"],
            options=list(it["options"]),
            answer=it["answer"],
            explanation=it["explanation"],
            category=it["category"],
            level=it["level"],
        )
        for it in picked
    ]
    return SessionResponse(count=len(items), level=level_norm, items=items)


@router.post("/attempt", response_model=AttemptResponse)
async def post_attempt(
    payload: AttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> AttemptResponse:
    item = dal.get_item(payload.item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    chosen = payload.chosen.strip()
    answer = str(item["answer"]).strip()
    is_correct = chosen == answer

    try:
        await dal.record_attempt(
            db,
            item_id=item["id"],
            chosen=chosen,
            correct=answer,
            category=item.get("category"),
            response_ms=payload.response_ms,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record preposition attempt")

    return AttemptResponse(
        correct=is_correct,
        answer=answer,
        explanation=str(item.get("explanation") or ""),
    )


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    db: aiosqlite.Connection = Depends(get_db_session),
    lookback_days: int = Query(default=30, ge=1, le=365),
) -> StatsResponse:
    try:
        stats: dict[str, Any] = await dal.get_recent_stats(db, lookback_days=lookback_days)
        pairs = await dal.get_confused_pairs(db, lookback_days=lookback_days, limit=3)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute preposition stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")

    return StatsResponse(
        attempts=stats["attempts"],
        correct=stats["correct"],
        accuracy=stats["accuracy"],
        per_category=[CategoryStat(**c) for c in stats["per_category"]],
        confused_pairs=[ConfusedPair(**p) for p in pairs],
    )
