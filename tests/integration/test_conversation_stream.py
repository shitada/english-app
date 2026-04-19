"""Integration tests for the SSE streaming conversation endpoint."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest


def _parse_sse(body: str) -> list[dict]:
    """Parse an SSE response body into a list of JSON event payloads."""
    events: list[dict] = []
    for raw_event in body.split("\n\n"):
        lines = [ln for ln in raw_event.splitlines() if ln.startswith("data:")]
        if not lines:
            continue
        payload = "\n".join(ln[len("data:"):].lstrip(" ") for ln in lines)
        try:
            events.append(json.loads(payload))
        except json.JSONDecodeError:
            continue
    return events


async def _start_conversation(client, mock_copilot) -> int:
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's begin.")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert res.status_code == 200, res.text
    return res.json()["conversation_id"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_stream_message_emits_chunks_and_done(client, mock_copilot):
    """Endpoint streams chunks then a done event with persisted message id."""
    conv_id = await _start_conversation(client, mock_copilot)

    # Mock stream_chat as an async generator yielding 3 chunks deterministically.
    async def fake_stream_chat(system, user, **kwargs):  # noqa: ARG001
        for piece in ["Hello ", "there, ", "friend!"]:
            yield piece

    mock_copilot.stream_chat = fake_stream_chat
    # Skip grammar (short message triggers skip path → no LLM call needed)
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "Hi",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })

    res = await client.post(
        f"/api/conversation/{conv_id}/message/stream",
        json={"conversation_id": conv_id, "content": "Hi"},
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(res.text)
    chunk_events = [e for e in events if e.get("type") == "chunk"]
    done_events = [e for e in events if e.get("type") == "done"]

    assert len(chunk_events) == 3
    assert [e["text"] for e in chunk_events] == ["Hello ", "there, ", "friend!"]
    assert len(done_events) == 1
    assert done_events[0]["message_id"] is not None

    # Assistant message persisted via DAL — verify via history endpoint.
    hist = await client.get(f"/api/conversation/{conv_id}/history")
    assert hist.status_code == 200
    msgs = hist.json()["messages"]
    assistant_msgs = [m for m in msgs if m["role"] == "assistant"]
    # opening + streamed reply
    assert any(m["content"] == "Hello there, friend!" for m in assistant_msgs)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_stream_message_runs_grammar_in_parallel(client, mock_copilot):
    """For longer non-trivial messages, grammar feedback is included in done event."""
    conv_id = await _start_conversation(client, mock_copilot)

    async def fake_stream_chat(system, user, **kwargs):  # noqa: ARG001
        for piece in ["Sure", ", ", "happy to help."]:
            yield piece

    mock_copilot.stream_chat = fake_stream_chat
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I would like to book a room please.",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })

    res = await client.post(
        f"/api/conversation/{conv_id}/message/stream",
        json={"conversation_id": conv_id, "content": "I would like to book a room please."},
    )
    assert res.status_code == 200
    events = _parse_sse(res.text)
    done = [e for e in events if e.get("type") == "done"]
    assert len(done) == 1
    grammar = done[0]["grammar"]
    assert grammar is not None
    assert grammar["is_correct"] is True


@pytest.mark.asyncio
@pytest.mark.integration
async def test_stream_message_404_for_unknown_conversation(client, mock_copilot):
    async def fake_stream_chat(system, user, **kwargs):  # noqa: ARG001
        yield "x"

    mock_copilot.stream_chat = fake_stream_chat
    res = await client.post(
        "/api/conversation/99999/message/stream",
        json={"conversation_id": 99999, "content": "Hello there friend"},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
@pytest.mark.integration
async def test_stream_message_id_mismatch_400(client, mock_copilot):
    conv_id = await _start_conversation(client, mock_copilot)

    async def fake_stream_chat(system, user, **kwargs):  # noqa: ARG001
        yield "x"

    mock_copilot.stream_chat = fake_stream_chat
    res = await client.post(
        f"/api/conversation/{conv_id}/message/stream",
        json={"conversation_id": conv_id + 1, "content": "Hello there friend"},
    )
    assert res.status_code == 400
