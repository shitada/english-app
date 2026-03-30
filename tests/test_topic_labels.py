"""Tests verifying that dashboard and pronunciation endpoints return
human-readable topic labels instead of raw topic keys.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_TOPICS = [
    {"id": "hotel_checkin", "label": "Hotel Check-in"},
    {"id": "business", "label": "Business"},
    {"id": "restaurant", "label": "Restaurant"},
]


# ---------------------------------------------------------------------------
# Dashboard – recent_activity labels
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dashboard_recent_activity_shows_labels(client, mock_copilot):
    """Conversation activity should display the human-readable label,
    not the raw topic key."""

    with patch("app.routers.dashboard.get_conversation_topics", return_value=_FAKE_TOPICS):
        # Create a conversation with a raw topic key
        mock_copilot.ask = AsyncMock(
            return_value="Welcome to the Grand Hotel. How may I help you today?"
        )
        res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
        assert res.status_code == 200

        # Fetch dashboard stats
        res = await client.get("/api/dashboard/stats")
        assert res.status_code == 200
        data = res.json()

        conversation_items = [
            item for item in data["recent_activity"] if item["type"] == "conversation"
        ]
        assert len(conversation_items) >= 1
        assert conversation_items[0]["detail"] == "Hotel Check-in"


@pytest.mark.asyncio
async def test_dashboard_unknown_topic_falls_back_to_key(client, mock_copilot):
    """When a topic key has no matching config entry, the raw key is kept."""

    with patch("app.routers.dashboard.get_conversation_topics", return_value=_FAKE_TOPICS):
        mock_copilot.ask = AsyncMock(return_value="Let us discuss some advanced grammar rules for you.")
        res = await client.post("/api/conversation/start", json={"topic": "unknown_topic"})
        assert res.status_code == 200

        res = await client.get("/api/dashboard/stats")
        assert res.status_code == 200
        data = res.json()

        conversation_items = [
            item for item in data["recent_activity"] if item["type"] == "conversation"
        ]
        assert len(conversation_items) >= 1
        # Falls back to the raw key when label not found
        assert conversation_items[0]["detail"] == "unknown_topic"


# ---------------------------------------------------------------------------
# Pronunciation – sentence topic labels
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pronunciation_sentences_show_topic_labels(client, mock_copilot):
    """Sentences extracted from conversations should have human-readable
    topic labels, not raw keys."""

    with patch("app.routers.pronunciation.get_conversation_topics", return_value=_FAKE_TOPICS):
        # Seed a conversation so assistant messages generate sentences
        mock_copilot.ask = AsyncMock(
            return_value="I would like to confirm your reservation for tonight. Could you give me your name please?"
        )
        res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
        assert res.status_code == 200

        res = await client.get("/api/pronunciation/sentences")
        assert res.status_code == 200
        data = res.json()
        sentences = data["sentences"]

        assert len(sentences) >= 1
        for s in sentences:
            # Every sentence from the hotel_checkin conversation should show
            # the human-readable label.
            assert s["topic"] == "Hotel Check-in"


@pytest.mark.asyncio
async def test_pronunciation_sentences_unknown_topic_falls_back(client, mock_copilot):
    """When a sentence's topic has no config entry, the raw key is preserved."""

    with patch("app.routers.pronunciation.get_conversation_topics", return_value=_FAKE_TOPICS):
        mock_copilot.ask = AsyncMock(
            return_value="This is a perfectly good sentence for practice. Please repeat after me carefully."
        )
        res = await client.post("/api/conversation/start", json={"topic": "mystery_topic"})
        assert res.status_code == 200

        res = await client.get("/api/pronunciation/sentences")
        assert res.status_code == 200
        data = res.json()
        sentences = data["sentences"]

        assert len(sentences) >= 1
        for s in sentences:
            assert s["topic"] == "mystery_topic"
