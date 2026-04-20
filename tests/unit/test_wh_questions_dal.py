"""Unit tests for the WH-Question Formation drill DAL + helpers."""

from __future__ import annotations

import pytest

from app.dal import wh_questions as dal
from app.routers.wh_questions import (
    VALID_WH,
    build_fallback_batch,
    coerce_grade_payload,
    coerce_start_payload,
    heuristic_grade,
)


@pytest.mark.unit
def test_build_fallback_batch_returns_requested_count():
    items = build_fallback_batch(count=5, seed=42)
    assert len(items) == 5
    for it in items:
        assert it["target_wh"] in VALID_WH
        assert it["answer_sentence"]
        assert it["id"]


@pytest.mark.unit
def test_coerce_start_payload_rejects_malformed():
    assert coerce_start_payload(None) is None
    assert coerce_start_payload({}) is None
    assert coerce_start_payload({"items": []}) is None
    assert coerce_start_payload(
        {"items": [{"answer_sentence": "x", "target_wh": "bogus"}]}
    ) is None  # invalid wh word


@pytest.mark.unit
def test_coerce_start_payload_accepts_valid():
    raw = {
        "items": [
            {
                "id": "w1",
                "answer_sentence": "She left at 7 a.m. because she had a meeting.",
                "target_wh": "WHY",
                "hint": "Ask about the reason.",
            }
        ]
    }
    coerced = coerce_start_payload(raw)
    assert coerced is not None
    assert len(coerced) == 1
    assert coerced[0]["target_wh"] == "why"


@pytest.mark.unit
def test_coerce_grade_payload_requires_booleans():
    assert coerce_grade_payload(None) is None
    assert coerce_grade_payload({}) is None
    assert coerce_grade_payload({
        "correctness": True,
        "wh_word_matches": True,
        # missing grammar_ok
    }) is None
    good = coerce_grade_payload({
        "correctness": True,
        "wh_word_matches": True,
        "grammar_ok": True,
        "feedback": "nice",
        "corrected": "Why did she leave?",
    })
    assert good is not None
    assert good["correctness"] is True
    assert good["feedback"] == "nice"


@pytest.mark.unit
def test_heuristic_grade_detects_wrong_wh_word():
    res = heuristic_grade(
        "She left at 7 a.m. because she had a meeting.",
        "why",
        "Where did she go?",
    )
    assert res["wh_word_matches"] is False
    assert res["correctness"] is False


@pytest.mark.unit
def test_heuristic_grade_accepts_well_formed_question():
    res = heuristic_grade(
        "She left at 7 a.m. because she had a meeting.",
        "why",
        "Why did she leave at 7 a.m.?",
    )
    assert res["wh_word_matches"] is True
    assert res["grammar_ok"] is True
    assert res["correctness"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_and_get_recent_stats(test_db):
    # Insert attempts for several wh-words
    await dal.record_attempt(
        test_db, user_id="u1", target_wh="why",
        is_correct=True, grammar_ok=True,
    )
    await dal.record_attempt(
        test_db, user_id="u1", target_wh="why",
        is_correct=False, grammar_ok=True,
    )
    await dal.record_attempt(
        test_db, user_id="u1", target_wh="where",
        is_correct=True, grammar_ok=True,
    )
    # Different user shouldn't leak into stats
    await dal.record_attempt(
        test_db, user_id="u2", target_wh="why",
        is_correct=True, grammar_ok=True,
    )

    stats = await dal.get_recent_stats(test_db, user_id="u1", limit=30)
    assert stats["total"] == 3
    assert stats["correct"] == 2
    assert abs(stats["overall_accuracy"] - (2 / 3)) < 1e-6
    assert stats["by_wh"]["why"]["total"] == 2
    assert stats["by_wh"]["why"]["correct"] == 1
    assert stats["by_wh"]["why"]["accuracy"] == 0.5
    assert stats["by_wh"]["where"]["total"] == 1
    assert stats["by_wh"]["where"]["accuracy"] == 1.0
    # Untouched wh-words still present with zero totals
    assert stats["by_wh"]["who"]["total"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_recent_stats_respects_limit(test_db):
    for _ in range(5):
        await dal.record_attempt(
            test_db, user_id="u1", target_wh="what",
            is_correct=True, grammar_ok=True,
        )
    for _ in range(3):
        await dal.record_attempt(
            test_db, user_id="u1", target_wh="who",
            is_correct=False, grammar_ok=False,
        )
    # Limit to last 3 — should be all "who" attempts (most recent)
    stats = await dal.get_recent_stats(test_db, user_id="u1", limit=3)
    assert stats["total"] == 3
    assert stats["correct"] == 0
    assert stats["by_wh"]["who"]["total"] == 3
    assert stats["by_wh"]["what"]["total"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_returns_row_id(test_db):
    rid = await dal.record_attempt(
        test_db, user_id="u1", target_wh="how",
        is_correct=True, grammar_ok=True,
    )
    assert rid > 0
