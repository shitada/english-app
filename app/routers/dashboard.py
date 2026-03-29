"""Dashboard/stats API endpoints."""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dal import dashboard as dash_dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


class ActivityItem(BaseModel):
    type: str
    detail: str
    timestamp: str


class DashboardStatsResponse(BaseModel):
    streak: int
    total_conversations: int
    total_messages: int
    total_pronunciation: int
    avg_pronunciation_score: float
    total_vocab_reviewed: int
    vocab_mastered: int
    recent_activity: list[ActivityItem]


@router.get("/stats", response_model=DashboardStatsResponse)
async def get_stats(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get learning statistics for the dashboard."""
    return await dash_dal.get_stats(db)
