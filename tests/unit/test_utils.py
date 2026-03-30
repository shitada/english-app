"""Unit tests for app/utils.py (safe_llm_call and get_topic_label)."""

from __future__ import annotations

import asyncio
import logging

import pytest
from fastapi import HTTPException

from app.utils import get_topic_label, safe_llm_call


@pytest.mark.unit
class TestSafeLlmCall:
    async def test_returns_result_on_success(self):
        """Should return the awaited result when the coroutine succeeds."""
        async def _ok():
            return "Hello from LLM"
        result = await safe_llm_call(_ok(), context="test")
        assert result == "Hello from LLM"

    async def test_raises_502_on_exception(self):
        """Should raise HTTPException 502 when the coroutine fails."""
        async def _fail():
            raise ValueError("connection lost")
        with pytest.raises(HTTPException) as exc_info:
            await safe_llm_call(_fail(), context="test_fail")
        assert exc_info.value.status_code == 502
        assert "AI service temporarily unavailable" in exc_info.value.detail

    async def test_catches_timeout_error(self):
        """Should handle asyncio.TimeoutError and raise 502."""
        async def _timeout():
            raise asyncio.TimeoutError()
        with pytest.raises(HTTPException) as exc_info:
            await safe_llm_call(_timeout(), context="test_timeout")
        assert exc_info.value.status_code == 502

    async def test_logs_error_with_context(self, caplog):
        """Should log the error message with the context string."""
        async def _fail():
            raise RuntimeError("oops")
        with caplog.at_level(logging.ERROR, logger="app.utils"):
            with pytest.raises(HTTPException):
                await safe_llm_call(_fail(), context="my_context")
        assert "my_context" in caplog.text
        assert "oops" in caplog.text

    async def test_returns_dict_result(self):
        """Should properly return complex types like dicts."""
        async def _json():
            return {"score": 85, "feedback": "good"}
        result = await safe_llm_call(_json(), context="test_json")
        assert result == {"score": 85, "feedback": "good"}


@pytest.mark.unit
class TestGetTopicLabel:
    def test_returns_label_for_known_topic(self):
        topics = [
            {"id": "hotel_checkin", "label": "Hotel Check-in"},
            {"id": "shopping", "label": "Shopping"},
        ]
        assert get_topic_label(topics, "hotel_checkin") == "Hotel Check-in"

    def test_returns_id_when_not_found(self):
        topics = [{"id": "hotel_checkin", "label": "Hotel Check-in"}]
        assert get_topic_label(topics, "unknown_topic") == "unknown_topic"

    def test_handles_empty_list(self):
        assert get_topic_label([], "any_topic") == "any_topic"

    def test_returns_first_match(self):
        topics = [
            {"id": "x", "label": "First"},
            {"id": "x", "label": "Second"},
        ]
        assert get_topic_label(topics, "x") == "First"
