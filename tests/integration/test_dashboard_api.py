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
