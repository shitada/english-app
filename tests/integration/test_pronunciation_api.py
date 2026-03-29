"""Integration tests for pronunciation API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_get_sentences_empty(client):
    """When no conversations exist, should return sample sentences or empty list."""
    res = await client.get("/api/pronunciation/sentences")
    assert res.status_code == 200
    data = res.json()
    assert "sentences" in data
    assert isinstance(data["sentences"], list)


@pytest.mark.asyncio
async def test_get_sentences_after_conversation(client, mock_copilot):
    """After a conversation, sentences should be extracted from AI messages."""
    mock_copilot.ask = AsyncMock(
        return_value="That sounds like a great idea. I think we should schedule a meeting for next week."
    )
    await client.post("/api/conversation/start", json={"topic": "business"})

    res = await client.get("/api/pronunciation/sentences")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["sentences"], list)


@pytest.mark.asyncio
async def test_check_pronunciation(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 8,
        "overall_feedback": "Good pronunciation overall!",
        "word_feedback": [
            {"expected": "hello", "heard": "hello", "is_correct": True, "tip": ""},
            {"expected": "world", "heard": "word", "is_correct": False, "tip": "Pay attention to the 'ld' ending."},
        ],
        "focus_areas": ["word-final consonant clusters"],
    })

    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world.",
        "user_transcription": "Hello word.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 8
    assert len(data["word_feedback"]) == 2
    assert data["word_feedback"][1]["is_correct"] is False


@pytest.mark.asyncio
async def test_check_pronunciation_saves_to_db(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 6,
        "overall_feedback": "Needs work.",
        "word_feedback": [],
        "focus_areas": [],
    })

    await client.post("/api/pronunciation/check", json={
        "reference_text": "Good morning.",
        "user_transcription": "Good moaning.",
    })

    res = await client.get("/api/pronunciation/history")
    assert res.status_code == 200
    data = res.json()
    assert len(data["attempts"]) >= 1
    assert data["attempts"][0]["reference_text"] == "Good morning."


@pytest.mark.asyncio
async def test_pronunciation_history_empty(client):
    res = await client.get("/api/pronunciation/history")
    assert res.status_code == 200
    assert res.json()["attempts"] == []
