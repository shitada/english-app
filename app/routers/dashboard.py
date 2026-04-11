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

    stats["conversations_by_topic"] = [
        {**item, "topic": get_topic_label(topics, item["topic"])}
        for item in stats["conversations_by_topic"]
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


@router.get("/today")
async def get_today_activity(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get today's activity counts across all modules."""
    return await dash_dal.get_today_activity(db)


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


@router.get("/migration-status")
async def migration_status(db: aiosqlite.Connection = Depends(get_db_session)):
    """Return current database migration version and history."""
    try:
        rows = await db.execute_fetchall(
            "SELECT version, description, applied_at FROM schema_migrations ORDER BY version"
        )
        migrations = [
            {"version": r["version"], "description": r["description"], "applied_at": r["applied_at"]}
            for r in rows
        ]
    except Exception:
        migrations = []
    from app.database import _MIGRATIONS
    return {
        "total_defined": len(_MIGRATIONS),
        "total_applied": len(migrations),
        "current_version": migrations[-1]["version"] if migrations else -1,
        "migrations": migrations,
    }


class MistakeDetail(BaseModel):
    """Flexible detail field for different mistake types."""
    model_config = {"extra": "allow"}


class MistakeItem(BaseModel):
    module: str
    detail: dict[str, Any]
    created_at: str


class MistakeJournalResponse(BaseModel):
    items: list[MistakeItem]
    total_count: int


@router.get("/mistakes", response_model=MistakeJournalResponse)
async def get_mistake_journal(
    module: str = Query(default="all", pattern="^(all|grammar|pronunciation|vocabulary)$"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get aggregated mistakes from all learning modules."""
    return await dash_dal.get_mistake_journal(db, module=module, limit=limit, offset=offset)


class AchievementProgress(BaseModel):
    current: int
    target: int


class AchievementItem(BaseModel):
    id: str
    title: str
    description: str
    emoji: str
    category: str
    target: int
    unlocked: bool
    progress: AchievementProgress


class AchievementsResponse(BaseModel):
    achievements: list[AchievementItem]
    unlocked_count: int
    total_count: int


class WeeklyReportResponse(BaseModel):
    week_start: str
    week_end: str
    conversations: int
    messages_sent: int
    vocabulary_reviewed: int
    quiz_accuracy: float
    pronunciation_attempts: int
    avg_pronunciation_score: float
    grammar_accuracy: float
    streak: int
    highlights: list[str]
    text_summary: str


@router.get("/achievements", response_model=AchievementsResponse)
async def get_achievements(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get computed achievement badges based on learning progress."""
    return await dash_dal.get_achievements(db)


@router.get("/weekly-report", response_model=WeeklyReportResponse)
async def get_weekly_report(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get weekly progress report with aggregated stats and highlights."""
    return await dash_dal.get_weekly_report(db)


class GrammarTrendItem(BaseModel):
    conversation_id: int
    topic: str
    difficulty: str
    started_at: str
    checked_count: int
    correct_count: int
    accuracy_rate: float


class GrammarTrendResponse(BaseModel):
    conversations: list[GrammarTrendItem]
    trend: str


@router.get("/grammar-trend", response_model=GrammarTrendResponse)
async def get_grammar_trend(
    limit: int = Query(default=20, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get per-conversation grammar accuracy trend for progress visualization."""
    return await dash_dal.get_grammar_trend(db, limit=limit)


class MistakeReviewItem(BaseModel):
    original: str
    correction: str
    explanation: str
    topic: str
    created_at: str


class MistakeReviewResponse(BaseModel):
    items: list[MistakeReviewItem]
    total: int


@router.get("/mistakes/review", response_model=MistakeReviewResponse)
async def get_mistake_review(
    count: int = Query(default=10, ge=1, le=30),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get grammar mistakes formatted as correction drill items for active review."""
    items = await dash_dal.get_mistake_review_items(db, count=count)
    return {"items": items, "total": len(items)}


class ConfidenceSession(BaseModel):
    conversation_id: int
    topic: str
    difficulty: str
    started_at: str
    score: float
    grammar_score: float
    diversity_score: float
    complexity_score: float
    participation_score: float


class ConfidenceTrendResponse(BaseModel):
    sessions: list[ConfidenceSession]
    trend: str


@router.get("/confidence-trend", response_model=ConfidenceTrendResponse)
async def get_confidence_trend(
    limit: int = Query(default=20, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get speaking confidence scores and trend across recent conversations."""
    return await dash_dal.get_confidence_trend(db, limit=limit)


class DailyChallengeResponse(BaseModel):
    challenge_type: str
    title: str
    description: str
    target_count: int
    current_count: int
    completed: bool
    route: str
    topic: str


@router.get("/daily-challenge", response_model=DailyChallengeResponse)
async def get_daily_challenge(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get today's personalized daily challenge based on weakest module."""
    return await dash_dal.get_daily_challenge(db)


class WordOfTheDayResponse(BaseModel):
    word_id: int
    word: str
    meaning: str
    example_sentence: str
    topic: str
    difficulty: int | str | None = None


@router.get("/word-of-the-day")
async def get_word_of_the_day(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get today's word-of-the-day from vocabulary words."""
    from fastapi.responses import JSONResponse
    result = await dash_dal.get_word_of_the_day(db)
    if result is None:
        return JSONResponse(status_code=204, content=None)
    return WordOfTheDayResponse(**result)


class SkillAxis(BaseModel):
    name: str
    score: int
    label: str


class SkillRadarResponse(BaseModel):
    skills: list[SkillAxis]


@router.get("/skill-radar", response_model=SkillRadarResponse)
async def get_skill_radar(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get 5-axis skill radar scores for the dashboard chart."""
    skills = await dash_dal.get_skill_radar(db)
    return {"skills": skills}


class RecentActivityItem(BaseModel):
    type: str
    detail: str
    timestamp: str
    route: str


class RecentActivityResponse(BaseModel):
    items: list[RecentActivityItem]


@router.get("/recent-activity", response_model=RecentActivityResponse)
async def get_recent_activity(
    limit: int = Query(default=5, ge=1, le=20),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get recent learning activity feed for the Home page."""
    items = await dash_dal.get_recent_activity(db, limit=limit)
    return {"items": items}


# --- Session Analytics ---

class ModuleAnalytics(BaseModel):
    module: str
    total_seconds: int
    session_count: int


class DailyAnalytics(BaseModel):
    date: str
    conversation_seconds: int
    pronunciation_seconds: int
    vocabulary_seconds: int


class SessionAnalyticsResponse(BaseModel):
    modules: list[ModuleAnalytics]
    daily: list[DailyAnalytics]


@router.get("/session-analytics", response_model=SessionAnalyticsResponse)
async def get_session_analytics(
    days: int = Query(default=7, ge=1, le=90),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get time spent per exercise module over the specified number of days."""
    data = await dash_dal.get_session_analytics(db, days=days)
    return data


# --- Listening Progress ---

class DifficultyStats(BaseModel):
    difficulty: str
    count: int
    avg_score: float


class ListeningProgressResponse(BaseModel):
    total_quizzes: int
    avg_score: float
    best_score: float
    by_difficulty: list[DifficultyStats]
    trend: str


@router.get("/listening-progress", response_model=ListeningProgressResponse)
async def get_listening_progress(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get listening quiz progress statistics."""
    data = await dash_dal.get_listening_progress(db)
    return data


class ModuleStreakItem(BaseModel):
    current_streak: int
    last_active: str | None


class ModuleStreaksResponse(BaseModel):
    overall_streak: int
    modules: dict[str, ModuleStreakItem]
    most_consistent: str | None
    least_consistent: str | None


@router.get("/module-streaks", response_model=ModuleStreaksResponse)
async def get_module_streaks(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get per-module study streak breakdown."""
    data = await dash_dal.get_module_streaks(db)
    return data


# ── Learning Velocity ──────────────────────────────────────────


class WeeklyActivity(BaseModel):
    week: str
    new_words: int
    quiz_attempts: int
    conversations: int
    pronunciation_attempts: int


class CurrentPace(BaseModel):
    words_per_day: float
    quizzes_per_day: float
    conversations_per_day: float
    pronunciation_per_day: float


class LearningVelocityResponse(BaseModel):
    weekly_data: list[WeeklyActivity]
    current_pace: CurrentPace
    trend: str
    total_active_days: int
    words_per_study_day: float


@router.get("/learning-velocity", response_model=LearningVelocityResponse)
async def get_learning_velocity(
    weeks: int = Query(default=8, ge=2, le=52),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get learning velocity analytics with weekly pace tracking."""
    return await dash_dal.get_learning_velocity(db, weeks=weeks)


# --- Grammar Weak Spots ---


class GrammarCategoryItem(BaseModel):
    name: str
    total_count: int
    recent_count: int
    older_count: int
    trend: str


class GrammarWeakSpotsResponse(BaseModel):
    categories: list[GrammarCategoryItem]
    total_errors: int
    category_count: int
    most_common_category: str | None


@router.get("/grammar-weak-spots", response_model=GrammarWeakSpotsResponse)
async def get_grammar_weak_spots(
    limit: int = Query(default=10, ge=1, le=50),
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Analyse grammar errors by category with trend data."""
    return await dash_dal.get_grammar_weak_spots(db, limit=limit)
