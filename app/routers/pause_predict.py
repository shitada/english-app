"""Pause & Predict listening drill API.

Endpoints
---------
    GET  /api/pause-predict/session?difficulty=&count=
        → {difficulty, count, items: [...]}
    POST /api/pause-predict/submit
        Body: {item_id, user_answer, expected, alternatives}
        → {is_correct, is_close, expected, user_answer_normalized, score, feedback}
    POST /api/pause-predict/session/complete
        Body: {difficulty, total, correct, close, avg_score}
        → {id, created_at}
    GET  /api/pause-predict/recent?limit=20
        → {sessions: [...]}
    GET  /api/pause-predict/stats
        → aggregate stats across sessions
"""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import pause_predict as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pause-predict", tags=["pause-predict"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PausePredictItem(BaseModel):
    id: str
    full_sentence: str
    prefix_text: str
    expected_completion: str
    alternatives: list[str] = Field(default_factory=list)
    context_hint: str = ""


class SessionResponse(BaseModel):
    difficulty: str
    count: int
    items: list[PausePredictItem]


class SubmitRequest(BaseModel):
    item_id: str = Field(..., min_length=1, max_length=120)
    user_answer: str = Field(..., min_length=1, max_length=200)
    expected: str = Field(..., min_length=1, max_length=200)
    alternatives: list[str] = Field(default_factory=list)


class SubmitResponse(BaseModel):
    is_correct: bool
    is_close: bool
    expected: str
    user_answer_normalized: str
    score: float
    feedback: str


class CompleteRequest(BaseModel):
    difficulty: str = Field(..., min_length=1, max_length=20)
    total: int = Field(..., ge=0, le=100)
    correct: int = Field(..., ge=0, le=100)
    close: int = Field(..., ge=0, le=100)
    avg_score: float = Field(..., ge=0.0, le=1.0)


class CompleteResponse(BaseModel):
    id: int
    difficulty: str
    total: int
    correct: int
    close: int
    avg_score: float


class RecentSession(BaseModel):
    id: int
    difficulty: str
    total: int
    correct: int
    close: int
    avg_score: float
    created_at: str


class RecentResponse(BaseModel):
    sessions: list[RecentSession]


class StatsResponse(BaseModel):
    sessions: int
    total_items: int
    total_correct: int
    total_close: int
    avg_score: float
    accuracy: float


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/session", response_model=SessionResponse)
async def get_session(
    difficulty: str = Query(default="beginner"),
    count: int = Query(default=5, ge=1, le=10),
) -> SessionResponse:
    """Return a list of prediction items."""
    diff = dal.normalize_difficulty(difficulty)
    copilot = get_copilot_service()
    items_raw = await dal.generate_items(copilot, difficulty=diff, count=count)

    items = [
        PausePredictItem(
            id=it["id"],
            full_sentence=it["full_sentence"],
            prefix_text=it["prefix_text"],
            expected_completion=it["expected_completion"],
            alternatives=list(it.get("alternatives") or []),
            context_hint=it.get("context_hint") or "",
        )
        for it in items_raw
    ]
    return SessionResponse(difficulty=diff, count=len(items), items=items)


@router.post("/submit", response_model=SubmitResponse)
async def submit_answer(payload: SubmitRequest) -> SubmitResponse:
    result = dal.score_answer(
        user_answer=payload.user_answer,
        expected=payload.expected,
        alternatives=list(payload.alternatives or []),
    )
    return SubmitResponse(**result)


@router.post("/session/complete", response_model=CompleteResponse)
async def complete_session(
    payload: CompleteRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> CompleteResponse:
    if payload.correct + payload.close > payload.total:
        raise HTTPException(
            status_code=422,
            detail="correct + close cannot exceed total",
        )
    try:
        new_id = await dal.insert_session(
            db,
            difficulty=payload.difficulty,
            total=payload.total,
            correct=payload.correct,
            close=payload.close,
            avg_score=payload.avg_score,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist pause_predict session")
        raise HTTPException(status_code=500, detail="Failed to save session")

    return CompleteResponse(
        id=new_id,
        difficulty=dal.normalize_difficulty(payload.difficulty),
        total=payload.total,
        correct=payload.correct,
        close=payload.close,
        avg_score=payload.avg_score,
    )


@router.get("/recent", response_model=RecentResponse)
async def get_recent(
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> RecentResponse:
    try:
        rows = await dal.recent_sessions(db, limit=limit)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to fetch recent pause_predict sessions")
        raise HTTPException(status_code=500, detail="Failed to load history")

    return RecentResponse(sessions=[RecentSession(**r) for r in rows])


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StatsResponse:
    try:
        data: dict[str, Any] = await dal.stats(db)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute pause_predict stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")
    return StatsResponse(**data)
