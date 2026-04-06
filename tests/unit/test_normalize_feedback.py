"""Unit tests for normalization functions in routers."""

import pytest
from app.routers.conversation import _normalize_grammar_feedback, _normalize_summary
from app.routers.pronunciation import _normalize_feedback as _normalize_pronunciation_feedback


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

    def test_errors_string_preserved_as_description(self):
        """When errors is a non-empty string, wrap as dict and infer is_correct=False."""
        raw = {"errors": "Missing article before 'store'"}
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["description"] == "Missing article before 'store'"

    def test_errors_dict_wrapped_in_list(self):
        """When errors is a single dict, wrap in a list and infer is_correct=False."""
        raw = {"errors": {"original": "goed", "correction": "went", "explanation": "past tense"}}
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["original"] == "goed"

    def test_errors_empty_string_treated_as_no_errors(self):
        """When errors is an empty string, treat as no errors."""
        raw = {"errors": ""}
        result = _normalize_grammar_feedback(raw)
        assert result["errors"] == []
        assert result["is_correct"] is True

    def test_suggestions_normalized(self):
        """Suggestions should be normalized to list of dicts."""
        raw = {"suggestions": [{"text": "try this"}], "errors": []}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 1
        assert result["suggestions"][0]["text"] == "try this"

    def test_errors_list_of_strings_wrapped_as_dicts(self):
        """When errors is a list of strings, each should be wrapped as {description: str}."""
        raw = {"errors": ["Missing article", "Wrong tense"]}
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is False
        assert len(result["errors"]) == 2
        assert result["errors"][0] == {"description": "Missing article"}
        assert result["errors"][1] == {"description": "Wrong tense"}

    def test_errors_list_mixed_strings_and_dicts(self):
        """Mixed list of strings and dicts should all be normalized."""
        raw = {"errors": [{"original": "goed", "correction": "went"}, "Wrong article"]}
        result = _normalize_grammar_feedback(raw)
        assert len(result["errors"]) == 2
        assert result["errors"][0]["original"] == "goed"
        assert result["errors"][1] == {"description": "Wrong article"}

    def test_suggestions_list_of_strings_wrapped(self):
        """When suggestions is a list of strings, each should be wrapped as {text: str}."""
        raw = {"errors": [], "suggestions": ["Use 'the' here", "Try past tense"]}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 2
        assert result["suggestions"][0] == {"text": "Use 'the' here"}
        assert result["suggestions"][1] == {"text": "Try past tense"}

    def test_suggestions_bare_string_wrapped(self):
        """When suggestions is a single string, wrap as [{text: str}]."""
        raw = {"errors": [], "suggestions": "Try using present tense"}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 1
        assert result["suggestions"][0] == {"text": "Try using present tense"}

    def test_suggestions_bare_dict_wrapped(self):
        """When suggestions is a single dict, wrap in a list."""
        raw = {"errors": [], "suggestions": {"text": "Try X"}}
        result = _normalize_grammar_feedback(raw)
        assert len(result["suggestions"]) == 1
        assert result["suggestions"][0] == {"text": "Try X"}


@pytest.mark.unit
class TestNormalizeSummaryNoneHandling:
    def test_communication_level_none_defaults_to_unknown(self):
        """When LLM returns null for communication_level, use 'unknown' not 'None'."""
        raw = {"communication_level": None, "key_vocabulary": [], "tip": "tip", "summary": "s"}
        result = _normalize_summary(raw)
        assert result["communication_level"] == "unknown"

    def test_communication_level_absent_defaults_to_unknown(self):
        """When communication_level is absent, default to 'unknown'."""
        raw = {"key_vocabulary": [], "tip": "tip", "summary": "s"}
        result = _normalize_summary(raw)
        assert result["communication_level"] == "unknown"


@pytest.mark.unit
class TestNormalizePronunciationNoneHandling:
    def test_overall_feedback_none_defaults_to_empty(self):
        """When LLM returns null for overall_feedback, use '' not 'None'."""
        raw = {"overall_feedback": None, "word_feedback": [], "score": 5, "focus_areas": []}
        result = _normalize_pronunciation_feedback(raw)
        assert result["overall_feedback"] == ""

    def test_fluency_feedback_none_defaults_to_empty(self):
        """When LLM returns null for fluency_feedback, use '' not 'None'."""
        raw = {"overall_feedback": "ok", "word_feedback": [], "score": 5, "focus_areas": [], "fluency_feedback": None}
        result = _normalize_pronunciation_feedback(raw)
        assert result["fluency_feedback"] == ""

    def test_focus_areas_filters_none_items(self):
        """None items in focus_areas list should be filtered out."""
        raw = {"overall_feedback": "ok", "word_feedback": [], "score": 5, "focus_areas": ["vowels", None, "rhythm"]}
        result = _normalize_pronunciation_feedback(raw)
        assert result["focus_areas"] == ["vowels", "rhythm"]

    def test_common_patterns_filters_none_items(self):
        """None items in common_patterns list should be filtered out."""
        raw = {"overall_feedback": "ok", "word_feedback": [], "score": 5, "focus_areas": [], "common_patterns": [None, "pattern1", None]}
        result = _normalize_pronunciation_feedback(raw)
        assert result["common_patterns"] == ["pattern1"]

    def test_phoneme_issues_none_values_become_empty_string(self):
        """None values in phoneme_issues dicts should become empty string."""
        raw = {
            "overall_feedback": "ok", "score": 5, "focus_areas": [],
            "word_feedback": [{"word": "test", "is_correct": True, "phoneme_issues": [{"target_sound": None, "advice": "try again"}]}],
        }
        result = _normalize_pronunciation_feedback(raw)
        issues = result["word_feedback"][0]["phoneme_issues"]
        assert issues[0]["target"] == ""
        assert issues[0]["advice"] == "try again"


@pytest.mark.unit
class TestNormalizeSummaryNoneInLists:
    def test_key_vocabulary_filters_none_items(self):
        """None items in key_vocabulary list should be filtered out."""
        raw = {"communication_level": "B1", "key_vocabulary": ["apple", None, "banana"], "tip": "tip", "summary": "s"}
        result = _normalize_summary(raw)
        assert result["key_vocabulary"] == ["apple", "banana"]


@pytest.mark.unit
class TestPronunciationNonListWrapping:
    def test_focus_areas_bare_string_wrapped(self):
        """When focus_areas is a string, wrap as [str]."""
        raw = {"overall_feedback": "ok", "word_feedback": [], "score": 5, "focus_areas": "vowel sounds"}
        result = _normalize_pronunciation_feedback(raw)
        assert result["focus_areas"] == ["vowel sounds"]

    def test_common_patterns_bare_string_wrapped(self):
        """When common_patterns is a string, wrap as [str]."""
        raw = {"overall_feedback": "ok", "word_feedback": [], "score": 5, "focus_areas": [], "common_patterns": "dropping final consonants"}
        result = _normalize_pronunciation_feedback(raw)
        assert result["common_patterns"] == ["dropping final consonants"]


from app.routers.pronunciation import _parse_score


@pytest.mark.unit
class TestParseScore:
    def test_plain_float(self):
        assert _parse_score(8.5) == 8.5

    def test_plain_int(self):
        assert _parse_score(7) == 7.0

    def test_string_float(self):
        assert _parse_score("8.5") == 8.5

    def test_fraction_format(self):
        assert _parse_score("8.5/10") == 8.5

    def test_out_of_format(self):
        assert _parse_score("8 out of 10") == 8.0

    def test_score_prefix(self):
        assert _parse_score("Score: 7.5") == 7.5

    def test_percentage(self):
        assert _parse_score("85%") == 8.5

    def test_percentage_100(self):
        assert _parse_score("100%") == 10.0

    def test_none(self):
        assert _parse_score(None) is None

    def test_empty_string(self):
        assert _parse_score("") is None

    def test_na_string(self):
        assert _parse_score("N/A") is None

    def test_nan(self):
        assert _parse_score(float("nan")) is None

    def test_infinity(self):
        assert _parse_score(float("inf")) is None

    def test_clamp_high(self):
        assert _parse_score(15.0) == 10.0

    def test_clamp_low(self):
        assert _parse_score(-2.0) == 0.0

    def test_zero(self):
        assert _parse_score(0) == 0.0

    def test_low_percentage_5(self):
        assert _parse_score("5%") == 0.5

    def test_low_percentage_3(self):
        assert _parse_score("3%") == 0.3

    def test_low_percentage_10(self):
        assert _parse_score("10%") == 1.0


@pytest.mark.unit
class TestIsCorrectNone:
    def test_grammar_is_correct_none_with_errors_inferred_false(self):
        """is_correct=None with errors present should infer is_correct=False."""
        raw = {
            "is_correct": None,
            "errors": [{"type": "grammar", "description": "missing article"}],
            "suggestions": ["Use 'the' before nouns"],
        }
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is False

    def test_grammar_is_correct_none_no_errors_inferred_true(self):
        """is_correct=None with no errors should infer is_correct=True."""
        raw = {
            "is_correct": None,
            "errors": [],
            "suggestions": [],
        }
        result = _normalize_grammar_feedback(raw)
        assert result["is_correct"] is True

    def test_pronunciation_word_feedback_is_correct_none(self):
        """word_feedback item with is_correct=None should default to False."""
        raw = {
            "overall_feedback": "ok",
            "overall_score": 7.0,
            "word_feedback": [
                {"word": "hello", "is_correct": None, "phoneme_issues": []},
            ],
            "focus_areas": [],
        }
        result = _normalize_pronunciation_feedback(raw)
        assert result["word_feedback"][0]["is_correct"] is False


@pytest.mark.unit
class TestPhonemeIssuesCanonicalization:
    def test_target_sound_renamed_to_target(self):
        """LLM key target_sound is canonicalized to target."""
        raw = {
            "overall_feedback": "ok", "overall_score": 7.0,
            "word_feedback": [
                {"word": "hello", "is_correct": False, "phoneme_issues": [
                    {"target_sound": "h", "produced_sound": "ʔ", "position": "initial"}
                ]},
            ],
            "focus_areas": [],
        }
        result = _normalize_pronunciation_feedback(raw)
        pi = result["word_feedback"][0]["phoneme_issues"]
        assert len(pi) == 1
        assert pi[0]["target"] == "h"
        assert pi[0]["produced"] == "ʔ"
        assert pi[0]["position"] == "initial"
        assert "target_sound" not in pi[0]
        assert "produced_sound" not in pi[0]

    def test_canonical_keys_preserved(self):
        """If already using canonical target/produced, they are preserved."""
        raw = {
            "overall_feedback": "ok", "overall_score": 8.0,
            "word_feedback": [
                {"word": "world", "is_correct": True, "phoneme_issues": [
                    {"target": "ɹ", "produced": "l", "tip": "curl tongue"}
                ]},
            ],
            "focus_areas": [],
        }
        result = _normalize_pronunciation_feedback(raw)
        pi = result["word_feedback"][0]["phoneme_issues"]
        assert pi[0]["target"] == "ɹ"
        assert pi[0]["produced"] == "l"
        assert pi[0]["tip"] == "curl tongue"


@pytest.mark.unit
class TestWordFeedbackKeyCanonicalization:
    def test_word_key_canonicalized_to_expected(self):
        """LLM key 'word' is canonicalized to 'expected'."""
        raw = {
            "overall_feedback": "ok", "overall_score": 7.0,
            "word_feedback": [
                {"word": "hello", "is_correct": False, "phoneme_issues": []},
            ],
            "focus_areas": [],
        }
        result = _normalize_pronunciation_feedback(raw)
        item = result["word_feedback"][0]
        assert item["expected"] == "hello"
        assert "word" not in item

    def test_expected_key_preserved(self):
        """If already using canonical 'expected' key, it is preserved."""
        raw = {
            "overall_feedback": "ok", "overall_score": 8.0,
            "word_feedback": [
                {"expected": "world", "is_correct": True, "phoneme_issues": []},
            ],
            "focus_areas": [],
        }
        result = _normalize_pronunciation_feedback(raw)
        item = result["word_feedback"][0]
        assert item["expected"] == "world"

    def test_actual_key_canonicalized_to_heard(self):
        """LLM key 'actual' is canonicalized to 'heard'."""
        raw = {
            "overall_feedback": "ok", "overall_score": 6.0,
            "word_feedback": [
                {"word": "test", "actual": "tast", "is_correct": False, "phoneme_issues": []},
            ],
            "focus_areas": [],
        }
        result = _normalize_pronunciation_feedback(raw)
        item = result["word_feedback"][0]
        assert item["heard"] == "tast"
        assert "actual" not in item

    def test_both_word_and_expected_present(self):
        """If both 'word' and 'expected' exist, 'expected' is preserved and 'word' left."""
        raw = {
            "overall_feedback": "ok", "overall_score": 7.0,
            "word_feedback": [
                {"word": "apple", "expected": "banana", "is_correct": True, "phoneme_issues": []},
            ],
            "focus_areas": [],
        }
        result = _normalize_pronunciation_feedback(raw)
        item = result["word_feedback"][0]
        assert item["expected"] == "banana"
        assert item["word"] == "apple"
