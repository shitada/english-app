"""Integration tests for Express It Better API endpoint."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_express_better_success(client, mock_copilot):
    """POST express-better returns upgraded expression pairs."""
    # Start a conversation
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's talk about hotels.")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Send a user message
    mock_copilot.ask = AsyncMock(return_value="That sounds great! Tell me more.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I want check in please.",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })
    await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I want check in please.",
    })

    # End the conversation
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Brief conversation about hotel check-in.",
        "key_vocabulary": ["check in"],
        "grammar_points": [],
        "performance_score": 7,
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Now call express-better
    mock_copilot.ask_json = AsyncMock(return_value={
        "pairs": [
            {
                "original": "I want check in please.",
                "upgraded": "I'd like to check in, please.",
                "explanation": "Using 'I'd like to' is more polite and natural than 'I want'.",
            },
        ],
    })

    res = await client.post(f"/api/conversation/{conv_id}/express-better")
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] == conv_id
    assert len(data["pairs"]) == 1
    assert data["pairs"][0]["original"] == "I want check in please."
    assert data["pairs"][0]["upgraded"] == "I'd like to check in, please."
    assert "explanation" in data["pairs"][0]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_express_better_conversation_not_found(client):
    """POST express-better for non-existent conversation returns 404."""
    res = await client.post("/api/conversation/99999/express-better")
    assert res.status_code == 404


@pytest.mark.asyncio
@pytest.mark.integration
async def test_express_better_conversation_not_ended(client, mock_copilot):
    """POST express-better for active conversation returns 400."""
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's talk.")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    res = await client.post(f"/api/conversation/{conv_id}/express-better")
    assert res.status_code == 400
    assert "ended" in res.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_express_better_no_user_messages(client, mock_copilot):
    """POST express-better with no user messages returns empty pairs."""
    # Start and immediately end
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Very brief.",
        "key_vocabulary": [],
        "grammar_points": [],
        "performance_score": 5,
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    res = await client.post(f"/api/conversation/{conv_id}/express-better")
    assert res.status_code == 200
    data = res.json()
    assert data["pairs"] == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_express_better_llm_failure(client, mock_copilot):
    """POST express-better returns 502 when LLM call fails."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Send a user message
    mock_copilot.ask = AsyncMock(return_value="Sounds good!")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "Hello",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })
    await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "Hello",
    })

    # End conversation
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Brief.",
        "key_vocabulary": [],
        "grammar_points": [],
        "performance_score": 5,
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Make LLM fail
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM error"))
    res = await client.post(f"/api/conversation/{conv_id}/express-better")
    assert res.status_code == 502
