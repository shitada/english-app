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
