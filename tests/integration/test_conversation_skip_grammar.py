"""Integration tests verifying grammar-check is skipped for trivial messages."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.integration
@pytest.mark.asyncio
async def test_trivial_message_skips_grammar_check(client, mock_copilot):
    # Start a conversation
    mock_copilot.ask = AsyncMock(return_value="Welcome! What can I do for you?")
    start_res = await client.post(
        "/api/conversation/start", json={"topic": "hotel_checkin"}
    )
    assert start_res.status_code == 200
    conv_id = start_res.json()["conversation_id"]

    # Reset mocks for the message call.
    mock_copilot.ask = AsyncMock(return_value="Great, glad to hear it!")

    async def _grammar_should_not_be_called(*args, **kwargs):
        raise AssertionError(
            "ask_json (grammar check) should NOT be called for trivial message"
        )

    mock_copilot.ask_json = AsyncMock(side_effect=_grammar_should_not_be_called)

    res = await client.post(
        "/api/conversation/message",
        json={"conversation_id": conv_id, "content": "yes"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["feedback"] is None
    mock_copilot.ask_json.assert_not_called()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_non_trivial_message_runs_grammar_check(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome to our hotel!")
    start_res = await client.post(
        "/api/conversation/start", json={"topic": "hotel_checkin"}
    )
    assert start_res.status_code == 200
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="That sounds wonderful, please continue.")
    mock_copilot.ask_json = AsyncMock(
        return_value={
            "corrected_text": "I went to the store yesterday and bought apples.",
            "is_correct": True,
            "errors": [],
            "suggestions": [],
        }
    )

    res = await client.post(
        "/api/conversation/message",
        json={
            "conversation_id": conv_id,
            "content": "I went to the store yesterday and bought apples",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["feedback"] is not None
    assert data["feedback"]["is_correct"] is True
    mock_copilot.ask_json.assert_called_once()
