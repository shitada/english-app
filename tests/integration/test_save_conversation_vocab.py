"""Integration tests for POST /api/conversation/{id}/save-vocabulary."""

import pytest
from unittest.mock import AsyncMock


async def _start_and_end_conversation(client, mock_copilot):
    """Helper: start and end a conversation, returning (conv_id, summary)."""
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's practise.")
    start_res = await client.post(
        "/api/conversation/start", json={"topic": "hotel_checkin"}
    )
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "A brief hotel check-in conversation.",
        "key_vocabulary": ["reservation", "lobby", "amenities"],
        "communication_level": "intermediate",
        "tip": "Use more polite expressions.",
    })
    end_res = await client.post(
        "/api/conversation/end", json={"conversation_id": conv_id}
    )
    return conv_id, end_res.json()["summary"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_vocabulary_success(client, mock_copilot):
    """Saving vocabulary from a conversation returns saved words with meanings."""
    conv_id, _ = await _start_and_end_conversation(client, mock_copilot)

    # Mock LLM to return word definitions
    mock_copilot.ask_json = AsyncMock(return_value={
        "words": [
            {"word": "reservation", "meaning": "A booking at a hotel", "example_sentence": "I have a reservation."},
            {"word": "lobby", "meaning": "The entrance hall of a hotel", "example_sentence": "Meet me in the lobby."},
        ]
    })

    res = await client.post(
        f"/api/conversation/{conv_id}/save-vocabulary",
        json={"words": ["reservation", "lobby"]},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["saved_count"] == 2
    assert len(data["words"]) == 2
    saved_words = {w["word"] for w in data["words"]}
    assert "reservation" in saved_words
    assert "lobby" in saved_words
    # Each word should have a meaning
    for w in data["words"]:
        assert w["meaning"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_vocabulary_nonexistent_conversation(client):
    """Saving vocabulary for a non-existent conversation returns 404."""
    res = await client.post(
        "/api/conversation/99999/save-vocabulary",
        json={"words": ["hello"]},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_vocabulary_empty_words(client, mock_copilot):
    """Sending an empty words list is rejected by validation."""
    conv_id, _ = await _start_and_end_conversation(client, mock_copilot)
    res = await client.post(
        f"/api/conversation/{conv_id}/save-vocabulary",
        json={"words": []},
    )
    assert res.status_code == 422  # Pydantic validation error


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_vocabulary_deduplicates(client, mock_copilot):
    """Duplicate words in request are deduplicated."""
    conv_id, _ = await _start_and_end_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(return_value={
        "words": [
            {"word": "lobby", "meaning": "Hotel entrance area", "example_sentence": "Wait in the lobby."},
        ]
    })

    res = await client.post(
        f"/api/conversation/{conv_id}/save-vocabulary",
        json={"words": ["lobby", "Lobby", "LOBBY"]},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["saved_count"] == 1


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_vocabulary_idempotent(client, mock_copilot):
    """Saving the same words twice doesn't create duplicates."""
    conv_id, _ = await _start_and_end_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(return_value={
        "words": [
            {"word": "amenities", "meaning": "Hotel facilities", "example_sentence": "Enjoy the amenities."},
        ]
    })

    # First save
    res1 = await client.post(
        f"/api/conversation/{conv_id}/save-vocabulary",
        json={"words": ["amenities"]},
    )
    assert res1.status_code == 200
    assert res1.json()["saved_count"] == 1

    # Second save — should still return 1 (existing word found)
    res2 = await client.post(
        f"/api/conversation/{conv_id}/save-vocabulary",
        json={"words": ["amenities"]},
    )
    assert res2.status_code == 200
    assert res2.json()["saved_count"] == 1


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_vocabulary_llm_failure_fallback(client, mock_copilot):
    """When LLM fails, words are saved with fallback definitions."""
    conv_id, _ = await _start_and_end_conversation(client, mock_copilot)

    # Make LLM fail
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM unavailable"))

    res = await client.post(
        f"/api/conversation/{conv_id}/save-vocabulary",
        json={"words": ["reservation"]},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["saved_count"] == 1
    assert data["words"][0]["word"] == "reservation"
    # Fallback meaning should still be present
    assert data["words"][0]["meaning"]
