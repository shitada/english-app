"""Unit tests for error-correction normalize + word_diff helpers."""

from __future__ import annotations

import pytest

from app.routers.error_correction import (
    build_fallback_batch,
    coerce_grade_payload,
    coerce_start_payload,
    normalize_sentence,
    sentences_equivalent,
    word_diff,
)


@pytest.mark.unit
class TestNormalize:
    def test_lowercases_and_strips(self):
        assert normalize_sentence("  Hello World  ") == "hello world"

    def test_strips_punctuation(self):
        assert normalize_sentence("Hello, world!") == "hello world"

    def test_collapses_whitespace(self):
        assert normalize_sentence("a   b\t\tc") == "a b c"

    def test_preserves_contractions(self):
        assert normalize_sentence("She doesn't like it.") == "she doesn't like it"

    def test_empty(self):
        assert normalize_sentence("") == ""
        assert normalize_sentence("   ") == ""

    def test_equivalent_ignores_trailing_period(self):
        assert sentences_equivalent("She goes home.", "she goes home")

    def test_not_equivalent_when_different(self):
        assert not sentences_equivalent("She goes home.", "She went home.")

    def test_empty_is_not_equivalent(self):
        assert not sentences_equivalent("", "")


@pytest.mark.unit
class TestWordDiff:
    def test_identical_all_same(self):
        diff = word_diff("She goes home.", "she goes home")
        assert all(t["status"] == "same" for t in diff)
        assert [t["token"] for t in diff] == ["she", "goes", "home"]

    def test_substitution(self):
        diff = word_diff("She goes home.", "She went home.")
        statuses = [(t["token"], t["status"]) for t in diff]
        assert ("goes", "delete") in statuses
        assert ("went", "insert") in statuses
        assert ("she", "same") in statuses
        assert ("home", "same") in statuses

    def test_extra_word_in_answer(self):
        diff = word_diff("I like coffee", "I really like coffee")
        statuses = [(t["token"], t["status"]) for t in diff]
        assert ("really", "insert") in statuses

    def test_missing_word_in_answer(self):
        diff = word_diff("I really like coffee", "I like coffee")
        statuses = [(t["token"], t["status"]) for t in diff]
        assert ("really", "delete") in statuses


@pytest.mark.unit
class TestCoerce:
    def test_coerce_start_payload_ok(self):
        out = coerce_start_payload({
            "items": [
                {"wrong": "She go home.", "reference": "She goes home.",
                 "error_type": "svA", "hint_ja": "三単現"},
            ]
        })
        assert out is not None and len(out) == 1
        assert out[0]["reference"] == "She goes home."

    def test_coerce_rejects_identical_wrong_and_reference(self):
        out = coerce_start_payload({
            "items": [
                {"wrong": "She goes home.", "reference": "She goes home.",
                 "error_type": "svA", "hint_ja": "x"},
            ]
        })
        assert out is None

    def test_coerce_returns_none_for_bad_shape(self):
        assert coerce_start_payload(None) is None
        assert coerce_start_payload({}) is None
        assert coerce_start_payload({"items": []}) is None

    def test_coerce_grade_ok(self):
        g = coerce_grade_payload({"is_correct": True, "explanation_ja": "良い"})
        assert g == {"is_correct": True, "explanation_ja": "良い"}

    def test_coerce_grade_missing_key(self):
        assert coerce_grade_payload({"explanation_ja": "x"}) is None


@pytest.mark.unit
class TestFallback:
    def test_fallback_has_items(self):
        items = build_fallback_batch("tense", "beginner", 5, seed=1)
        assert len(items) == 5
        for it in items:
            assert it["wrong"] and it["reference"]
            assert it["wrong"] != it["reference"]

    def test_fallback_wraps_when_small(self):
        items = build_fallback_batch("tense", "advanced", 10, seed=1)
        assert len(items) == 10
