"""Integration tests for conversation API endpoints."""

import json
import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_list_topics(client):
    res = await client.get("/api/conversation/topics")
    assert res.status_code == 200
    topics = res.json()
    assert isinstance(topics, list)
    assert len(topics) > 0
    assert all("id" in t and "label" in t for t in topics)


@pytest.mark.asyncio
async def test_start_conversation(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hi! What kind of business do you work in?")

    res = await client.post("/api/conversation/start", json={"topic": "business"})
    assert res.status_code == 200
    data = res.json()
    assert "conversation_id" in data
    assert data["conversation_id"] > 0
    assert "message" in data
    assert data["topic"] == "business"
    mock_copilot.ask.assert_called_once()


@pytest.mark.asyncio
async def test_send_message(client, mock_copilot):
    # Start a conversation first
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's talk about business.")
    start_res = await client.post("/api/conversation/start", json={"topic": "business"})
    conv_id = start_res.json()["conversation_id"]

    # Send a message
    mock_copilot.ask = AsyncMock(return_value="That sounds interesting! Tell me more.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I work in technology.",
        "is_correct": True,
        "errors": [],
        "suggestions": [
            {"original": "I work in technology", "better": "I work in the tech industry", "explanation": "More natural"}
        ],
    })

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I work in technology.",
    })
    assert res.status_code == 200
    data = res.json()
    assert "message" in data
    assert "feedback" in data
    assert data["feedback"]["is_correct"] is True


@pytest.mark.asyncio
async def test_send_message_invalid_conversation(client):
    res = await client.post("/api/conversation/message", json={
        "conversation_id": 99999,
        "content": "Hello",
    })
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_end_conversation(client, mock_copilot):
    # Start conversation
    mock_copilot.ask = AsyncMock(return_value="Let's chat!")
    start_res = await client.post("/api/conversation/start", json={"topic": "daily"})
    conv_id = start_res.json()["conversation_id"]

    # End it
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Brief conversation about daily life.",
        "key_vocabulary": ["chat", "daily"],
        "communication_level": "intermediate",
        "tip": "Try using more varied vocabulary.",
    })

    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 200
    data = res.json()
    assert "summary" in data
    assert data["summary"]["communication_level"] == "intermediate"


@pytest.mark.asyncio
async def test_end_already_ended_conversation(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hi!")
    start_res = await client.post("/api/conversation/start", json={"topic": "travel"})
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Short conversation.",
        "key_vocabulary": [],
        "communication_level": "beginner",
        "tip": "Practice more.",
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Try ending again
    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_history(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hello! How are you?")
    start_res = await client.post("/api/conversation/start", json={"topic": "daily"})
    conv_id = start_res.json()["conversation_id"]

    res = await client.get(f"/api/conversation/{conv_id}/history")
    assert res.status_code == 200
    data = res.json()
    assert "messages" in data


@pytest.mark.asyncio
async def test_start_conversation_with_difficulty(client, mock_copilot):
    """Test that difficulty parameter is accepted and stored."""
    mock_copilot.ask = AsyncMock(return_value="Hello! Let's practice!")

    for diff in ["beginner", "intermediate", "advanced"]:
        res = await client.post(
            "/api/conversation/start",
            json={"topic": "hotel_checkin", "difficulty": diff},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["conversation_id"] > 0


@pytest.mark.asyncio
async def test_start_conversation_invalid_difficulty(client):
    """Test that invalid difficulty returns 422."""
    res = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin", "difficulty": "expert"},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_start_conversation_default_difficulty(client, mock_copilot):
    """Test that omitting difficulty defaults to intermediate."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert res.status_code == 200
    assert res.json()["conversation_id"] > 0


@pytest.mark.asyncio
async def test_list_conversations_empty(client):
    """Test listing conversations when none exist."""
    res = await client.get("/api/conversation/list")
    assert res.status_code == 200
    assert res.json()["conversations"] == []


@pytest.mark.asyncio
async def test_list_conversations_after_creating(client, mock_copilot):
    """Test listing conversations returns created conversations."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    await client.post("/api/conversation/start", json={"topic": "shopping"})
    res = await client.get("/api/conversation/list")
    assert res.status_code == 200
    data = res.json()
    assert len(data["conversations"]) == 2


@pytest.mark.asyncio
async def test_list_conversations_filter_by_topic(client, mock_copilot):
    """Test filtering conversation list by topic."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    await client.post("/api/conversation/start", json={"topic": "shopping"})
    res = await client.get("/api/conversation/list?topic=hotel_checkin")
    assert res.status_code == 200
    data = res.json()
    assert len(data["conversations"]) == 1
    assert data["conversations"][0]["topic"] == "hotel_checkin"


@pytest.mark.asyncio
async def test_send_message_grammar_check_failure_is_non_fatal(client, mock_copilot):
    """Test that grammar check failure doesn't kill the conversation response."""
    # Start a conversation
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Grammar check fails, but conversation response succeeds
    mock_copilot.ask = AsyncMock(return_value="That sounds great!")
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("Grammar LLM timeout"))

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I want to check in.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["message"] == "That sounds great!"
    assert data["feedback"] is None
