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


# --- Grammar Weak Spots ---


@pytest.mark.integration
async def test_grammar_weak_spots_empty(client):
    """GET /grammar-weak-spots returns empty results when no data."""
    resp = await client.get("/api/dashboard/grammar-weak-spots")
    assert resp.status_code == 200
    data = resp.json()
    assert data["categories"] == []
    assert data["total_errors"] == 0
    assert data["category_count"] == 0
    assert data["most_common_category"] is None


@pytest.mark.integration
async def test_grammar_weak_spots_limit(client):
    """GET /grammar-weak-spots accepts limit query param."""
    resp = await client.get("/api/dashboard/grammar-weak-spots?limit=3")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["categories"], list)


# --- Vocabulary Retention Forecast ---


@pytest.mark.integration
async def test_vocabulary_forecast_empty(client):
    """GET /vocabulary-forecast returns empty results when no data."""
    resp = await client.get("/api/dashboard/vocabulary-forecast")
    assert resp.status_code == 200
    data = resp.json()
    assert data["at_risk_words"] == []
    assert data["total_reviewed"] == 0
    assert data["avg_retention_score"] == 100


@pytest.mark.integration
async def test_vocabulary_forecast_limit(client):
    """GET /vocabulary-forecast accepts limit query param."""
    resp = await client.get("/api/dashboard/vocabulary-forecast?limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["at_risk_words"], list)


# --- Data-populated tests for Grammar Weak Spots ---


@pytest.mark.integration
async def test_grammar_weak_spots_with_errors(client, test_db):
    """GET /grammar-weak-spots returns categories when grammar errors exist."""
    import json

    # Create a conversation
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at) VALUES (?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "active", "2026-04-10T10:00:00+00:00"),
    )
    conv_id = (await (await test_db.execute("SELECT last_insert_rowid()")).fetchone())[0]

    # Insert user messages with feedback containing grammar errors
    feedback_article = json.dumps({
        "corrected_text": "I would like a room.",
        "is_correct": False,
        "errors": [
            {"original": "I would like room", "corrected": "I would like a room", "explanation": "Missing article 'a' before singular countable noun."},
        ],
    })
    feedback_tense = json.dumps({
        "corrected_text": "I went there yesterday.",
        "is_correct": False,
        "errors": [
            {"original": "I go there yesterday", "corrected": "I went there yesterday", "explanation": "Use past tense for completed actions."},
            {"original": "I has been", "corrected": "I have been", "explanation": "Subject-verb agreement: 'I' requires 'have', not 'has'."},
        ],
    })
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (conv_id, "user", "I would like room", feedback_article, "2026-04-10T10:01:00+00:00"),
    )
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (conv_id, "user", "I go there yesterday", feedback_tense, "2026-04-10T10:02:00+00:00"),
    )
    await test_db.commit()

    resp = await client.get("/api/dashboard/grammar-weak-spots")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_errors"] == 3
    assert data["category_count"] >= 2
    assert data["most_common_category"] is not None
    assert len(data["categories"]) >= 2
    # Each category must have valid fields
    for cat in data["categories"]:
        assert "name" in cat
        assert cat["total_count"] > 0
        assert cat["trend"] in ("new", "improving", "declining", "stable")


@pytest.mark.integration
async def test_grammar_weak_spots_trend_detection(client, test_db):
    """Grammar weak spots shows 'improving' trend when recent errors < older errors."""
    import json

    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at) VALUES (?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "active", "2026-01-01T10:00:00+00:00"),
    )
    conv_id = (await (await test_db.execute("SELECT last_insert_rowid()")).fetchone())[0]

    # 3 older article errors (> 14 days ago)
    for i in range(3):
        fb = json.dumps({
            "corrected_text": "corrected",
            "is_correct": False,
            "errors": [{"original": "x", "corrected": "y", "explanation": "Missing article before noun."}],
        })
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (conv_id, "user", "old msg", fb, "2026-01-05T10:00:00+00:00"),
        )
    # 1 recent article error (within 14 days)
    fb_recent = json.dumps({
        "corrected_text": "corrected",
        "is_correct": False,
        "errors": [{"original": "x", "corrected": "y", "explanation": "Missing article before noun."}],
    })
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (conv_id, "user", "new msg", fb_recent, "2026-04-11T10:00:00+00:00"),
    )
    await test_db.commit()

    resp = await client.get("/api/dashboard/grammar-weak-spots")
    assert resp.status_code == 200
    data = resp.json()
    # Find the Articles category
    article_cats = [c for c in data["categories"] if "article" in c["name"].lower()]
    assert len(article_cats) >= 1
    cat = article_cats[0]
    assert cat["older_count"] == 3
    assert cat["recent_count"] == 1
    # recent (1) < older (3) * 0.7 = 2.1 → improving
    assert cat["trend"] == "improving"


# --- Data-populated tests for Vocabulary Forecast ---


@pytest.mark.integration
async def test_vocabulary_forecast_with_overdue_words(client, test_db, mock_copilot):
    """Vocabulary forecast returns at-risk words when words are overdue."""
    from unittest.mock import AsyncMock

    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "reservation", "correct_meaning": "a booking", "example_sentence": "I have a reservation.", "difficulty": 1},
        ],
    })
    # Create a word via quiz endpoint
    quiz_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    assert quiz_res.status_code == 200
    word_id = quiz_res.json()["questions"][0]["id"]

    # Create progress and mark it as overdue
    await test_db.execute(
        """INSERT OR REPLACE INTO vocabulary_progress
           (word_id, level, correct_count, incorrect_count, last_reviewed, next_review_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (word_id, 1, 2, 1, "2026-03-01T00:00:00+00:00", "2026-03-02T00:00:00+00:00"),
    )
    await test_db.commit()

    resp = await client.get("/api/dashboard/vocabulary-forecast")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_reviewed"] >= 1
    assert data["overdue_count"] >= 1
    assert len(data["at_risk_words"]) >= 1
    word = data["at_risk_words"][0]
    assert word["word"] == "reservation"
    assert word["days_overdue"] > 0
    assert word["risk_score"] > 0


@pytest.mark.integration
async def test_vocabulary_forecast_high_error_rate(client, test_db, mock_copilot):
    """High-error-rate words have higher risk scores in forecast."""
    from unittest.mock import AsyncMock

    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "checkout", "correct_meaning": "leaving hotel", "example_sentence": "Checkout is at noon.", "difficulty": 1},
            {"word": "lobby", "correct_meaning": "entrance hall", "example_sentence": "Meet in the lobby.", "difficulty": 1},
        ],
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=2")
    assert quiz_res.status_code == 200
    questions = quiz_res.json()["questions"]
    high_err_id = questions[0]["id"]
    low_err_id = questions[1]["id"]

    # Both have progress — set next_review to recent so overdue factor is small
    for wid in (high_err_id, low_err_id):
        await test_db.execute(
            """INSERT OR REPLACE INTO vocabulary_progress
               (word_id, level, correct_count, incorrect_count, last_reviewed, next_review_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (wid, 2, 2, 0, "2026-04-10T00:00:00+00:00", "2026-04-11T00:00:00+00:00"),
        )
    # High error word: 4 wrong out of 5
    for i in range(5):
        await test_db.execute(
            "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) VALUES (?, ?, ?)",
            (high_err_id, 1 if i == 0 else 0, f"2026-03-15T10:{i:02d}:00+00:00"),
        )
    # Low error word: 4 correct out of 5
    for i in range(5):
        await test_db.execute(
            "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) VALUES (?, ?, ?)",
            (low_err_id, 0 if i == 0 else 1, f"2026-03-15T10:{i:02d}:00+00:00"),
        )
    await test_db.commit()

    resp = await client.get("/api/dashboard/vocabulary-forecast")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_reviewed"] >= 2
    risk_map = {w["word_id"]: w["risk_score"] for w in data["at_risk_words"]}
    assert risk_map[high_err_id] > risk_map[low_err_id]


# --- Data-populated tests for Weekly Report ---


@pytest.mark.integration
async def test_weekly_report_with_activity(client, test_db):
    """Weekly report aggregates conversations, messages, pronunciation, and vocabulary activity."""
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()

    # Seed a conversation with user messages
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at) VALUES (?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "active", now_iso),
    )
    conv_id = (await (await test_db.execute("SELECT last_insert_rowid()")).fetchone())[0]
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        (conv_id, "user", "Hello, I need a room.", now_iso),
    )
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        (conv_id, "assistant", "Welcome! How many nights?", now_iso),
    )
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        (conv_id, "user", "Two nights please.", now_iso),
    )

    # Seed pronunciation attempts
    await test_db.execute(
        "INSERT INTO pronunciation_attempts (reference_text, user_transcription, feedback_json, score, created_at) VALUES (?, ?, ?, ?, ?)",
        ("How are you?", "how are you", '{"overall":"good"}', 8.5, now_iso),
    )

    # Seed vocabulary quiz attempts
    await test_db.execute(
        "INSERT INTO vocabulary_words (word, meaning, example_sentence, topic, difficulty) VALUES (?, ?, ?, ?, ?)",
        ("reservation", "a booking", "I have a reservation.", "hotel_checkin", 1),
    )
    word_id = (await (await test_db.execute("SELECT last_insert_rowid()")).fetchone())[0]
    await test_db.execute(
        "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) VALUES (?, ?, ?)",
        (word_id, 1, now_iso),
    )
    await test_db.execute(
        "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) VALUES (?, ?, ?)",
        (word_id, 0, now_iso),
    )
    await test_db.commit()

    resp = await client.get("/api/dashboard/weekly-report")
    assert resp.status_code == 200
    data = resp.json()
    assert data["conversations"] >= 1
    assert data["messages_sent"] >= 2
    assert data["pronunciation_attempts"] >= 1
    assert data["avg_pronunciation_score"] > 0
    assert data["vocabulary_reviewed"] >= 2
    assert 0 <= data["quiz_accuracy"] <= 100
    assert isinstance(data["text_summary"], str)
    assert len(data["text_summary"]) > 0
    assert isinstance(data["highlights"], list)


# --- Data-populated tests for Session Analytics ---


@pytest.mark.integration
async def test_session_analytics_with_conversation(client, test_db):
    """Session analytics counts conversation time from started_at/ended_at."""
    from datetime import datetime as dt, timezone, timedelta

    now = dt.now(timezone.utc)
    started = now - timedelta(minutes=10)

    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "ended", started.isoformat(), now.isoformat()),
    )
    await test_db.commit()

    resp = await client.get("/api/dashboard/session-analytics")
    assert resp.status_code == 200
    data = resp.json()

    conv_module = next((m for m in data["modules"] if m["module"] == "conversation"), None)
    assert conv_module is not None
    assert conv_module["session_count"] >= 1
    assert conv_module["total_seconds"] >= 500  # ~600 expected for 10 min

    # Daily breakdown should have an entry
    assert len(data["daily"]) >= 1
    today_entry = next((d for d in data["daily"] if d["conversation_seconds"] > 0), None)
    assert today_entry is not None


@pytest.mark.integration
async def test_session_analytics_with_pronunciation(client, test_db):
    """Session analytics estimates pronunciation time from attempt count."""
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()

    for i in range(3):
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, feedback_json, score, created_at) VALUES (?, ?, ?, ?, ?)",
            (f"Test sentence {i}", f"test sentence {i}", '{}', 7.0, now_iso),
        )
    await test_db.commit()

    resp = await client.get("/api/dashboard/session-analytics")
    assert resp.status_code == 200
    data = resp.json()

    pron_module = next((m for m in data["modules"] if m["module"] == "pronunciation"), None)
    assert pron_module is not None
    assert pron_module["session_count"] >= 3
    assert pron_module["total_seconds"] >= 360  # 3 * 120 = 360

    assert len(data["daily"]) >= 1
    today_entry = next((d for d in data["daily"] if d["pronunciation_seconds"] > 0), None)
    assert today_entry is not None


@pytest.mark.integration
async def test_session_analytics_with_all_modules(client, test_db):
    """Session analytics includes all three modules when all have activity."""
    from datetime import datetime as dt, timezone, timedelta

    now = dt.now(timezone.utc)
    now_iso = now.isoformat()
    started = (now - timedelta(minutes=5)).isoformat()

    # Conversation
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "ended", started, now_iso),
    )

    # Pronunciation
    await test_db.execute(
        "INSERT INTO pronunciation_attempts (reference_text, user_transcription, feedback_json, score, created_at) VALUES (?, ?, ?, ?, ?)",
        ("Good morning.", "good morning", '{}', 9.0, now_iso),
    )

    # Vocabulary
    await test_db.execute(
        "INSERT INTO vocabulary_words (word, meaning, example_sentence, topic, difficulty) VALUES (?, ?, ?, ?, ?)",
        ("lobby", "entrance hall", "Meet in the lobby.", "hotel_checkin", 1),
    )
    word_id = (await (await test_db.execute("SELECT last_insert_rowid()")).fetchone())[0]
    await test_db.execute(
        "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) VALUES (?, ?, ?)",
        (word_id, 1, now_iso),
    )
    await test_db.commit()

    resp = await client.get("/api/dashboard/session-analytics")
    assert resp.status_code == 200
    data = resp.json()

    for module_name in ("conversation", "pronunciation", "vocabulary"):
        mod = next((m for m in data["modules"] if m["module"] == module_name), None)
        assert mod is not None, f"Missing module: {module_name}"
        assert mod["session_count"] >= 1, f"{module_name} session_count should be >= 1"
        assert mod["total_seconds"] > 0, f"{module_name} total_seconds should be > 0"

    assert len(data["daily"]) >= 1
    today_str = now.strftime("%Y-%m-%d")
    today_entry = next((d for d in data["daily"] if d["date"] == today_str), None)
    assert today_entry is not None
    assert today_entry["conversation_seconds"] > 0
    assert today_entry["pronunciation_seconds"] > 0
    assert today_entry["vocabulary_seconds"] > 0


# --- Data-populated tests for Confidence Trend ---


@pytest.mark.integration
async def test_confidence_trend_with_conversations(client, test_db):
    """Confidence trend computes sub-scores and composite correctly from seeded data."""
    import json

    # Insert 4 ended conversations with performance data
    for i in range(4):
        summary = json.dumps({
            "performance": {
                "grammar_accuracy_rate": 60 + i * 10,  # 60, 70, 80, 90
                "vocabulary_diversity": 50 + i * 5,      # 50, 55, 60, 65
                "avg_words_per_message": 7.5 + i * 2.5,  # 7.5, 10, 12.5, 15
                "total_user_messages": 5 + i * 2,         # 5, 7, 9, 11 (capped at 100)
            }
        })
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?)",
            ("hotel_checkin", "intermediate", "ended", f"2026-03-0{i+1}T10:00:00+00:00", summary),
        )
    await test_db.commit()

    resp = await client.get("/api/dashboard/confidence-trend")
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["sessions"]) == 4
    # Sessions should be in chronological order (earliest first)
    assert data["sessions"][0]["started_at"] < data["sessions"][-1]["started_at"]

    # Verify sub-scores for the first session (accuracy=60, diversity=50, avg_words=7.5, msgs=5)
    s0 = data["sessions"][0]
    assert s0["grammar_score"] == 60.0
    assert s0["diversity_score"] == 50.0
    # complexity_score = min(7.5/15*100, 100) = 50.0
    assert s0["complexity_score"] == 50.0
    # participation_score = min(5/10*100, 100) = 50.0
    assert s0["participation_score"] == 50.0
    # composite = 60*0.4 + 50*0.3 + 50*0.2 + 50*0.1 = 24+15+10+5 = 54.0
    assert s0["score"] == 54.0

    # With 4 sessions, trend should be computed (not insufficient_data)
    assert data["trend"] in ("improving", "stable", "declining")


@pytest.mark.integration
async def test_confidence_trend_improving(client, test_db):
    """Confidence trend detects 'improving' when later sessions score higher."""
    import json

    # First 2 sessions: low scores
    for i in range(2):
        summary = json.dumps({
            "performance": {
                "grammar_accuracy_rate": 30,
                "vocabulary_diversity": 20,
                "avg_words_per_message": 3,
                "total_user_messages": 2,
            }
        })
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?)",
            ("hotel_checkin", "beginner", "ended", f"2026-01-0{i+1}T10:00:00+00:00", summary),
        )
    # Last 2 sessions: high scores
    for i in range(2):
        summary = json.dumps({
            "performance": {
                "grammar_accuracy_rate": 95,
                "vocabulary_diversity": 80,
                "avg_words_per_message": 14,
                "total_user_messages": 10,
            }
        })
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?)",
            ("hotel_checkin", "advanced", "ended", f"2026-02-0{i+1}T10:00:00+00:00", summary),
        )
    await test_db.commit()

    resp = await client.get("/api/dashboard/confidence-trend")
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["sessions"]) == 4
    assert data["trend"] == "improving"


# --- Data-populated tests for Learning Velocity ---


@pytest.mark.integration
async def test_learning_velocity_with_activity(client, test_db):
    """Learning velocity returns non-empty data when activities exist."""
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()

    # Conversation
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at) VALUES (?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "active", now_iso),
    )

    # Pronunciation attempt
    await test_db.execute(
        "INSERT INTO pronunciation_attempts (reference_text, user_transcription, feedback_json, score, created_at) VALUES (?, ?, ?, ?, ?)",
        ("Hello there.", "hello there", '{}', 8.0, now_iso),
    )

    # Vocabulary word + quiz attempt
    await test_db.execute(
        "INSERT INTO vocabulary_words (word, meaning, example_sentence, topic, difficulty) VALUES (?, ?, ?, ?, ?)",
        ("receipt", "a written record", "Keep the receipt.", "shopping", 1),
    )
    word_id = (await (await test_db.execute("SELECT last_insert_rowid()")).fetchone())[0]
    await test_db.execute(
        "INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, last_reviewed) VALUES (?, ?, ?, ?)",
        (word_id, 1, 0, now_iso),
    )
    await test_db.execute(
        "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) VALUES (?, ?, ?)",
        (word_id, 1, now_iso),
    )
    await test_db.commit()

    resp = await client.get("/api/dashboard/learning-velocity")
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["weekly_data"]) >= 1
    week0 = data["weekly_data"][-1]
    assert week0["conversations"] >= 1
    assert week0["pronunciation_attempts"] >= 1
    assert week0["quiz_attempts"] >= 1
    assert week0["new_words"] >= 1

    assert data["total_active_days"] >= 1
    assert data["words_per_study_day"] > 0

    pace = data["current_pace"]
    assert pace["conversations_per_day"] > 0
    assert pace["pronunciation_per_day"] > 0
    assert pace["words_per_day"] > 0
    assert pace["quizzes_per_day"] > 0


@pytest.mark.integration
async def test_learning_velocity_trend_with_data(client, test_db):
    """Learning velocity computes a real trend when enough weekly data exists."""
    from datetime import datetime as dt, timezone, timedelta

    now = dt.now(timezone.utc)

    # Seed 5 weeks of conversations to get enough data for trend calculation
    for week_offset in range(5):
        week_date = now - timedelta(weeks=week_offset)
        iso = week_date.isoformat()
        for _ in range(2):
            await test_db.execute(
                "INSERT INTO conversations (topic, difficulty, status, started_at) VALUES (?, ?, ?, ?)",
                ("hotel_checkin", "intermediate", "active", iso),
            )
    await test_db.commit()

    resp = await client.get("/api/dashboard/learning-velocity")
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["weekly_data"]) >= 4
    # With 5 weeks of data, trend should be computed (not insufficient_data)
    assert data["trend"] in ("accelerating", "decelerating", "steady")
