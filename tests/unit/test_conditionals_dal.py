"""Unit tests for the Conditional Transform drill DAL + helpers."""

from __future__ import annotations

import pytest

from app.dal import conditionals as dal
from app.routers.conditionals import (
    VALID_LEVELS,
    VALID_TYPES,
    _FALLBACK_BANK,
    _coerce_grade_payload,
    _coerce_prompt_payload,
    _pick_fallback,
    heuristic_detect_type,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_heuristic_detect_type_classifies_common_forms():
    assert heuristic_detect_type(
        "If you heat water, it boils."
    ) == 0
    assert heuristic_detect_type(
        "If it rains, I will stay home."
    ) == 1
    assert heuristic_detect_type(
        "If I had more time, I would travel."
    ) == 2
    assert heuristic_detect_type(
        "If I had studied, I would have passed."
    ) == 3
    # No if-clause → None
    assert heuristic_detect_type("I will call you tomorrow.") is None
    assert heuristic_detect_type("") is None


@pytest.mark.unit
def test_fallback_bank_covers_all_types_and_levels():
    for t in VALID_TYPES:
        # at least one level must exist for each type
        found = any((t, lvl) in _FALLBACK_BANK for lvl in VALID_LEVELS)
        assert found, f"Missing fallback for type {t}"


@pytest.mark.unit
def test_pick_fallback_returns_valid_entry():
    for t in VALID_TYPES:
        for lvl in VALID_LEVELS:
            entry = _pick_fallback(t, lvl)
            assert entry["base_sentence"]
            assert "hint" in entry


@pytest.mark.unit
def test_coerce_prompt_payload_accepts_and_rejects():
    assert _coerce_prompt_payload(None) is None
    assert _coerce_prompt_payload({}) is None
    assert _coerce_prompt_payload({"hint": "just a hint"}) is None
    out = _coerce_prompt_payload({
        "base_sentence": "I don't know her number, so I can't call.",
        "hint": "Rewrite as Type-2.",
    })
    assert out is not None
    assert out["base_sentence"].startswith("I don't")
    assert out["hint"] == "Rewrite as Type-2."


@pytest.mark.unit
def test_coerce_grade_payload_clips_and_validates():
    out = _coerce_grade_payload({
        "correct": True,
        "score": 250,
        "model_answer": "If I had more time, I would travel.",
        "feedback": "Good.",
        "detected_type": 2,
        "issues": ["", "tense", "x" * 500],
    })
    assert out is not None
    assert out["score"] == 100
    assert out["detected_type"] == 2
    assert out["correct"] is True
    assert "tense" in out["issues"]
    # string-as-int detected_type coerces
    out2 = _coerce_grade_payload({"correct": False, "score": 10, "detected_type": "3"})
    assert out2 is not None
    assert out2["detected_type"] == 3
    # invalid detected_type → None
    out3 = _coerce_grade_payload({"correct": False, "score": 10, "detected_type": 7})
    assert out3 is not None
    assert out3["detected_type"] is None


@pytest.mark.unit
def test_coerce_grade_payload_rejects_non_dict():
    assert _coerce_grade_payload(None) is None
    assert _coerce_grade_payload("nope") is None
    assert _coerce_grade_payload([1, 2, 3]) is None


# ---------------------------------------------------------------------------
# DAL (requires test_db)
# ---------------------------------------------------------------------------

@pytest.mark.unit
@pytest.mark.asyncio
async def test_save_and_get_prompt_roundtrip(test_db):
    await dal.save_prompt(
        test_db,
        prompt_id="cond-abc",
        target_type=2,
        level="intermediate",
        base_sentence="I don't have a car, so I don't drive.",
        hint="Rewrite as Type-2.",
    )
    got = await dal.get_prompt(test_db, "cond-abc")
    assert got is not None
    assert got["target_type"] == 2
    assert got["level"] == "intermediate"
    assert "I don't have a car" in got["base_sentence"]

    missing = await dal.get_prompt(test_db, "nope")
    assert missing is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_save_attempt_persists_and_clips_score(test_db):
    await dal.save_prompt(
        test_db, prompt_id="cond-1", target_type=1, level="beginner",
        base_sentence="Maybe it will rain.", hint="Rewrite as Type-1.",
    )
    row_id = await dal.save_attempt(
        test_db,
        user_id="local",
        prompt_id="cond-1",
        target_type=1,
        detected_type=1,
        base_sentence="Maybe it will rain.",
        user_answer="If it rains, I will stay home.",
        model_answer="If it rains, I will stay home.",
        feedback="Good.",
        issues=["", "  "],  # both filtered
        correct=True,
        score=500,
    )
    assert row_id > 0
    recent = await dal.recent_attempts(test_db, user_id="local", limit=10)
    assert len(recent) == 1
    r = recent[0]
    assert r["target_type"] == 1
    assert r["detected_type"] == 1
    assert r["correct"] is True
    assert r["score"] == 100
    assert r["issues"] == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_recent_attempts_scoped_by_user(test_db):
    await dal.save_prompt(
        test_db, prompt_id="cond-u", target_type=2, level="intermediate",
        base_sentence="x", hint="",
    )
    await dal.save_attempt(
        test_db, user_id="alice", prompt_id="cond-u", target_type=2,
        detected_type=2, base_sentence="x", user_answer="a",
        model_answer="m", feedback="f", issues=["iss"], correct=True, score=90,
    )
    await dal.save_attempt(
        test_db, user_id="bob", prompt_id="cond-u", target_type=2,
        detected_type=None, base_sentence="x", user_answer="b",
        model_answer="", feedback="", issues=[], correct=False, score=20,
    )
    alice = await dal.recent_attempts(test_db, user_id="alice")
    bob = await dal.recent_attempts(test_db, user_id="bob")
    assert len(alice) == 1 and alice[0]["user_answer"] == "a"
    assert alice[0]["issues"] == ["iss"]
    assert len(bob) == 1 and bob[0]["user_answer"] == "b"
    assert bob[0]["detected_type"] is None
