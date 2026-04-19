"""Integration tests for Speaking Pace Coach: per-turn WPM badge + pacing summary."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.integration
@pytest.mark.asyncio
async def test_message_persists_pace_wpm(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's chat.")
    start = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Tell me more.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I want to check in.",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I want to check in please",  # 6 words
        "speaking_seconds": 3.0,
    })
    assert res.status_code == 200
    data = res.json()
    # 6 words / (3s/60) = 120 WPM
    assert data["pace_wpm"] == pytest.approx(120.0, abs=0.5)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_message_no_pace_when_typed(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="OK.")
    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I typed this message",
    })
    assert res.status_code == 200
    assert res.json()["pace_wpm"] is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_message_no_pace_when_speaking_too_short(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hi.")
    start = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="OK.")
    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "Hi",
        "speaking_seconds": 0.3,  # < 0.5 threshold
    })
    assert res.status_code == 200
    assert res.json()["pace_wpm"] is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_summary_includes_pace_stats(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Cool.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "ok", "is_correct": True, "errors": [], "suggestions": [],
    })
    await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I would like a room",  # 5 words
        "speaking_seconds": 2.5,  # 120 wpm
    })
    await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "Yes please that sounds great",  # 5 words
        "speaking_seconds": 5.0,  # 60 wpm
    })

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Good chat", "key_vocabulary": [], "communication_level": "B1", "tip": "keep going",
    })
    end = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert end.status_code == 200
    summary = end.json()["summary"]
    assert "pace_stats" in summary
    ps = summary["pace_stats"]
    assert ps["count"] == 2
    assert ps["min_wpm"] == pytest.approx(60.0, abs=0.5)
    assert ps["max_wpm"] == pytest.approx(120.0, abs=0.5)
    assert ps["avg_wpm"] == pytest.approx(90.0, abs=0.5)
