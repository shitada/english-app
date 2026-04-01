"""Dashboard/stats API endpoints."""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, Query
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


class LevelDistribution(BaseModel):
    level: int
    count: int


class TopicBreakdown(BaseModel):
    topic: str
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
    vocab_level_distribution: list[LevelDistribution]
    conversations_by_topic: list[TopicBreakdown]
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


class DailyActivityItem(BaseModel):
    date: str
    conversations: int
    messages: int
    pronunciation_attempts: int
    vocabulary_reviews: int


class ActivityHistoryResponse(BaseModel):
    days: int
    history: list[DailyActivityItem]


@router.get("/activity-history", response_model=ActivityHistoryResponse)
async def get_activity_history(
    days: int = Query(default=30, ge=1, le=365),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get daily learning activity counts for the past N days."""
    history = await dash_dal.get_daily_activity(db, days=days)
    return {"days": days, "history": history}


class MilestoneItem(BaseModel):
    days: int
    label: str
    achieved: bool


class NextMilestone(BaseModel):
    days: int
    label: str
    days_remaining: int


class StreakMilestonesResponse(BaseModel):
    current_streak: int
    longest_streak: int
    milestones: list[MilestoneItem]
    next_milestone: NextMilestone | None


@router.get("/streak-milestones", response_model=StreakMilestonesResponse)
async def get_streak_milestones(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get study streak with milestone achievements."""
    return await dash_dal.get_streak_milestones(db)
