"""Tests for POST /api/conversation/{id}/reply-hints."""

from __future__ import annotations

import pytest

from app.dal import conversation as conv_dal
from app.routers import conversation as conv_router


async def _make_conv_with_assistant_msg(client, mock_copilot, ai_text: str = "Welcome to our hotel! How may I help you today?") -> int:
    """Use the start_conversation API to create a conversation with one assistant message."""
    # Stub the assistant opener
    mock_copilot.ask.return_value = ai_text
    resp = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin", "difficulty": "intermediate"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["conversation_id"]


@pytest.fixture(autouse=True)
def _clear_reply_hints_cache():
    conv_router._REPLY_HINTS_CACHE.clear()
    yield
    conv_router._REPLY_HINTS_CACHE.clear()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reply_hints_happy_path_returns_3(client, mock_copilot):
    cid = await _make_conv_with_assistant_msg(client, mock_copilot)
    # Override ask_json to return well-formed hints payload
    mock_copilot.ask_json.return_value = {
        "hints": [
            {"en": "I'd like to check in.", "jp": "チェックインしたいです。"},
            {"en": "Do you have a room?", "jp": "部屋はありますか？"},
            {"en": "What time is breakfast?", "jp": "朝食は何時ですか？"},
        ]
    }
    resp = await client.post(f"/api/conversation/{cid}/reply-hints")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["fallback"] is False
    assert len(body["hints"]) == 3
    assert body["hints"][0]["en"] == "I'd like to check in."
    assert body["hints"][0]["jp"] == "チェックインしたいです。"
    assert body["turn_index"] >= 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reply_hints_malformed_json_returns_fallback(client, mock_copilot):
    cid = await _make_conv_with_assistant_msg(client, mock_copilot)
    # Simulate parse failure surfaced as exception from ask_json
    mock_copilot.ask_json.side_effect = ValueError("could not parse JSON")
    resp = await client.post(f"/api/conversation/{cid}/reply-hints")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["fallback"] is True
    assert body["hints"] == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reply_hints_unknown_conversation_returns_404(client, mock_copilot):
    resp = await client.post("/api/conversation/999999/reply-hints")
    assert resp.status_code == 404
    assert mock_copilot.ask_json.await_count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reply_hints_empty_hints_list_marks_fallback(client, mock_copilot):
    cid = await _make_conv_with_assistant_msg(client, mock_copilot)
    mock_copilot.ask_json.return_value = {"hints": []}
    resp = await client.post(f"/api/conversation/{cid}/reply-hints")
    assert resp.status_code == 200
    body = resp.json()
    assert body["hints"] == []
    assert body["fallback"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reply_hints_cached_within_ttl(client, mock_copilot):
    cid = await _make_conv_with_assistant_msg(client, mock_copilot)
    mock_copilot.ask_json.return_value = {
        "hints": [{"en": "Sure thing.", "jp": "もちろん。"}]
    }
    r1 = await client.post(f"/api/conversation/{cid}/reply-hints")
    r2 = await client.post(f"/api/conversation/{cid}/reply-hints")
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json() == r2.json()
    # Should have been called only once thanks to the cache.
    assert mock_copilot.ask_json.await_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reply_hints_ended_conversation_returns_409(client, mock_copilot, test_db):
    cid = await _make_conv_with_assistant_msg(client, mock_copilot)
    # End the conversation directly via DAL (uses the same on-disk SQLite file as `client`).
    # Note: client fixture uses a fresh DB file per test, but conv_dal operates on whichever
    # connection is passed. We need to end via API to share the same DB file.
    end_resp = await client.post(
        "/api/conversation/end",
        json={"conversation_id": cid, "skip_summary": True},
    )
    assert end_resp.status_code in (200, 409), end_resp.text

    resp = await client.post(f"/api/conversation/{cid}/reply-hints")
    assert resp.status_code == 409
