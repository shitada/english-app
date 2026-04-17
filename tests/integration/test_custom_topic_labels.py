"""Integration tests for custom topic label resolution across all endpoints.

Verifies that custom topic labels (not raw IDs) appear in:
- conversation list
- conversation export
- grammar accuracy breakdown
- topic recommendations
- dashboard stats
- grammar trend
- confidence trend
"""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock


CUSTOM_TOPIC_LABEL = "Restaurant Roleplay"
CUSTOM_TOPIC_PAYLOAD = {
    "label": CUSTOM_TOPIC_LABEL,
    "description": "Practice ordering food at a restaurant",
    "scenario": "You are a waiter at a fine dining restaurant. The user is a customer.",
    "goal": "Order a meal and ask about the menu",
}


@pytest.mark.integration
class TestCustomTopicLabels:
    """Ensure custom topic labels resolve correctly instead of raw IDs."""

    async def _create_custom_topic(self, client: AsyncClient) -> str:
        """Create a custom topic and return its generated topic_id."""
        resp = await client.post(
            "/api/conversation/custom-topics",
            json=CUSTOM_TOPIC_PAYLOAD,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["label"] == CUSTOM_TOPIC_LABEL
        return data["id"]

    async def _start_and_end_conversation(
        self,
        client: AsyncClient,
        mock_copilot,
        topic_id: str,
    ) -> int:
        """Start a conversation on the custom topic, send a message, and end it."""
        # Start conversation
        mock_copilot.ask = AsyncMock(
            return_value="Welcome to our restaurant! How can I help you?"
        )
        resp = await client.post(
            "/api/conversation/start",
            json={"topic": topic_id, "difficulty": "intermediate"},
        )
        assert resp.status_code == 200
        conv_id = resp.json()["conversation_id"]

        # Send a user message with grammar feedback
        mock_copilot.ask = AsyncMock(
            return_value="Excellent choice! Would you like anything to drink?"
        )
        mock_copilot.ask_json = AsyncMock(
            return_value={
                "corrected_text": "I would like to order the pasta, please.",
                "is_correct": True,
                "errors": [],
                "suggestions": [],
            }
        )
        resp = await client.post(
            "/api/conversation/message",
            json={
                "conversation_id": conv_id,
                "content": "I would like to order the pasta please.",
            },
        )
        assert resp.status_code == 200

        # End the conversation with a summary
        mock_copilot.ask_json = AsyncMock(
            return_value={
                "summary": "Great restaurant conversation.",
                "performance": {
                    "grammar_accuracy_rate": 90,
                    "vocabulary_diversity": 60,
                    "avg_words_per_message": 8,
                    "total_user_messages": 1,
                },
                "vocabulary_used": ["order", "pasta"],
                "grammar_points": [],
                "new_expressions": [],
            }
        )
        resp = await client.post(
            "/api/conversation/end",
            json={"conversation_id": conv_id},
        )
        assert resp.status_code == 200
        return conv_id

    # ------------------------------------------------------------------
    # Conversation endpoints
    # ------------------------------------------------------------------

    async def test_list_conversations_shows_custom_label(
        self, client: AsyncClient, mock_copilot
    ):
        topic_id = await self._create_custom_topic(client)
        await self._start_and_end_conversation(client, mock_copilot, topic_id)

        resp = await client.get("/api/conversation/list")
        assert resp.status_code == 200
        conversations = resp.json()["conversations"]
        assert len(conversations) >= 1
        matching = [c for c in conversations if c.get("topic_id") == topic_id]
        assert len(matching) >= 1
        for c in matching:
            assert c["topic"] == CUSTOM_TOPIC_LABEL, (
                f"Expected label '{CUSTOM_TOPIC_LABEL}', got '{c['topic']}'"
            )

    async def test_export_conversation_shows_custom_label(
        self, client: AsyncClient, mock_copilot
    ):
        topic_id = await self._create_custom_topic(client)
        conv_id = await self._start_and_end_conversation(
            client, mock_copilot, topic_id
        )

        resp = await client.get(f"/api/conversation/{conv_id}/export")
        assert resp.status_code == 200
        data = resp.json()
        assert data["topic"] == CUSTOM_TOPIC_LABEL

    async def test_grammar_accuracy_shows_custom_label(
        self, client: AsyncClient, mock_copilot
    ):
        topic_id = await self._create_custom_topic(client)
        await self._start_and_end_conversation(client, mock_copilot, topic_id)

        resp = await client.get("/api/conversation/grammar-accuracy")
        assert resp.status_code == 200
        by_topic = resp.json().get("by_topic", [])
        # If there are topic entries, none should show the raw ID
        for item in by_topic:
            if item["topic"] == topic_id:
                pytest.fail(
                    f"Raw topic ID '{topic_id}' found in grammar-accuracy by_topic"
                )

    async def test_topic_recommendations_include_custom_topics(
        self, client: AsyncClient, mock_copilot
    ):
        topic_id = await self._create_custom_topic(client)

        resp = await client.get("/api/conversation/topic-recommendations")
        assert resp.status_code == 200
        recs = resp.json()
        # The custom topic should appear in recommendations
        rec_ids = [r.get("topic_id") for r in recs]
        assert topic_id in rec_ids, (
            f"Custom topic '{topic_id}' not found in recommendations: {rec_ids}"
        )
        # And its label should be resolved
        for r in recs:
            if r.get("topic_id") == topic_id:
                assert r["topic"] == CUSTOM_TOPIC_LABEL

    # ------------------------------------------------------------------
    # Dashboard endpoints
    # ------------------------------------------------------------------

    async def test_dashboard_stats_shows_custom_label(
        self, client: AsyncClient, mock_copilot
    ):
        topic_id = await self._create_custom_topic(client)
        await self._start_and_end_conversation(client, mock_copilot, topic_id)

        resp = await client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        data = resp.json()

        # conversations_by_topic should use label
        for item in data.get("conversations_by_topic", []):
            assert item["topic"] != topic_id, (
                f"Raw topic ID '{topic_id}' found in conversations_by_topic"
            )

        # recent_activity conversation entries should use label
        for item in data.get("recent_activity", []):
            if item["type"] == "conversation":
                assert item["detail"] != topic_id, (
                    f"Raw topic ID '{topic_id}' found in recent_activity"
                )

    async def test_grammar_trend_shows_custom_label(
        self, client: AsyncClient, mock_copilot
    ):
        topic_id = await self._create_custom_topic(client)
        await self._start_and_end_conversation(client, mock_copilot, topic_id)

        resp = await client.get("/api/dashboard/grammar-trend")
        assert resp.status_code == 200
        conversations = resp.json().get("conversations", [])
        for c in conversations:
            if c["topic"] == topic_id:
                pytest.fail(
                    f"Raw topic ID '{topic_id}' found in grammar-trend conversations"
                )

    async def test_confidence_trend_shows_custom_label(
        self, client: AsyncClient, mock_copilot
    ):
        topic_id = await self._create_custom_topic(client)
        await self._start_and_end_conversation(client, mock_copilot, topic_id)

        resp = await client.get("/api/dashboard/confidence-trend")
        assert resp.status_code == 200
        sessions = resp.json().get("sessions", [])
        for s in sessions:
            if s["topic"] == topic_id:
                pytest.fail(
                    f"Raw topic ID '{topic_id}' found in confidence-trend sessions"
                )
