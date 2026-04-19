"""Integration tests for the Conversation Quick Reply mode."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.integration
@pytest.mark.asyncio
async def test_quick_mode_returned_in_start_response(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin", "quick_mode": True},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["quick_mode"] is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_quick_mode_default_false(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin"},
    )
    assert res.status_code == 200
    assert res.json()["quick_mode"] is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_quick_mode_skips_grammar_feedback_on_message(client, mock_copilot):
    """When quick_mode=true, grammar feedback must be None and ask_json must NOT be called,
    even for non-trivial user messages that would normally trigger grammar checking."""
    mock_copilot.ask = AsyncMock(return_value="Welcome to our hotel!")
    start_res = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin", "quick_mode": True},
    )
    assert start_res.status_code == 200
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Sure thing.")

    async def _grammar_should_not_be_called(*args, **kwargs):
        raise AssertionError(
            "ask_json (grammar check) should NOT be called when quick_mode=true"
        )

    mock_copilot.ask_json = AsyncMock(side_effect=_grammar_should_not_be_called)

    res = await client.post(
        "/api/conversation/message",
        json={
            "conversation_id": conv_id,
            "content": "I would like to book a room for two nights please",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["feedback"] is None
    mock_copilot.ask_json.assert_not_called()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_non_quick_mode_still_runs_grammar(client, mock_copilot):
    """Sanity: with quick_mode=false, grammar is still checked for non-trivial messages."""
    mock_copilot.ask = AsyncMock(return_value="Welcome to our hotel!")
    start_res = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin", "quick_mode": False},
    )
    assert start_res.status_code == 200
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Of course, right this way.")
    mock_copilot.ask_json = AsyncMock(
        return_value={
            "corrected_text": "I would like to book a room for two nights please.",
            "is_correct": True,
            "errors": [],
            "suggestions": [],
        }
    )

    res = await client.post(
        "/api/conversation/message",
        json={
            "conversation_id": conv_id,
            "content": "I would like to book a room for two nights please",
        },
    )
    assert res.status_code == 200
    assert res.json()["feedback"] is not None
    mock_copilot.ask_json.assert_called_once()
