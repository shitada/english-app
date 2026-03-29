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
    assert len(data["messages"]) >= 1
    assert data["messages"][0]["role"] == "assistant"
