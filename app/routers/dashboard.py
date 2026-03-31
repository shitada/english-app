"""Dashboard/stats API endpoints."""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import get_conversation_topics
from app.dal import dashboard as dash_dal
from app.database import get_db_session
from app.utils import get_topic_label

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


class ActivityItem(BaseModel):
    type: str
    detail: str
    timestamp: str


class DifficultyBreakdown(BaseModel):
    difficulty: str
    count: int


class DashboardStatsResponse(BaseModel):
    streak: int
    total_conversations: int
    total_messages: int
    total_pronunciation: int
    avg_pronunciation_score: float
    total_vocab_reviewed: int
    vocab_mastered: int
    vocab_due_count: int
    conversations_by_difficulty: list[DifficultyBreakdown]
    grammar_accuracy: float
    recent_activity: list[ActivityItem]


@router.get("/stats", response_model=DashboardStatsResponse)
async def get_stats(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get learning statistics for the dashboard."""
    stats = await dash_dal.get_stats(db)

    # Convert raw topic keys to human-readable labels for conversation activities
    topics = get_conversation_topics()
    stats["recent_activity"] = [
        {
            **item,
            "detail": get_topic_label(topics, item["detail"])
        }
        if item["type"] == "conversation"
        else item
        for item in stats["recent_activity"]
    ]

    return stats
