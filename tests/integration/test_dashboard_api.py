"""Integration tests for the dashboard stats API endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestDashboardStats:
    async def test_empty_database_returns_zeroed_stats(self, client: AsyncClient):
        """An empty DB should return zero counts and empty activity."""
        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["streak"] == 0
        assert data["total_conversations"] == 0
        assert data["total_messages"] == 0
        assert data["total_pronunciation"] == 0
        assert data["avg_pronunciation_score"] == 0
        assert data["total_vocab_reviewed"] == 0
        assert data["vocab_mastered"] == 0
        assert data["recent_activity"] == []

    async def test_stats_reflect_conversations(self, client: AsyncClient):
        """Stats should count conversations and user messages."""
        # Start a conversation
        resp = await client.post(
            "/api/conversation/start",
            json={"topic": "hotel_checkin", "difficulty": "beginner"},
        )
        assert resp.status_code == 200
        cid = resp.json()["conversation_id"]

        # Send a message
        resp = await client.post(
            "/api/conversation/message",
            json={"conversation_id": cid, "content": "Hello, I need a room."},
        )
        assert resp.status_code == 200

        # Check dashboard
        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_conversations"] >= 1
        assert data["total_messages"] >= 1

        # Verify conversations_by_topic uses labels, not raw IDs
        for item in data.get("conversations_by_topic", []):
            assert item["topic"] != "hotel_checkin", "Topic should be a label, not a raw ID"

    async def test_stats_reflect_pronunciation(self, client: AsyncClient):
        """Stats should count pronunciation attempts and compute avg score."""
        resp = await client.post(
            "/api/pronunciation/check",
            json={
                "reference_text": "Good morning",
                "user_transcription": "Good morning",
            },
        )
        assert resp.status_code == 200

        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_pronunciation"] >= 1

    async def test_stats_reflect_vocabulary(self, client: AsyncClient, mock_copilot):
        """Stats should count vocabulary progress."""
        # Generate a quiz (mocked LLM returns words)
        mock_copilot.ask_json.return_value = {
            "questions": [
                {"word": "hello", "correct_meaning": "greeting", "example_sentence": "Hello!", "difficulty": 1},
                {"word": "goodbye", "correct_meaning": "farewell", "example_sentence": "Goodbye!", "difficulty": 1},
            ]
        }
        resp = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=2")
        assert resp.status_code == 200
        questions = resp.json()["questions"]
        assert len(questions) >= 1

        word_id = questions[0]["id"]

        # Submit correct answer
        resp = await client.post(
            "/api/vocabulary/answer",
            json={"word_id": word_id, "is_correct": True},
        )
        assert resp.status_code == 200

        # Check dashboard
        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_vocab_reviewed"] >= 1

    async def test_recent_activity_includes_all_types(self, client: AsyncClient, mock_copilot):
        """Recent activity should include conversations, pronunciation, and vocabulary."""
        # Create a conversation
        resp = await client.post(
            "/api/conversation/start",
            json={"topic": "hotel_checkin", "difficulty": "intermediate"},
        )
        assert resp.status_code == 200

        # Create a pronunciation attempt
        resp = await client.post(
            "/api/pronunciation/check",
            json={"reference_text": "Hello", "user_transcription": "Hello"},
        )
        assert resp.status_code == 200

        # Create vocabulary activity
        mock_copilot.ask_json.return_value = {
            "questions": [
                {"word": "test", "correct_meaning": "exam", "example_sentence": "Take a test.", "difficulty": 1},
            ]
        }
        resp = await client.get("/api/vocabulary/quiz?topic=shopping&count=1")
        assert resp.status_code == 200
        word_id = resp.json()["questions"][0]["id"]
        await client.post("/api/vocabulary/answer", json={"word_id": word_id, "is_correct": True})

        # Check dashboard activity
        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        activity = resp.json()["recent_activity"]
        activity_types = {item["type"] for item in activity}
        assert "conversation" in activity_types
        assert "pronunciation" in activity_types
        assert "vocabulary" in activity_types

    async def test_recent_activity_limited_to_7(self, client: AsyncClient):
        """Recent activity should return at most 7 items."""
        # Create 10 pronunciation attempts
        for i in range(10):
            await client.post(
                "/api/pronunciation/check",
                json={"reference_text": f"Sentence {i}", "user_transcription": f"Sentence {i}"},
            )

        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        activity = resp.json()["recent_activity"]
        assert len(activity) <= 7

    async def test_response_matches_pydantic_model(self, client: AsyncClient):
        """The response should have all expected fields with correct types."""
        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["streak"], int)
        assert isinstance(data["total_conversations"], int)
        assert isinstance(data["total_messages"], int)
        assert isinstance(data["total_pronunciation"], int)
        assert isinstance(data["avg_pronunciation_score"], (int, float))
        assert isinstance(data["total_vocab_reviewed"], int)
        assert isinstance(data["vocab_mastered"], int)
        assert isinstance(data["recent_activity"], list)


@pytest.mark.integration
class TestActivityHistory:
    async def test_returns_history(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/activity-history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["days"] == 30
        assert isinstance(data["history"], list)
        assert len(data["history"]) > 0

    async def test_custom_days_param(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/activity-history?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert data["days"] == 7

    async def test_invalid_days_param(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/activity-history?days=0")
        assert resp.status_code == 422


@pytest.mark.integration
class TestStreakMilestones:
    async def test_returns_milestones(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/streak-milestones")
        assert resp.status_code == 200
        data = resp.json()
        assert "current_streak" in data
        assert "longest_streak" in data
        assert len(data["milestones"]) == 5
        assert data["milestones"][0]["days"] == 7


@pytest.mark.integration
class TestConversationDuration:
    async def test_returns_duration_stats(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/conversation-duration")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_completed" in data
        assert "avg_duration_seconds" in data
        assert "duration_by_difficulty" in data


@pytest.mark.integration
class TestAppConfig:
    async def test_returns_config(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["conversation_topics_count"] > 0
        assert data["vocabulary_topics_count"] > 0
        assert "rate_limit" in data
        assert "sm2_intervals" in data


@pytest.mark.integration
class TestLearningSummary:
    async def test_returns_summary(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_study_days" in data
        assert "words_learning" in data
        assert "quiz_accuracy_percent" in data
        assert isinstance(data["total_study_days"], int)


@pytest.mark.integration
class TestLearningInsights:
    async def test_returns_correct_shape(self, client: AsyncClient):
        """Insights endpoint returns 200 with correct response shape."""
        resp = await client.get("/api/dashboard/insights")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["streak"], int)
        assert isinstance(data["streak_at_risk"], bool)
        assert isinstance(data["module_strengths"], dict)
        assert "conversation" in data["module_strengths"]
        assert "vocabulary" in data["module_strengths"]
        assert "pronunciation" in data["module_strengths"]
        assert data["strongest_area"] is None or isinstance(data["strongest_area"], str)
        assert data["weakest_area"] is None or isinstance(data["weakest_area"], str)
        assert isinstance(data["recommendations"], list)
        assert isinstance(data["weekly_comparison"], dict)
        for module in ("conversations", "vocabulary", "pronunciation"):
            assert "this_week" in data["weekly_comparison"][module]
            assert "last_week" in data["weekly_comparison"][module]


@pytest.mark.integration
async def test_goals_empty(client):
    res = await client.get("/api/dashboard/goals")
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.integration
async def test_set_goal(client):
    res = await client.post("/api/dashboard/goals", json={"goal_type": "conversations", "daily_target": 3})
    assert res.status_code == 200
    data = res.json()
    assert data["goal_type"] == "conversations"
    assert data["daily_target"] == 3


@pytest.mark.integration
async def test_set_goal_invalid_type(client):
    res = await client.post("/api/dashboard/goals", json={"goal_type": "invalid", "daily_target": 3})
    assert res.status_code == 400


@pytest.mark.integration
async def test_delete_goal(client):
    await client.post("/api/dashboard/goals", json={"goal_type": "conversations", "daily_target": 3})
    res = await client.delete("/api/dashboard/goals/conversations")
    assert res.status_code == 200


@pytest.mark.integration
async def test_delete_goal_not_found(client):
    res = await client.delete("/api/dashboard/goals/nonexistent")
    assert res.status_code == 404


@pytest.mark.integration
async def test_get_today_activity(client):
    res = await client.get("/api/dashboard/today")
    assert res.status_code == 200
    data = res.json()
    assert "conversations" in data
    assert "vocabulary_reviews" in data
    assert "pronunciation_attempts" in data
    assert data["conversations"] >= 0


@pytest.mark.integration
async def test_mistake_journal_empty(client):
    """Mistake journal returns empty list when no mistakes exist."""
    res = await client.get("/api/dashboard/mistakes")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []
    assert data["total_count"] == 0


@pytest.mark.integration
async def test_mistake_journal_with_pronunciation(client, mock_copilot):
    """Low-score pronunciation attempts appear in mistake journal."""
    from unittest.mock import AsyncMock
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 3.0,
        "overall_feedback": "Needs work",
        "word_feedback": [],
        "focus_areas": [],
    })
    await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world",
        "user_transcription": "Helo word",
    })
    res = await client.get("/api/dashboard/mistakes?module=pronunciation")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] >= 1
    assert data["items"][0]["module"] == "pronunciation"


@pytest.mark.integration
async def test_mistake_journal_filter(client):
    """Filter parameter restricts results to specified module."""
    res = await client.get("/api/dashboard/mistakes?module=vocabulary")
    assert res.status_code == 200
    data = res.json()
    for item in data["items"]:
        assert item["module"] == "vocabulary"


@pytest.mark.integration
async def test_mistake_journal_pagination(client):
    """Pagination params are accepted."""
    res = await client.get("/api/dashboard/mistakes?limit=5&offset=0")
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) <= 5


@pytest.mark.integration
async def test_achievements_empty(client):
    """Achievements endpoint returns all badges with none unlocked when fresh."""
    res = await client.get("/api/dashboard/achievements")
    assert res.status_code == 200
    data = res.json()
    assert "achievements" in data
    assert data["total_count"] == 15
    assert data["unlocked_count"] == 0
    for a in data["achievements"]:
        assert "id" in a
        assert "title" in a
        assert "emoji" in a
        assert "unlocked" in a
        assert "progress" in a


@pytest.mark.integration
async def test_achievements_unlocked_after_activity(client, mock_copilot):
    """Achievements unlock after completing activities."""
    from unittest.mock import AsyncMock
    mock_copilot.ask = AsyncMock(return_value="Hello, welcome!")
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 9.5, "overall_feedback": "Perfect",
        "word_feedback": [], "focus_areas": [],
    })
    # Start a conversation (unlocks First Chat + All-Rounder progress)
    start = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start.json()["conversation_id"]
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Do a pronunciation attempt (unlocks First Try + Perfect Score)
    await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello", "user_transcription": "Hello",
    })

    res = await client.get("/api/dashboard/achievements")
    data = res.json()
    assert data["unlocked_count"] >= 2  # At least First Chat + First Try
    unlocked_ids = [a["id"] for a in data["achievements"] if a["unlocked"]]
    assert "conv_1" in unlocked_ids
    assert "pron_1" in unlocked_ids


@pytest.mark.integration
async def test_skill_radar_returns_five_axes(client):
    """Skill radar endpoint returns 5 skill axes with valid scores."""
    res = await client.get("/api/dashboard/skill-radar")
    assert res.status_code == 200
    data = res.json()
    assert "skills" in data
    assert len(data["skills"]) == 5
    names = {s["name"] for s in data["skills"]}
    assert names == {"speaking", "listening", "vocabulary", "grammar", "pronunciation"}
    for s in data["skills"]:
        assert 0 <= s["score"] <= 100
        assert isinstance(s["label"], str)


@pytest.mark.integration
async def test_recent_activity_empty(client):
    """Recent activity returns empty list on fresh DB."""
    res = await client.get("/api/dashboard/recent-activity")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []


@pytest.mark.integration
async def test_recent_activity_after_conversation(client, mock_copilot):
    """Recent activity returns items after creating a conversation."""
    from unittest.mock import AsyncMock
    mock_copilot.ask_json = AsyncMock(return_value={"reply": "Hello", "feedback": None})
    await client.post("/api/conversation/start", json={"topic": "hotel_checkin", "difficulty": "beginner"})
    res = await client.get("/api/dashboard/recent-activity?limit=5")
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) >= 1
    item = data["items"][0]
    assert item["type"] == "conversation"
    assert item["route"] == "/conversation"
    assert "timestamp" in item


# ── Tests for untested dashboard endpoints ──────────────────────────


@pytest.mark.integration
async def test_weekly_report_empty(client):
    """Weekly report on empty DB returns valid structure."""
    res = await client.get("/api/dashboard/weekly-report")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["week_start"], str)
    assert isinstance(data["week_end"], str)
    assert data["conversations"] == 0
    assert data["streak"] == 0
    assert isinstance(data["highlights"], list)
    assert isinstance(data["text_summary"], str)


@pytest.mark.integration
async def test_grammar_trend_empty(client):
    """Grammar trend returns empty conversations list."""
    res = await client.get("/api/dashboard/grammar-trend")
    assert res.status_code == 200
    data = res.json()
    assert data["conversations"] == []
    assert isinstance(data["trend"], str)


@pytest.mark.integration
async def test_grammar_trend_limit_param(client):
    """Grammar trend respects limit parameter."""
    res = await client.get("/api/dashboard/grammar-trend?limit=5")
    assert res.status_code == 200
    data = res.json()
    assert len(data["conversations"]) <= 5


@pytest.mark.integration
async def test_confidence_trend_empty(client):
    """Confidence trend returns empty sessions."""
    res = await client.get("/api/dashboard/confidence-trend")
    assert res.status_code == 200
    data = res.json()
    assert data["sessions"] == []
    assert isinstance(data["trend"], str)


@pytest.mark.integration
async def test_daily_challenge_structure(client):
    """Daily challenge returns valid structure."""
    res = await client.get("/api/dashboard/daily-challenge")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["challenge_type"], str)
    assert isinstance(data["title"], str)
    assert isinstance(data["description"], str)
    assert isinstance(data["target_count"], int)
    assert isinstance(data["current_count"], int)
    assert isinstance(data["completed"], bool)
    assert isinstance(data["route"], str)
    assert isinstance(data["topic"], str)


@pytest.mark.integration
async def test_word_of_the_day_empty(client):
    """Word of the day on empty DB returns 204."""
    res = await client.get("/api/dashboard/word-of-the-day")
    assert res.status_code == 204


@pytest.mark.integration
async def test_mistakes_review_empty(client):
    """Mistake review returns empty items list."""
    res = await client.get("/api/dashboard/mistakes/review")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.integration
async def test_session_analytics_empty(client):
    """Session analytics returns modules and daily arrays."""
    res = await client.get("/api/dashboard/session-analytics")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["modules"], list)
    assert isinstance(data["daily"], list)


@pytest.mark.integration
async def test_session_analytics_days_param(client):
    """Session analytics accepts days parameter."""
    res = await client.get("/api/dashboard/session-analytics?days=30")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["modules"], list)


@pytest.mark.integration
async def test_migration_status_structure(client):
    """Migration status returns valid structure."""
    res = await client.get("/api/dashboard/migration-status")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["total_defined"], int)
    assert isinstance(data["total_applied"], int)
    assert isinstance(data["current_version"], int)
    assert isinstance(data["migrations"], list)


# ── Listening Progress ──────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listening_progress_empty(client):
    """GET /listening-progress returns zeroed structure on empty DB."""
    res = await client.get("/api/dashboard/listening-progress")
    assert res.status_code == 200
    data = res.json()
    assert data["total_quizzes"] == 0
    assert data["avg_score"] == 0
    assert data["best_score"] == 0
    assert data["by_difficulty"] == []
    assert data["trend"] == "insufficient_data"


async def _seed_listening_quizzes(client, entries: list[tuple[str, float]]):
    """Helper to seed listening quiz results. entries = [(difficulty, score), ...]"""
    for difficulty, score in entries:
        total = 5
        correct = round(score / 100 * total)
        body = {
            "title": f"Quiz {difficulty}",
            "difficulty": difficulty,
            "total_questions": total,
            "correct_count": correct,
            "score": score,
        }
        r = await client.post("/api/pronunciation/listening-quiz/results", json=body)
        assert r.status_code == 200


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listening_progress_with_data(client):
    """GET /listening-progress returns correct stats after quiz submissions."""
    await _seed_listening_quizzes(client, [
        ("beginner", 80.0),
        ("beginner", 90.0),
        ("intermediate", 60.0),
    ])

    res = await client.get("/api/dashboard/listening-progress")
    assert res.status_code == 200
    data = res.json()
    assert data["total_quizzes"] == 3
    assert data["best_score"] == 90.0
    assert 70 < data["avg_score"] < 80  # (80+90+60)/3 ≈ 76.7
    assert len(data["by_difficulty"]) == 2

    beginner = next(d for d in data["by_difficulty"] if d["difficulty"] == "beginner")
    assert beginner["count"] == 2
    assert beginner["avg_score"] == 85.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listening_progress_trend(client):
    """GET /listening-progress shows trend when enough data exists."""
    # 5 older low scores + 5 recent high scores → improving
    await _seed_listening_quizzes(client, [
        ("beginner", 40.0),
        ("beginner", 35.0),
        ("beginner", 45.0),
        ("beginner", 40.0),
        ("beginner", 38.0),
        ("beginner", 85.0),
        ("beginner", 90.0),
        ("beginner", 88.0),
        ("beginner", 92.0),
        ("beginner", 95.0),
    ])

    res = await client.get("/api/dashboard/listening-progress")
    assert res.status_code == 200
    data = res.json()
    assert data["trend"] in ("improving", "stable", "declining")
    assert data["total_quizzes"] == 10


@pytest.mark.integration
async def test_module_streaks_empty(client):
    """GET /module-streaks returns all zeros on empty DB."""
    res = await client.get("/api/dashboard/module-streaks")
    assert res.status_code == 200
    data = res.json()
    assert data["overall_streak"] == 0
    assert "conversation" in data["modules"]
    assert "vocabulary" in data["modules"]
    assert "pronunciation" in data["modules"]
    assert "listening" in data["modules"]
    for mod in data["modules"].values():
        assert mod["current_streak"] == 0


@pytest.mark.integration
async def test_module_streaks_with_activity(client):
    """GET /module-streaks reflects activity after a conversation message."""
    # Create conversation activity
    res = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin", "difficulty": "beginner"},
    )
    assert res.status_code == 200
    conv_id = res.json()["conversation_id"]
    await client.post(
        "/api/conversation/message",
        json={"conversation_id": conv_id, "content": "Hello"},
    )

    res = await client.get("/api/dashboard/module-streaks")
    assert res.status_code == 200
    data = res.json()
    assert data["modules"]["conversation"]["current_streak"] >= 1
    assert data["modules"]["conversation"]["last_active"] is not None
    assert data["most_consistent"] == "conversation"


@pytest.mark.integration
async def test_learning_velocity_endpoint(client):
    """GET /learning-velocity returns expected fields."""
    resp = await client.get("/api/dashboard/learning-velocity")
    assert resp.status_code == 200
    data = resp.json()
    assert "weekly_data" in data
    assert "current_pace" in data
    assert "trend" in data
    assert "total_active_days" in data
    assert "words_per_study_day" in data


@pytest.mark.integration
async def test_learning_velocity_custom_weeks(client):
    """GET /learning-velocity accepts weeks query param."""
    resp = await client.get("/api/dashboard/learning-velocity?weeks=4")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["weekly_data"], list)
