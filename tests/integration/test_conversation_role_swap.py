"""Integration tests for the Conversation Role-Swap Replay endpoint."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.integration
@pytest.mark.asyncio
async def test_role_swap_script_happy_path(client, mock_copilot):
    # Start a conversation (assistant opening message will be added).
    mock_copilot.ask = AsyncMock(return_value="Welcome! How can I help you today?")
    start = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert start.status_code == 200
    conv_id = start.json()["conversation_id"]

    # Add a user message + assistant follow-up.
    mock_copilot.ask = AsyncMock(return_value="Sure, here is your room key.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I'd like to check in, please.",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })
    msg = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I'd like to check in, please.",
    })
    assert msg.status_code == 200

    # Fetch the role-swap script.
    res = await client.get(f"/api/conversation/{conv_id}/role-swap")
    assert res.status_code == 200
    data = res.json()

    assert data["conversation_id"] == conv_id
    assert isinstance(data["topic"], str) and data["topic"]
    assert isinstance(data["language_level"], str)
    assert isinstance(data["turns"], list)
    assert len(data["turns"]) >= 2

    # Indices are sequential, speakers limited to user/assistant.
    for i, turn in enumerate(data["turns"]):
        assert turn["index"] == i
        assert turn["original_speaker"] in ("user", "assistant")
        assert isinstance(turn["text"], str) and turn["text"].strip()

    speakers = {t["original_speaker"] for t in data["turns"]}
    assert "user" in speakers
    assert "assistant" in speakers


@pytest.mark.integration
@pytest.mark.asyncio
async def test_role_swap_script_not_found(client):
    res = await client.get("/api/conversation/999999/role-swap")
    assert res.status_code == 404
    assert res.json()["detail"] == "Conversation not found"
