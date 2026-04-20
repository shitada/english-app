"""Unit tests for the Confusable Pairs DAL + router helpers."""

from __future__ import annotations

import pytest

from app.dal import confusable_pairs as dal
from app.routers.confusable_pairs import (
    VALID_PAIR_KEYS,
    build_fallback_session,
    coerce_session_payload,
)


@pytest.mark.unit
def test_fallback_session_returns_requested_count():
    items = build_fallback_session(8)
    assert len(items) == 8
    for it in items:
        assert "____" in it["sentence_with_blank"]
        assert len(it["options"]) == 2
        assert it["correct_word"] in it["options"]
        assert it["pair_key"] in VALID_PAIR_KEYS


@pytest.mark.unit
def test_fallback_session_filter_by_pair_key():
    items = build_fallback_session(4, pair_key="affect_effect")
    assert len(items) == 4
    assert all(it["pair_key"] == "affect_effect" for it in items)


@pytest.mark.unit
def test_coerce_session_payload_accepts_valid():
    raw = {
        "items": [
            {
                "id": "x1",
                "sentence_with_blank": "Can I ____ your pen?",
                "options": ["borrow", "lend"],
                "correct_word": "borrow",
                "pair_key": "borrow_lend",
                "difficulty": "easy",
                "explanation": "borrow = take temporarily",
                "example_sentence": "Can I borrow your pen?",
            }
        ]
    }
    out = coerce_session_payload(raw)
    assert out is not None and len(out) == 1
    assert out[0]["correct_word"] == "borrow"


@pytest.mark.unit
def test_coerce_session_payload_rejects_garbage():
    assert coerce_session_payload(None) is None
    assert coerce_session_payload({"items": []}) is None
    assert coerce_session_payload({"items": [{"foo": "bar"}]}) is None
    # missing blank marker
    bad = {
        "items": [
            {
                "sentence_with_blank": "No blank here.",
                "options": ["a", "b"],
                "correct_word": "a",
                "pair_key": "borrow_lend",
            }
        ]
    }
    assert coerce_session_payload(bad) is None
    # wrong option count
    bad2 = {
        "items": [
            {
                "sentence_with_blank": "Fill ____ this.",
                "options": ["a", "b", "c"],
                "correct_word": "a",
                "pair_key": "borrow_lend",
            }
        ]
    }
    assert coerce_session_payload(bad2) is None


@pytest.mark.asyncio
@pytest.mark.unit
async def test_dal_create_and_get_session_roundtrip(test_db):
    items = build_fallback_session(3)
    await dal.create_session(
        test_db,
        session_id="cp-test-1",
        difficulty="medium",
        pair_filter=None,
        items=items,
    )
    sess = await dal.get_session(test_db, "cp-test-1")
    assert sess is not None
    assert sess["item_count"] == 3
    assert len(sess["items"]) == 3
    assert sess["items"][0]["sentence_with_blank"] == items[0]["sentence_with_blank"]


@pytest.mark.asyncio
@pytest.mark.unit
async def test_dal_record_and_summary(test_db):
    items = build_fallback_session(3)
    await dal.create_session(
        test_db,
        session_id="cp-test-2",
        difficulty="medium",
        pair_filter=None,
        items=items,
    )
    # Record 2 correct and 1 incorrect, two different pairs.
    await dal.record_attempt(
        test_db,
        session_id="cp-test-2",
        item_id="a",
        pair_key="affect_effect",
        choice="affect",
        correct_word="affect",
        is_correct=True,
    )
    await dal.record_attempt(
        test_db,
        session_id="cp-test-2",
        item_id="b",
        pair_key="affect_effect",
        choice="effect",
        correct_word="affect",
        is_correct=False,
    )
    await dal.record_attempt(
        test_db,
        session_id="cp-test-2",
        item_id="c",
        pair_key="borrow_lend",
        choice="borrow",
        correct_word="borrow",
        is_correct=True,
    )
    summary = await dal.get_session_summary(test_db, "cp-test-2")
    assert summary["total"] == 3
    assert summary["correct"] == 2
    assert summary["per_pair_accuracy"]["affect_effect"] == pytest.approx(0.5)
    assert summary["per_pair_accuracy"]["borrow_lend"] == 1.0
    assert summary["weakest_pair"] == "affect_effect"


@pytest.mark.asyncio
@pytest.mark.unit
async def test_dal_summary_no_attempts(test_db):
    await dal.create_session(
        test_db,
        session_id="cp-test-empty",
        difficulty="medium",
        pair_filter=None,
        items=build_fallback_session(2),
    )
    summary = await dal.get_session_summary(test_db, "cp-test-empty")
    assert summary["total"] == 0
    assert summary["weakest_pair"] is None
    assert summary["per_pair_accuracy"] == {}


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_pair_accuracy_aggregate(test_db):
    await dal.create_session(
        test_db,
        session_id="cp-agg",
        difficulty="medium",
        pair_filter=None,
        items=build_fallback_session(1),
    )
    await dal.record_attempt(
        test_db,
        session_id="cp-agg",
        item_id="x",
        pair_key="make_do",
        choice="do",
        correct_word="do",
        is_correct=True,
    )
    agg = await dal.get_pair_accuracy(test_db, days=30)
    assert "make_do" in agg
    assert agg["make_do"]["total"] == 1
    assert agg["make_do"]["accuracy"] == 1.0
