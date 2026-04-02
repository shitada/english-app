"""Dashboard/stats API endpoints."""

from __future__ import annotations

import logging
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

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


class DifficultyDuration(BaseModel):
    difficulty: str
    count: int
    avg_duration_seconds: int


class ConversationDurationResponse(BaseModel):
    total_completed: int
    total_duration_seconds: int
    avg_duration_seconds: int
    shortest_duration_seconds: int
    longest_duration_seconds: int
    duration_by_difficulty: list[DifficultyDuration]


@router.get("/conversation-duration", response_model=ConversationDurationResponse)
async def get_conversation_duration(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get aggregate conversation duration statistics."""
    return await dash_dal.get_conversation_duration_stats(db)


class AppConfigResponse(BaseModel):
    conversation_topics_count: int
    vocabulary_topics_count: int
    rate_limit: str
    max_message_length: int
    max_pronunciation_length: int
    sm2_intervals: list[int]


@router.get("/config", response_model=AppConfigResponse)
async def get_app_config():
    """Get application configuration summary."""
    from app.config import get_vocabulary_topics
    conv_topics = get_conversation_topics()
    vocab_topics = get_vocabulary_topics()
    return {
        "conversation_topics_count": len(conv_topics),
        "vocabulary_topics_count": len(vocab_topics),
        "rate_limit": "20 requests per minute",
        "max_message_length": 2000,
        "max_pronunciation_length": 1000,
        "sm2_intervals": [0, 1, 3, 7, 14, 30, 60],
    }


class LearningSummaryResponse(BaseModel):
    total_study_days: int
    words_learning: int
    total_quiz_attempts: int
    quiz_accuracy_percent: float


@router.get("/summary", response_model=LearningSummaryResponse)
async def get_learning_summary(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get a high-level learning progress summary."""
    return await dash_dal.get_learning_summary(db)


class ModuleStrengths(BaseModel):
    conversation: float
    vocabulary: float
    pronunciation: float


class WeeklyCount(BaseModel):
    this_week: int
    last_week: int


class WeeklyComparison(BaseModel):
    conversations: WeeklyCount
    vocabulary: WeeklyCount
    pronunciation: WeeklyCount


class LearningInsightsResponse(BaseModel):
    streak: int
    streak_at_risk: bool
    module_strengths: ModuleStrengths
    strongest_area: str | None
    weakest_area: str | None
    recommendations: list[str]
    weekly_comparison: WeeklyComparison


@router.get("/insights", response_model=LearningInsightsResponse)
async def get_learning_insights(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get cross-module learning insights with personalized recommendations."""
    return await dash_dal.get_learning_insights(db)


class SetGoalRequest(BaseModel):
    goal_type: str = Field(max_length=50)
    daily_target: int = Field(ge=1, le=100)


@router.get("/goals")
async def get_goals(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get all learning goals with today's progress."""
    return await dash_dal.get_learning_goals(db)


@router.post("/goals")
async def set_goal(req: SetGoalRequest, db: aiosqlite.Connection = Depends(get_db_session)):
    """Set or update a daily learning goal."""
    valid_types = {"conversations", "vocabulary_reviews", "pronunciation_attempts"}
    if req.goal_type not in valid_types:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Invalid goal_type. Must be one of: {valid_types}")
    return await dash_dal.set_learning_goal(db, req.goal_type, req.daily_target)


@router.delete("/goals/{goal_type}")
async def delete_goal(goal_type: str, db: aiosqlite.Connection = Depends(get_db_session)):
    """Delete a learning goal."""
    deleted = await dash_dal.delete_learning_goal(db, goal_type)
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"deleted": True}
