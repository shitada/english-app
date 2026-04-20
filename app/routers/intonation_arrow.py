"""Intonation Arrow Drill API.

Train perception of English sentence-final intonation: learners listen to a
short utterance and tap one of three arrow chips — Rising (↗), Falling (↘),
or Rise-Fall (↗↘).

Endpoints
---------
    POST /api/intonation-arrow/session
        → `{count, items: [...]}` sampled from the JSON bank (default 8).
    POST /api/intonation-arrow/attempt
        Body: {item_id, chosen, correct, latency_ms?}
        → {ok: True, pattern, explanation, correct}
    GET  /api/intonation-arrow/stats
        → {attempts, correct, accuracy, per_pattern}
"""

from __future__ import annotations

import logging
import random
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dal import intonation_arrow as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/intonation-arrow", tags=["intonation-arrow"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class IntonationItem(BaseModel):
    id: str
    text: str
    pattern: str  # 'rising' | 'falling' | 'rise_fall'
    explanation: str
    category: str


class SessionRequest(BaseModel):
    count: int = Field(default=8, ge=1, le=30)


class SessionResponse(BaseModel):
    count: int
    items: list[IntonationItem]


class AttemptRequest(BaseModel):
    item_id: str = Field(..., min_length=1, max_length=64)
    chosen: str = Field(..., min_length=1, max_length=32)
    correct: bool
    latency_ms: int | None = Field(default=None, ge=0, le=600_000)


class AttemptResponse(BaseModel):
    ok: bool
    pattern: str
    explanation: str
    correct: bool


class PatternStat(BaseModel):
    pattern: str
    attempts: int
    correct: int
    accuracy: float


class StatsResponse(BaseModel):
    attempts: int
    correct: int
    accuracy: float
    per_pattern: list[PatternStat]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_balanced_session(count: int) -> list[dict[str, Any]]:
    """Draw a balanced session across the three patterns when possible."""
    all_items = list(dal.load_items())
    if not all_items:
        return []

    by_pattern: dict[str, list[dict[str, Any]]] = {"rising": [], "falling": [], "rise_fall": []}
    for it in all_items:
        by_pattern.setdefault(it["pattern"], []).append(it)

    rng = random.Random()
    for lst in by_pattern.values():
        rng.shuffle(lst)

    # Round-robin draw for rough balance
    picks: list[dict[str, Any]] = []
    patterns_order = ["rising", "falling", "rise_fall"]
    while len(picks) < count:
        added = False
        for p in patterns_order:
            if len(picks) >= count:
                break
            if by_pattern[p]:
                picks.append(by_pattern[p].pop())
                added = True
        if not added:
            break

    # If still short (should be rare), pad from the full pool.
    if len(picks) < count:
        remaining = [it for it in all_items if it not in picks]
        rng.shuffle(remaining)
        picks.extend(remaining[: count - len(picks)])

    rng.shuffle(picks)
    return picks[:count]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/session", response_model=SessionResponse)
async def post_session(payload: SessionRequest | None = None) -> SessionResponse:
    """Return a session of N intonation items (default 8, balanced across patterns)."""
    count = (payload.count if payload is not None else 8)
    items = _build_balanced_session(count)
    if not items:
        raise HTTPException(status_code=500, detail="No intonation items available")

    return SessionResponse(
        count=len(items),
        items=[IntonationItem(**it) for it in items],
    )


@router.post("/attempt", response_model=AttemptResponse)
async def post_attempt(
    payload: AttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> AttemptResponse:
    item = dal.get_item(payload.item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    chosen = payload.chosen.strip().lower()
    if chosen not in dal.VALID_PATTERNS:
        raise HTTPException(status_code=422, detail="Invalid chosen pattern")

    is_correct = chosen == item["pattern"]

    try:
        await dal.record_attempt(
            db,
            item_id=item["id"],
            chosen=chosen,
            correct=is_correct,
            latency_ms=payload.latency_ms,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record intonation-arrow attempt")

    return AttemptResponse(
        ok=True,
        pattern=item["pattern"],
        explanation=str(item.get("explanation") or ""),
        correct=is_correct,
    )


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StatsResponse:
    try:
        stats = await dal.get_stats(db)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute intonation-arrow stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")

    return StatsResponse(
        attempts=stats["attempts"],
        correct=stats["correct"],
        accuracy=stats["accuracy"],
        per_pattern=[PatternStat(**p) for p in stats["per_pattern"]],
    )
