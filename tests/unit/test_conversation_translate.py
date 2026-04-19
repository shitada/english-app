"""Tests for POST /api/conversation/translate (per-message JP translation)."""

from __future__ import annotations

import pytest


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_valid_returns_200_with_translation(client, mock_copilot):
    mock_copilot.ask.return_value = "こんにちは、お元気ですか？"
    resp = await client.post(
        "/api/conversation/translate",
        json={"text": "Hello, how are you?"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["translation"] == "こんにちは、お元気ですか？"
    # Sanity: copilot.ask was called once with the JP system prompt
    assert mock_copilot.ask.await_count == 1
    args, kwargs = mock_copilot.ask.call_args
    # First positional arg is the system prompt
    system_prompt = args[0] if args else kwargs.get("system", "")
    assert "Japanese" in system_prompt


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_empty_string_returns_422(client, mock_copilot):
    resp = await client.post(
        "/api/conversation/translate",
        json={"text": "   "},
    )
    assert resp.status_code == 422
    # Copilot must NOT be called for empty input
    assert mock_copilot.ask.await_count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_too_long_returns_400(client, mock_copilot):
    long_text = "a " * 600  # 1200 chars
    resp = await client.post(
        "/api/conversation/translate",
        json={"text": long_text},
    )
    assert resp.status_code == 400
    assert mock_copilot.ask.await_count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_copilot_failure_returns_5xx(client, mock_copilot):
    mock_copilot.ask.side_effect = RuntimeError("LLM down")
    resp = await client.post(
        "/api/conversation/translate",
        json={"text": "Hello there."},
    )
    assert 500 <= resp.status_code < 600
