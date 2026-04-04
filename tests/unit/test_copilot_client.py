"""Unit tests for CopilotService._parse_json."""

import pytest
from app.copilot_client import CopilotService


class TestParseJson:
    """Test JSON extraction from various LLM response formats."""

    def test_raw_json_object(self):
        raw = '{"key": "value", "num": 42}'
        result = CopilotService._parse_json(raw)
        assert result == {"key": "value", "num": 42}

    def test_json_in_markdown_fence(self):
        raw = 'Here is the result:\n```json\n{"score": 8, "feedback": "Good"}\n```\n'
        result = CopilotService._parse_json(raw)
        assert result == {"score": 8, "feedback": "Good"}

    def test_json_in_plain_fence(self):
        raw = '```\n{"a": 1}\n```'
        result = CopilotService._parse_json(raw)
        assert result == {"a": 1}

    def test_json_with_surrounding_text(self):
        raw = 'Sure! Here is your analysis:\n{"is_correct": true, "errors": []}\nHope this helps!'
        result = CopilotService._parse_json(raw)
        assert result == {"is_correct": True, "errors": []}

    def test_json_array_wrapped(self):
        raw = '[{"word": "hello"}, {"word": "world"}]'
        result = CopilotService._parse_json(raw)
        assert result == {"items": [{"word": "hello"}, {"word": "world"}]}

    def test_nested_json(self):
        raw = '{"data": {"nested": true}, "list": [1, 2, 3]}'
        result = CopilotService._parse_json(raw)
        assert result["data"]["nested"] is True
        assert result["list"] == [1, 2, 3]

    def test_invalid_json_raises(self):
        raw = "This is not JSON at all."
        with pytest.raises(ValueError, match="Failed to parse JSON"):
            CopilotService._parse_json(raw)

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            CopilotService._parse_json("")

    def test_markdown_fenced_array_wrapped(self):
        """Markdown-fenced JSON arrays should be wrapped in {items: ...}."""
        raw = '```json\n[{"word": "cat"}, {"word": "dog"}]\n```'
        result = CopilotService._parse_json(raw)
        assert "items" in result
        assert isinstance(result["items"], list)
        assert len(result["items"]) == 2

    def test_markdown_fenced_object_not_wrapped(self):
        """Markdown-fenced JSON objects should NOT be wrapped."""
        raw = '```json\n{"questions": [{"word": "cat"}]}\n```'
        result = CopilotService._parse_json(raw)
        assert "items" not in result
        assert "questions" in result

    def test_json_with_trailing_curly_braces(self):
        """JSON followed by text with curly braces should parse correctly."""
        raw = '{"score": 5, "feedback": "Good"}\nPractice words like {rain} and {shine}.'
        result = CopilotService._parse_json(raw)
        assert result == {"score": 5, "feedback": "Good"}

    def test_json_with_trailing_braces_and_brackets(self):
        """JSON followed by text with both {} and [] should parse correctly."""
        raw = '{"is_correct": true, "errors": []}\nTip: Use patterns [A] or {B} for better flow.'
        result = CopilotService._parse_json(raw)
        assert result == {"is_correct": True, "errors": []}

    def test_first_valid_json_object_returned(self):
        """When multiple JSON objects in text, the first valid one is returned."""
        raw = 'Result: {"score": 8}\nAlternative: {"score": 3}'
        result = CopilotService._parse_json(raw)
        assert result["score"] == 8


@pytest.mark.asyncio
@pytest.mark.unit
async def test_ensure_client_concurrent_no_race():
    """Concurrent _ensure_client calls should not return an unstarted client."""
    from unittest.mock import AsyncMock, patch, MagicMock

    service = CopilotService.__new__(CopilotService)
    service._model = "test"
    service._timeout = 10
    service._max_retries = 1
    service._retry_delays = [0]
    service._client = None
    service._init_lock = __import__("asyncio").Lock()

    mock_client = MagicMock()
    mock_client.start = AsyncMock()

    with patch("app.copilot_client.CopilotClient", return_value=mock_client):
        results = await __import__("asyncio").gather(
            service._ensure_client(),
            service._ensure_client(),
            service._ensure_client(),
        )

    # All should get the same fully-started client
    assert all(r is mock_client for r in results)
    # start() should only be called once (lock prevents duplicates)
    assert mock_client.start.call_count == 1
