"""Integration tests for conversation partner personality feature."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_conversation_default_personality(client, mock_copilot):
    """Starting a conversation without personality defaults to patient_teacher."""
    mock_copilot.ask = AsyncMock(return_value="Hello! How can I help you today?")

    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert res.status_code == 200
    data = res.json()
    assert "conversation_id" in data
    assert data["conversation_id"] > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_conversation_patient_teacher(client, mock_copilot):
    """Starting a conversation with patient_teacher personality succeeds."""
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let me help you practice.")

    res = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin",
        "personality": "patient_teacher",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_conversation_chatty_friend(client, mock_copilot):
    """Starting a conversation with chatty_friend personality succeeds."""
    mock_copilot.ask = AsyncMock(return_value="Hey! What's up? Ready to chat?")

    res = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin",
        "personality": "chatty_friend",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_conversation_professional(client, mock_copilot):
    """Starting a conversation with professional personality succeeds."""
    mock_copilot.ask = AsyncMock(return_value="Good afternoon. How may I assist you?")

    res = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin",
        "personality": "professional",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_conversation_challenging(client, mock_copilot):
    """Starting a conversation with challenging personality succeeds."""
    mock_copilot.ask = AsyncMock(return_value="Let's explore this topic in depth.")

    res = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin",
        "personality": "challenging",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_conversation_invalid_personality_returns_422(client, mock_copilot):
    """Invalid personality value should return 422 validation error."""
    res = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin",
        "personality": "rude_stranger",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_send_message_uses_personality(client, mock_copilot):
    """Messages in a conversation with a set personality should succeed (personality stored on conversation)."""
    mock_copilot.ask = AsyncMock(return_value="Hey! Welcome to the hotel, friend!")
    res = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin",
        "personality": "chatty_friend",
    })
    assert res.status_code == 200
    conv_id = res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Oh nice! You're gonna love it here!")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I would like to check in please.",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I would like to check in please.",
    })
    assert res.status_code == 200
    assert "message" in res.json()
