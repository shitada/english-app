"""Integration tests for GET /api/conversation/topic-mastery endpoint."""

import json

import pytest


@pytest.mark.asyncio
@pytest.mark.integration
async def test_topic_mastery_empty(client):
    """No ended conversations → empty response."""
    res = await client.get("/api/conversation/topic-mastery")
    assert res.status_code == 200
    assert res.json() == {}


@pytest.mark.asyncio
@pytest.mark.integration
async def test_topic_mastery_with_sessions(client, mock_copilot):
    """Ended conversations produce correct mastery data."""
    from unittest.mock import AsyncMock

    mock_copilot.ask = AsyncMock(return_value="Welcome to the hotel!")

    # Start and end a conversation
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert start_res.status_code == 200
    conv_id = start_res.json()["conversation_id"]

    # End with skip_summary to avoid LLM call
    end_res = await client.post("/api/conversation/end", json={
        "conversation_id": conv_id,
        "skip_summary": True,
    })
    assert end_res.status_code == 200

    # Now check mastery
    res = await client.get("/api/conversation/topic-mastery")
    assert res.status_code == 200
    data = res.json()
    assert "hotel_checkin" in data
    mastery = data["hotel_checkin"]
    assert mastery["tier"] == "bronze"
    assert mastery["sessions"] == 1
    assert "avg_grammar" in mastery
    assert "highest_difficulty" in mastery


@pytest.mark.asyncio
@pytest.mark.integration
async def test_topic_mastery_returns_correct_structure(client, mock_copilot):
    """Each mastery entry has the expected keys."""
    from unittest.mock import AsyncMock

    mock_copilot.ask = AsyncMock(return_value="Let's practice!")

    start_res = await client.post("/api/conversation/start", json={
        "topic": "restaurant_order",
        "difficulty": "advanced",
    })
    conv_id = start_res.json()["conversation_id"]
    await client.post("/api/conversation/end", json={
        "conversation_id": conv_id,
        "skip_summary": True,
    })

    res = await client.get("/api/conversation/topic-mastery")
    assert res.status_code == 200
    entry = res.json()["restaurant_order"]
    assert set(entry.keys()) == {"tier", "sessions", "avg_grammar", "highest_difficulty"}
    assert entry["highest_difficulty"] == "advanced"
