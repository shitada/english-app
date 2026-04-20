"""Situational Monologue Drill API (Elevator Pitch practice).

Endpoints:
    GET  /api/monologue/scenarios             → curated scenarios list
    POST /api/monologue/attempt                → score + persist one attempt
    GET  /api/monologue/history?scenario_id=… → last 20 attempts + personal best
"""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import monologue as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/monologue", tags=["monologue"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class Scenario(BaseModel):
    id: str
    title: str
    prompt: str
    target_seconds: int
    content_beats: list[str]


class ScenarioListResponse(BaseModel):
    scenarios: list[Scenario]


class MonologueAttemptRequest(BaseModel):
    scenario_id: str = Field(..., min_length=1, max_length=80)
    transcript: str = Field(..., min_length=1, max_length=4000)
    duration_seconds: float = Field(..., ge=1.0, le=600.0)


class MonologueFeedback(BaseModel):
    beats_covered: list[str]
    fluency_score: int
    structure_score: int
    overall_score: int
    one_line_feedback: str
    suggested_rewrite_opening: str


class MonologueAttemptResponse(BaseModel):
    id: int
    scenario_id: str
    duration_seconds: float
    word_count: int
    filler_count: int
    wpm: float
    coverage_ratio: float
    fluency_score: int
    structure_score: int
    overall_score: int
    feedback: MonologueFeedback


class MonologueHistoryItem(BaseModel):
    id: int
    scenario_id: str
    duration_seconds: float
    word_count: int
    filler_count: int
    wpm: float
    coverage_ratio: float
    fluency_score: int
    structure_score: int
    overall_score: int
    feedback: dict[str, Any]
    created_at: str


class MonologueHistoryResponse(BaseModel):
    attempts: list[MonologueHistoryItem]
    personal_best: MonologueHistoryItem | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/scenarios", response_model=ScenarioListResponse)
async def list_scenarios() -> ScenarioListResponse:
    """Return the curated static scenario bank."""
    return ScenarioListResponse(
        scenarios=[Scenario(**s) for s in dal.get_scenarios()]
    )


@router.post("/attempt", response_model=MonologueAttemptResponse)
async def submit_attempt(
    payload: MonologueAttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> MonologueAttemptResponse:
    """Score a monologue attempt and persist it."""
    scenario = dal.get_scenario(payload.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Unknown scenario_id")

    transcript = payload.transcript.strip()
    word_count = dal.count_words(transcript)
    filler_count = dal.count_filler_words(transcript)
    wpm = dal.compute_wpm(word_count, payload.duration_seconds)

    copilot = get_copilot_service()
    feedback = await dal.score_attempt(
        copilot,
        scenario=scenario,
        transcript=transcript,
        duration_seconds=float(payload.duration_seconds),
        wpm=wpm,
        filler_count=filler_count,
        word_count=word_count,
    )

    beats = scenario["content_beats"] or []
    coverage_ratio = (
        round(len(feedback["beats_covered"]) / max(len(beats), 1), 4)
        if beats
        else 0.0
    )

    try:
        new_id = await dal.record_attempt(
            db,
            scenario_id=scenario["id"],
            transcript=transcript,
            duration_seconds=float(payload.duration_seconds),
            word_count=word_count,
            filler_count=filler_count,
            wpm=wpm,
            coverage_ratio=coverage_ratio,
            fluency_score=int(feedback["fluency_score"]),
            structure_score=int(feedback["structure_score"]),
            overall_score=int(feedback["overall_score"]),
            feedback=feedback,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist monologue attempt")
        raise HTTPException(status_code=500, detail="Failed to save attempt")

    return MonologueAttemptResponse(
        id=new_id,
        scenario_id=scenario["id"],
        duration_seconds=float(payload.duration_seconds),
        word_count=word_count,
        filler_count=filler_count,
        wpm=wpm,
        coverage_ratio=coverage_ratio,
        fluency_score=int(feedback["fluency_score"]),
        structure_score=int(feedback["structure_score"]),
        overall_score=int(feedback["overall_score"]),
        feedback=MonologueFeedback(**feedback),
    )


@router.get("/history", response_model=MonologueHistoryResponse)
async def get_history(
    scenario_id: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> MonologueHistoryResponse:
    """Return recent attempts and (if scenario_id) personal best."""
    try:
        attempts = await dal.get_history(
            db, scenario_id=scenario_id, limit=limit
        )
        best = (
            await dal.get_personal_best(db, scenario_id=scenario_id)
            if scenario_id
            else None
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to load monologue history")
        raise HTTPException(status_code=500, detail="Failed to load history")

    return MonologueHistoryResponse(
        attempts=[MonologueHistoryItem(**a) for a in attempts],
        personal_best=MonologueHistoryItem(**best) if best else None,
    )
