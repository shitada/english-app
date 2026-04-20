"""Unit tests for the Tense Contrast Drill DAL + helpers."""

from __future__ import annotations

import pytest

from app.dal import tense_contrast as dal
from app.routers.tense_contrast import (
    VALID_TENSES,
    build_fallback_session,
    coerce_session_payload,
    is_answer_correct,
    normalize_answer,
)


@pytest.mark.unit
def test_normalize_answer_lowercases_and_strips():
    assert normalize_answer("  Have Lived. ") == "have lived"
    assert normalize_answer("went,") == "went"
    assert normalize_answer("has  been   working") == "has been working"
    assert normalize_answer("") == ""


@pytest.mark.unit
def test_is_answer_correct_matches_any_form():
    forms = ["have lived", "have been living"]
    assert is_answer_correct("Have Lived.", forms) is True
    assert is_answer_correct("have been living", forms) is True
    assert is_answer_correct("lived", forms) is False
    assert is_answer_correct("", forms) is False


@pytest.mark.unit
def test_build_fallback_session_returns_requested_count():
    items = build_fallback_session(count=8, seed=42)
    assert len(items) == 8
    for it in items:
        assert it["tense_label"] in VALID_TENSES
        assert it["correct_form"]
        assert "____" in it["sentence_with_blank"]


@pytest.mark.unit
def test_coerce_session_payload_rejects_malformed():
    assert coerce_session_payload(None) is None
    assert coerce_session_payload({}) is None
    assert coerce_session_payload({"items": []}) is None
    assert coerce_session_payload(
        {"items": [{"sentence_with_blank": "x", "correct_form": ["y"]}]}
    ) is None  # missing tense_label / verb_lemma


@pytest.mark.unit
def test_coerce_session_payload_accepts_valid():
    raw = {
        "items": [
            {
                "id": "t1",
                "sentence_with_blank": "I ____ it yesterday.",
                "verb_lemma": "see",
                "correct_form": ["saw"],
                "tense_label": "past_simple",
                "cue": "yesterday",
                "explanation": "past simple because of 'yesterday'",
            }
        ]
    }
    coerced = coerce_session_payload(raw)
    assert coerced is not None
    assert len(coerced) == 1
    assert coerced[0]["tense_label"] == "past_simple"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_attempts_and_get_stats_mixed_tenses(test_db):
    attempts = [
        {"item_id": "p01", "tense_label": "past_simple",
         "user_answer": "went", "correct": True, "elapsed_ms": 1200},
        {"item_id": "p02", "tense_label": "past_simple",
         "user_answer": "goed", "correct": False, "elapsed_ms": 2200},
        {"item_id": "pp01", "tense_label": "present_perfect",
         "user_answer": "have lived", "correct": True, "elapsed_ms": 1800},
        {"item_id": "ppc01", "tense_label": "present_perfect_continuous",
         "user_answer": "have been studying", "correct": True, "elapsed_ms": 2600},
    ]
    n = await dal.create_attempts(
        test_db, session_id="sess-a", attempts=attempts
    )
    assert n == 4

    stats = await dal.get_stats(test_db, days=30)
    assert stats["total"] == 4
    assert stats["correct"] == 3
    assert abs(stats["overall_accuracy"] - 0.75) < 1e-6
    assert stats["by_tense"]["past_simple"]["total"] == 2
    assert stats["by_tense"]["past_simple"]["correct"] == 1
    assert stats["by_tense"]["past_simple"]["accuracy"] == 0.5
    assert stats["by_tense"]["present_perfect"]["total"] == 1
    assert stats["by_tense"]["present_perfect"]["accuracy"] == 1.0
    assert stats["by_tense"]["present_perfect_continuous"]["total"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_stats_30_day_filter_excludes_old_rows(test_db):
    # Insert a recent row
    await dal.create_attempts(
        test_db,
        session_id="sess-new",
        attempts=[{
            "item_id": "p01", "tense_label": "past_simple",
            "user_answer": "went", "correct": True, "elapsed_ms": 1000,
        }],
    )
    # Insert an old row bypassing the DAL default timestamp
    await test_db.execute(
        """INSERT INTO tense_contrast_attempts
             (created_at, session_id, item_id, tense_label,
              user_answer, correct, elapsed_ms)
           VALUES (datetime('now', '-60 days'),
                   'sess-old', 'p02', 'past_simple', 'goed', 0, 1000)""",
    )
    await test_db.commit()

    stats = await dal.get_stats(test_db, days=30)
    assert stats["total"] == 1
    assert stats["correct"] == 1
    assert stats["by_tense"]["past_simple"]["total"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_attempts_empty_is_noop(test_db):
    n = await dal.create_attempts(test_db, session_id="x", attempts=[])
    assert n == 0
    stats = await dal.get_stats(test_db, days=30)
    assert stats["total"] == 0
