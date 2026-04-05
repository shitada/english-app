"""Unit tests for _normalize_grammar_feedback in app/routers/conversation.py."""

import pytest
from app.routers.conversation import _normalize_grammar_feedback


@pytest.mark.unit
class TestNormalizeGrammarFeedback:
    def test_errors_present_is_correct_omitted_defaults_to_false(self):
        """When LLM returns errors but omits is_correct, infer False."""
        raw = {
            "corrected_text": "I went to the store.",
            "errors": [{"original": "goed", "correction": "went", "explanation": "past tense"}],
        }
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is False
        assert len(result["errors"]) == 1

    def test_no_errors_is_correct_omitted_defaults_to_true(self):
        """When LLM returns no errors and omits is_correct, infer True."""
        raw = {"corrected_text": "", "errors": []}
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is True
        assert result["errors"] == []

    def test_is_correct_explicit_true_with_errors_respected(self):
        """When LLM explicitly sets is_correct=true with errors, respect it."""
        raw = {
            "is_correct": True,
            "corrected_text": "minor style",
            "errors": [{"original": "a", "correction": "b", "explanation": "style"}],
        }
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is True

    def test_is_correct_explicit_false_without_errors(self):
        """When LLM explicitly sets is_correct=false, respect it even without errors."""
        raw = {"is_correct": False, "corrected_text": "fixed", "errors": []}
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is False

    def test_errors_missing_entirely_defaults_to_true(self):
        """When LLM omits both is_correct and errors, default to correct."""
        raw = {"corrected_text": ""}
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is True
        assert result["errors"] == []

    def test_errors_non_list_ignored(self):
        """When errors is not a list, normalize to empty list."""
        raw = {"errors": "not a list"}
        result = _normalize_grammar_feedback(raw)
        assert result["errors"] == []
        assert result["is_correct"] is True

    def test_suggestions_normalized(self):
        """Suggestions should be normalized to list of dicts."""
        raw = {"suggestions": [{"text": "try this"}], "errors": []}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 1
        assert result["suggestions"][0]["text"] == "try this"
