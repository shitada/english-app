"""Unit tests for app/utils.py (safe_llm_call and get_topic_label)."""

from __future__ import annotations

import asyncio
import logging
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.utils import get_topic_label, safe_llm_call, validate_topic


@pytest.mark.unit
class TestSafeLlmCall:
    async def test_returns_result_on_success(self):
        """Should return the awaited result when the coroutine succeeds."""
        async def _ok():
            return "Hello from LLM"
        result = await safe_llm_call(_ok, context="test")
        assert result == "Hello from LLM"

    async def test_raises_502_on_exception(self):
        """Should raise HTTPException 502 when all retries fail."""
        call_count = 0
        async def _fail():
            nonlocal call_count
            call_count += 1
            raise ValueError("connection lost")
        with pytest.raises(HTTPException) as exc_info:
            await safe_llm_call(_fail, context="test_fail", max_retries=0)
        assert exc_info.value.status_code == 502
        assert "AI service temporarily unavailable" in exc_info.value.detail
        assert call_count == 1

    async def test_catches_timeout_error(self):
        """Should handle asyncio.TimeoutError and raise 502."""
        async def _timeout():
            raise asyncio.TimeoutError()
        with pytest.raises(HTTPException) as exc_info:
            await safe_llm_call(_timeout, context="test_timeout", max_retries=0)
        assert exc_info.value.status_code == 502

    async def test_logs_error_with_context(self, caplog):
        """Should log the error message with the context string."""
        async def _fail():
            raise RuntimeError("oops")
        with caplog.at_level(logging.ERROR, logger="app.utils"):
            with pytest.raises(HTTPException):
                await safe_llm_call(_fail, context="my_context", max_retries=0)
        assert "my_context" in caplog.text
        assert "oops" in caplog.text

    async def test_returns_dict_result(self):
        """Should properly return complex types like dicts."""
        async def _json():
            return {"score": 85, "feedback": "good"}
        result = await safe_llm_call(_json, context="test_json")
        assert result == {"score": 85, "feedback": "good"}

    @patch("app.utils.asyncio.sleep", new_callable=AsyncMock)
    async def test_succeeds_on_second_attempt(self, mock_sleep):
        """Should retry and succeed on the second attempt."""
        call_count = 0
        async def _flaky():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("transient failure")
            return "recovered"
        result = await safe_llm_call(_flaky, context="retry_test", max_retries=2)
        assert result == "recovered"
        assert call_count == 2
        mock_sleep.assert_called_once_with(1)

    @patch("app.utils.asyncio.sleep", new_callable=AsyncMock)
    async def test_succeeds_on_third_attempt(self, mock_sleep):
        """Should retry twice and succeed on the third attempt."""
        call_count = 0
        async def _flaky():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise TimeoutError("slow")
            return "finally"
        result = await safe_llm_call(_flaky, context="retry3", max_retries=2)
        assert result == "finally"
        assert call_count == 3
        assert mock_sleep.call_count == 2

    @patch("app.utils.asyncio.sleep", new_callable=AsyncMock)
    async def test_exhausts_retries_then_raises_502(self, mock_sleep):
        """Should raise 502 after all retries are exhausted."""
        call_count = 0
        async def _always_fail():
            nonlocal call_count
            call_count += 1
            raise RuntimeError("permanent failure")
        with pytest.raises(HTTPException) as exc_info:
            await safe_llm_call(_always_fail, context="exhaust", max_retries=2)
        assert exc_info.value.status_code == 502
        assert call_count == 3
        assert mock_sleep.call_count == 2

    async def test_no_retries_when_max_retries_zero(self):
        """Should not retry when max_retries=0."""
        call_count = 0
        async def _fail():
            nonlocal call_count
            call_count += 1
            raise ValueError("once")
        with pytest.raises(HTTPException):
            await safe_llm_call(_fail, context="no_retry", max_retries=0)
        assert call_count == 1

    @patch("app.utils.asyncio.sleep", new_callable=AsyncMock)
    async def test_logs_warning_on_each_retry(self, mock_sleep, caplog):
        """Should log a warning for each retry attempt."""
        call_count = 0
        async def _flaky():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ConnectionError("transient")
            return "ok"
        with caplog.at_level(logging.WARNING, logger="app.utils"):
            result = await safe_llm_call(_flaky, context="warn_test", max_retries=2)
        assert result == "ok"
        assert caplog.text.count("LLM retry") == 2

    async def test_backward_compat_with_awaitable(self):
        """Should still work when passed a plain awaitable (no retry possible)."""
        async def _ok():
            return "legacy"
        result = await safe_llm_call(_ok(), context="compat")
        assert result == "legacy"


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


@pytest.mark.unit
class TestValidateTopic:
    def test_valid_topic_returns_dict(self):
        topics = [
            {"id": "hotel_checkin", "label": "Hotel Check-in"},
            {"id": "shopping", "label": "Shopping"},
        ]
        result = validate_topic(topics, "hotel_checkin")
        assert result == {"id": "hotel_checkin", "label": "Hotel Check-in"}

    def test_invalid_topic_raises_422(self):
        topics = [{"id": "hotel_checkin", "label": "Hotel Check-in"}]
        with pytest.raises(HTTPException) as exc_info:
            validate_topic(topics, "nonexistent")
        assert exc_info.value.status_code == 422
        assert "nonexistent" in exc_info.value.detail

    def test_error_includes_valid_ids(self):
        topics = [
            {"id": "hotel_checkin", "label": "Hotel"},
            {"id": "shopping", "label": "Shopping"},
        ]
        with pytest.raises(HTTPException) as exc_info:
            validate_topic(topics, "bad")
        assert "hotel_checkin" in exc_info.value.detail
        assert "shopping" in exc_info.value.detail

    def test_empty_topics_raises_422(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_topic([], "any")
        assert exc_info.value.status_code == 422
