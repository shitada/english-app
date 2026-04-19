"""Unit tests for thought-group LLM coercion + fallback helpers."""

from __future__ import annotations

import pytest

from app.routers.listening import (
    _coerce_thought_group,
    _fallback_thought_group,
    _FALLBACK_THOUGHT_GROUPS,
)


@pytest.mark.unit
def test_coerce_valid_payload():
    sentence = (
        "When the meeting finally ended everyone stood up gathered their "
        "belongings and quietly left the conference room today."
    )
    words = sentence.split()
    raw = {
        "sentence": sentence,
        "words": words,
        "pause_indices": [5, 9, 13],
        "rules": ["after subordinate clause", "between coordinated verbs", "between coordinated verbs"],
    }
    out = _coerce_thought_group(raw)
    assert out is not None
    assert 15 <= len(out["words"]) <= 25
    assert out["pause_indices"] == [5, 9, 13]
    for i in out["pause_indices"]:
        assert 1 <= i <= len(out["words"]) - 1
    assert len(out["rules"]) == len(out["pause_indices"])


@pytest.mark.unit
def test_coerce_dedupes_and_sorts_indices():
    sentence = " ".join(["word"] * 18)
    raw = {
        "sentence": sentence,
        "pause_indices": [9, 5, 5, 13, 9],
        "rules": ["a", "b", "c"],
    }
    out = _coerce_thought_group(raw)
    assert out is not None
    assert out["pause_indices"] == [5, 9, 13]


@pytest.mark.unit
def test_coerce_rejects_too_short_sentence():
    raw = {
        "sentence": "Too short for a thought group drill.",
        "pause_indices": [2, 4],
        "rules": ["a", "b"],
    }
    assert _coerce_thought_group(raw) is None


@pytest.mark.unit
def test_coerce_rejects_too_long_sentence():
    raw = {
        "sentence": " ".join(["w"] * 30),
        "pause_indices": [5, 10],
        "rules": ["a", "b"],
    }
    assert _coerce_thought_group(raw) is None


@pytest.mark.unit
def test_coerce_rejects_out_of_range_indices():
    sentence = " ".join(["w"] * 18)
    raw = {
        "sentence": sentence,
        "pause_indices": [0, 18, 25],  # all invalid (need 1..n-1)
        "rules": ["a", "b", "c"],
    }
    assert _coerce_thought_group(raw) is None


@pytest.mark.unit
def test_coerce_rejects_too_few_indices():
    sentence = " ".join(["w"] * 18)
    raw = {
        "sentence": sentence,
        "pause_indices": [5],
        "rules": ["a"],
    }
    assert _coerce_thought_group(raw) is None


@pytest.mark.unit
def test_coerce_pads_missing_rules():
    sentence = " ".join(["w"] * 18)
    raw = {
        "sentence": sentence,
        "pause_indices": [5, 10, 14],
        "rules": [],
    }
    out = _coerce_thought_group(raw)
    assert out is not None
    assert len(out["rules"]) == 3
    assert all(r for r in out["rules"])


@pytest.mark.unit
def test_coerce_handles_non_dict_input():
    assert _coerce_thought_group("not a dict") is None
    assert _coerce_thought_group(None) is None
    assert _coerce_thought_group([1, 2, 3]) is None


@pytest.mark.unit
def test_fallback_bank_is_valid():
    for entry in _FALLBACK_THOUGHT_GROUPS:
        words = entry["sentence"].split()
        assert 15 <= len(words) <= 25, f"sentence length {len(words)} out of range"
        for i in entry["pause_indices"]:
            assert 1 <= i <= len(words) - 1
        assert len(entry["rules"]) == len(entry["pause_indices"])


@pytest.mark.unit
def test_fallback_returns_well_formed_payload():
    out = _fallback_thought_group()
    assert out["sentence"]
    assert isinstance(out["words"], list)
    assert 15 <= len(out["words"]) <= 25
    assert 2 <= len(out["pause_indices"]) <= 4
    assert len(out["rules"]) == len(out["pause_indices"])
