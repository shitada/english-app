"""Unit tests for _canonicalize_error, _canonicalize_suggestion, and _normalize_grammar_feedback."""

import pytest

from app.routers.conversation import (
    _canonicalize_error,
    _canonicalize_suggestion,
    _normalize_grammar_feedback,
)


# ---------------------------------------------------------------------------
# _canonicalize_error
# ---------------------------------------------------------------------------

class TestCanonicalizeError:
    """Tests for _canonicalize_error key normalization."""

    def test_already_canonical(self):
        e = {"original": "he go", "correction": "he goes", "explanation": "subject-verb agreement"}
        result = _canonicalize_error(e)
        assert result == e

    @pytest.mark.parametrize("key", ["wrong", "incorrect", "incorrect_part"])
    def test_original_aliases(self, key):
        result = _canonicalize_error({key: "he go", "correction": "he goes"})
        assert result["original"] == "he go"
        assert key not in result

    @pytest.mark.parametrize("key", ["correct", "corrected", "right", "fixed"])
    def test_correction_aliases(self, key):
        result = _canonicalize_error({"original": "he go", key: "he goes"})
        assert result["correction"] == "he goes"
        assert key not in result

    @pytest.mark.parametrize("key", ["reason", "why", "note", "description"])
    def test_explanation_aliases(self, key):
        result = _canonicalize_error({"original": "x", key: "because grammar"})
        assert result["explanation"] == "because grammar"
        assert key not in result

    def test_does_not_overwrite_existing_original(self):
        result = _canonicalize_error({"original": "existing", "wrong": "ignored"})
        assert result["original"] == "existing"
        assert result.get("wrong") == "ignored"

    def test_does_not_overwrite_existing_correction(self):
        result = _canonicalize_error({"correction": "existing", "correct": "ignored"})
        assert result["correction"] == "existing"
        assert result.get("correct") == "ignored"

    def test_does_not_overwrite_existing_explanation(self):
        result = _canonicalize_error({"explanation": "existing", "reason": "ignored"})
        assert result["explanation"] == "existing"
        assert result.get("reason") == "ignored"

    def test_passthrough_unrecognized_keys(self):
        result = _canonicalize_error({"original": "x", "severity": "high", "line": 5})
        assert result["severity"] == "high"
        assert result["line"] == 5

    def test_empty_dict(self):
        result = _canonicalize_error({})
        assert result == {}

    def test_does_not_mutate_input(self):
        original = {"wrong": "he go", "correct": "he goes"}
        _ = _canonicalize_error(original)
        assert "wrong" in original  # Original dict not mutated


# ---------------------------------------------------------------------------
# _canonicalize_suggestion
# ---------------------------------------------------------------------------

class TestCanonicalizeSuggestion:
    """Tests for _canonicalize_suggestion key normalization."""

    def test_already_canonical(self):
        s = {"original": "I go store", "better": "I go to the store", "explanation": "missing preposition"}
        result = _canonicalize_suggestion(s)
        assert result == s

    @pytest.mark.parametrize("key", ["current", "text", "sentence"])
    def test_original_aliases(self, key):
        result = _canonicalize_suggestion({key: "I go store", "better": "fixed"})
        assert result["original"] == "I go store"
        assert key not in result

    @pytest.mark.parametrize("key", ["improved", "suggested", "alternative", "better_version"])
    def test_better_aliases(self, key):
        result = _canonicalize_suggestion({"original": "x", key: "improved text"})
        assert result["better"] == "improved text"
        assert key not in result

    @pytest.mark.parametrize("key", ["reason", "why", "note"])
    def test_explanation_aliases(self, key):
        result = _canonicalize_suggestion({"original": "x", key: "more natural"})
        assert result["explanation"] == "more natural"
        assert key not in result

    def test_does_not_overwrite_existing_better(self):
        result = _canonicalize_suggestion({"better": "existing", "improved": "ignored"})
        assert result["better"] == "existing"
        assert result.get("improved") == "ignored"

    def test_passthrough_unrecognized_keys(self):
        result = _canonicalize_suggestion({"original": "x", "confidence": 0.9})
        assert result["confidence"] == 0.9

    def test_empty_dict(self):
        result = _canonicalize_suggestion({})
        assert result == {}


# ---------------------------------------------------------------------------
# _normalize_grammar_feedback
# ---------------------------------------------------------------------------

class TestNormalizeGrammarFeedback:
    """Tests for _normalize_grammar_feedback full normalization."""

    def test_well_formatted_feedback(self):
        raw = {
            "corrected_text": "He goes to school.",
            "errors": [{"original": "go", "correction": "goes", "explanation": "sv agreement"}],
            "suggestions": [],
            "is_correct": False,
        }
        result = _normalize_grammar_feedback(raw)
        assert result["corrected_text"] == "He goes to school."
        assert len(result["errors"]) == 1
        assert result["errors"][0]["original"] == "go"
        assert result["suggestions"] == []
        assert result["is_correct"] is False

    def test_corrected_text_none_becomes_empty_string(self):
        result = _normalize_grammar_feedback({"corrected_text": None, "is_correct": True})
        assert result["corrected_text"] == ""

    def test_corrected_text_missing_becomes_empty_string(self):
        result = _normalize_grammar_feedback({"is_correct": True})
        assert result["corrected_text"] == ""

    def test_errors_as_single_dict_wrapped(self):
        raw = {"errors": {"wrong": "he go", "correct": "he goes"}, "is_correct": False}
        result = _normalize_grammar_feedback(raw)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["original"] == "he go"
        assert result["errors"][0]["correction"] == "he goes"

    def test_errors_as_string_wrapped(self):
        raw = {"errors": "Subject-verb agreement issue", "is_correct": False}
        result = _normalize_grammar_feedback(raw)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["explanation"] == "Subject-verb agreement issue"
        assert result["errors"][0]["original"] == ""

    def test_errors_as_none_becomes_empty_list(self):
        result = _normalize_grammar_feedback({"errors": None, "is_correct": True})
        assert result["errors"] == []

    def test_errors_missing_becomes_empty_list(self):
        result = _normalize_grammar_feedback({"is_correct": True})
        assert result["errors"] == []

    def test_errors_empty_string_becomes_empty_list(self):
        result = _normalize_grammar_feedback({"errors": "  ", "is_correct": True})
        assert result["errors"] == []

    def test_errors_list_filters_empty_strings(self):
        raw = {"errors": [{"original": "x"}, "", "  "], "is_correct": False}
        result = _normalize_grammar_feedback(raw)
        assert len(result["errors"]) == 1

    def test_errors_list_with_string_items(self):
        raw = {"errors": ["missing article", "wrong tense"], "is_correct": False}
        result = _normalize_grammar_feedback(raw)
        assert len(result["errors"]) == 2
        assert result["errors"][0]["explanation"] == "missing article"
        assert result["errors"][1]["explanation"] == "wrong tense"

    def test_suggestions_as_single_dict_wrapped(self):
        raw = {"suggestions": {"current": "I think", "improved": "I believe"}, "is_correct": True}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 1
        assert result["suggestions"][0]["original"] == "I think"
        assert result["suggestions"][0]["better"] == "I believe"

    def test_suggestions_as_string_wrapped(self):
        raw = {"suggestions": "Try using more formal language", "is_correct": True}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 1
        assert result["suggestions"][0]["better"] == "Try using more formal language"

    def test_suggestions_none_becomes_empty_list(self):
        result = _normalize_grammar_feedback({"suggestions": None, "is_correct": True})
        assert result["suggestions"] == []

    def test_suggestions_list_filters_empty_strings(self):
        raw = {"suggestions": [{"original": "x"}, "", "  "], "is_correct": True}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 1

    def test_is_correct_true_bool(self):
        result = _normalize_grammar_feedback({"is_correct": True})
        assert result["is_correct"] is True

    def test_is_correct_false_bool(self):
        result = _normalize_grammar_feedback({"is_correct": False, "errors": [{"original": "x"}]})
        assert result["is_correct"] is False

    def test_is_correct_string_true(self):
        result = _normalize_grammar_feedback({"is_correct": "true"})
        assert result["is_correct"] is True

    def test_is_correct_string_false(self):
        result = _normalize_grammar_feedback({"is_correct": "false", "errors": [{"original": "x"}]})
        assert result["is_correct"] is False

    def test_is_correct_none_no_errors_infers_true(self):
        result = _normalize_grammar_feedback({"is_correct": None, "errors": []})
        assert result["is_correct"] is True

    def test_is_correct_none_with_errors_infers_false(self):
        result = _normalize_grammar_feedback({"is_correct": None, "errors": [{"original": "x"}]})
        assert result["is_correct"] is False

    def test_is_correct_missing_no_errors_infers_true(self):
        result = _normalize_grammar_feedback({"errors": []})
        assert result["is_correct"] is True

    def test_is_correct_missing_with_errors_infers_false(self):
        result = _normalize_grammar_feedback({"errors": [{"original": "x"}]})
        assert result["is_correct"] is False

    def test_is_correct_omitted_empty_error_list_infers_true(self):
        result = _normalize_grammar_feedback({"errors": [], "suggestions": []})
        assert result["is_correct"] is True

    def test_is_correct_inferred_from_raw_errors_truthiness(self):
        """When errors is a non-empty string, is_correct should be inferred as False."""
        result = _normalize_grammar_feedback({"errors": "some error"})
        assert result["is_correct"] is False

    def test_does_not_mutate_input(self):
        raw = {"corrected_text": "test", "errors": [{"wrong": "x"}], "is_correct": False}
        raw_copy = {"corrected_text": "test", "errors": [{"wrong": "x"}], "is_correct": False}
        _normalize_grammar_feedback(raw)
        assert raw == raw_copy

    def test_full_complex_feedback(self):
        raw = {
            "corrected_text": "She has been studying English for three years.",
            "errors": [
                {"wrong": "studyed", "correct": "studied", "reason": "irregular past participle"},
                {"incorrect": "for three year", "fixed": "for three years", "why": "plural needed"},
            ],
            "suggestions": [
                {"text": "She has been studying", "alternative": "She has studied", "note": "simpler form"},
            ],
            "is_correct": False,
        }
        result = _normalize_grammar_feedback(raw)
        assert result["corrected_text"] == "She has been studying English for three years."
        assert len(result["errors"]) == 2
        assert result["errors"][0]["original"] == "studyed"
        assert result["errors"][0]["correction"] == "studied"
        assert result["errors"][0]["explanation"] == "irregular past participle"
        assert result["errors"][1]["original"] == "for three year"
        assert result["errors"][1]["correction"] == "for three years"
        assert result["errors"][1]["explanation"] == "plural needed"
        assert len(result["suggestions"]) == 1
        assert result["suggestions"][0]["original"] == "She has been studying"
        assert result["suggestions"][0]["better"] == "She has studied"
        assert result["suggestions"][0]["explanation"] == "simpler form"
        assert result["is_correct"] is False
