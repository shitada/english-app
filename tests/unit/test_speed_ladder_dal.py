"""Unit tests for the Speed Ladder DAL and helper functions."""

from __future__ import annotations

import pytest

from app.dal import speed_ladder as dal
from app.routers.speed_ladder import (
    SPEEDS,
    _coerce_llm_payload,
    _fallback_payload,
    _FALLBACK_ITEMS,
)


@pytest.mark.unit
def test_speeds_are_three_distinct_values():
    assert SPEEDS == [0.8, 1.0, 1.25]
    assert len(set(SPEEDS)) == 3


@pytest.mark.unit
def test_fallback_items_have_three_questions_with_four_choices():
    assert len(_FALLBACK_ITEMS) >= 1
    for item in _FALLBACK_ITEMS:
        assert "passage_text" in item and isinstance(item["passage_text"], str)
        assert len(item["questions"]) == 3
        for q in item["questions"]:
            assert len(q["choices"]) == 4
            assert 0 <= q["correct_index"] < 4


@pytest.mark.unit
def test_fallback_payload_attaches_distinct_speeds():
    payload = _fallback_payload()
    assert payload["session_id"]
    assert len(payload["questions"]) == 3
    speeds = [q["speed"] for q in payload["questions"]]
    assert speeds == SPEEDS
    # IDs should be unique per question.
    ids = [q["id"] for q in payload["questions"]]
    assert len(set(ids)) == 3


@pytest.mark.unit
def test_coerce_llm_payload_accepts_valid_shape():
    raw = {
        "passage_text": "A" * 60,
        "questions": [
            {"prompt": "Q1?", "choices": ["a", "b", "c", "d"], "correct_index": 0,
             "explanation": "e"},
            {"prompt": "Q2?", "choices": ["a", "b", "c", "d"], "correct_index": 2,
             "explanation": "e"},
            {"prompt": "Q3?", "choices": ["a", "b", "c", "d"], "correct_index": 1,
             "explanation": "e"},
        ],
    }
    out = _coerce_llm_payload(raw)
    assert out is not None
    assert len(out["questions"]) == 3


@pytest.mark.unit
def test_coerce_llm_payload_rejects_wrong_question_count():
    raw = {
        "passage_text": "A" * 60,
        "questions": [
            {"prompt": "Q1?", "choices": ["a", "b", "c", "d"], "correct_index": 0},
        ],
    }
    assert _coerce_llm_payload(raw) is None


@pytest.mark.unit
def test_coerce_llm_payload_rejects_wrong_choice_count():
    raw = {
        "passage_text": "A" * 60,
        "questions": [
            {"prompt": "Q?", "choices": ["a", "b", "c"], "correct_index": 0}
            for _ in range(3)
        ],
    }
    assert _coerce_llm_payload(raw) is None


@pytest.mark.unit
def test_coerce_llm_payload_rejects_out_of_range_correct_index():
    raw = {
        "passage_text": "A" * 60,
        "questions": [
            {"prompt": "Q?", "choices": ["a", "b", "c", "d"], "correct_index": 9}
            for _ in range(3)
        ],
    }
    assert _coerce_llm_payload(raw) is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_persists_row(test_db):
    rid = await dal.record_attempt(
        test_db, session_id="sess-a", speed=0.8, correct=True
    )
    assert rid > 0
    rows = await test_db.execute_fetchall(
        "SELECT * FROM speed_ladder_attempts WHERE id = ?", (rid,)
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["session_id"] == "sess-a"
    assert float(row["speed"]) == 0.8
    assert row["correct"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_session_history_aggregates_per_speed(test_db):
    # Session A: 0.8 correct, 1.0 wrong, 1.25 correct
    await dal.record_attempt(test_db, session_id="A", speed=0.8, correct=True)
    await dal.record_attempt(test_db, session_id="A", speed=1.0, correct=False)
    await dal.record_attempt(test_db, session_id="A", speed=1.25, correct=True)
    # Session B: 0.8 correct, 1.0 correct, 1.25 wrong
    await dal.record_attempt(test_db, session_id="B", speed=0.8, correct=True)
    await dal.record_attempt(test_db, session_id="B", speed=1.0, correct=True)
    await dal.record_attempt(test_db, session_id="B", speed=1.25, correct=False)

    history = await dal.get_session_history(test_db, limit=10)
    assert len(history) == 2
    by_id = {h["session_id"]: h for h in history}
    a = by_id["A"]
    assert a["total"] == 3
    assert a["correct"] == 2
    assert a["by_speed"]["0.8"]["accuracy"] == pytest.approx(1.0)
    assert a["by_speed"]["1"]["accuracy"] == pytest.approx(0.0)
    assert a["by_speed"]["1.25"]["accuracy"] == pytest.approx(1.0)
    b = by_id["B"]
    assert b["by_speed"]["1.25"]["accuracy"] == pytest.approx(0.0)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_overall_by_speed(test_db):
    for _ in range(2):
        await dal.record_attempt(test_db, session_id="A", speed=0.8, correct=True)
    await dal.record_attempt(test_db, session_id="A", speed=0.8, correct=False)
    await dal.record_attempt(test_db, session_id="A", speed=1.25, correct=False)

    agg = await dal.get_overall_by_speed(test_db)
    assert agg["0.8"]["total"] == 3
    assert agg["0.8"]["correct"] == 2
    assert agg["0.8"]["accuracy"] == pytest.approx(2 / 3)
    assert agg["1.25"]["total"] == 1
    assert agg["1.25"]["accuracy"] == pytest.approx(0.0)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_session_history_empty_when_no_rows(test_db):
    assert await dal.get_session_history(test_db) == []
    assert await dal.get_overall_by_speed(test_db) == {}
