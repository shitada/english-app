"""Unit tests for shadowing scoring helpers and DAL."""

from __future__ import annotations

import pytest

from app.dal import shadowing as dal
from app.routers.shadowing import (
    compute_accuracy,
    compute_timing_score,
    combined_score,
    _validate_sentence_payload,
)


@pytest.mark.unit
class TestShadowingScoring:

    def test_accuracy_full_match_ignores_case_and_punct(self):
        expected = "I went to the store yesterday."
        transcript = "i WENT to the Store, yesterday!"
        assert compute_accuracy(expected, transcript) == 100.0

    def test_accuracy_partial(self):
        expected = "I went to the store yesterday"  # 6 words
        transcript = "i went store"  # missing 'to', 'the', 'yesterday'
        # 3 / 6 = 50.0
        assert compute_accuracy(expected, transcript) == 50.0

    def test_accuracy_empty_expected(self):
        assert compute_accuracy("", "anything") == 0.0

    def test_accuracy_empty_transcript(self):
        assert compute_accuracy("hello world", "") == 0.0

    def test_timing_score_perfect(self):
        assert compute_timing_score(4.0, 4.0) == 100.0

    def test_timing_score_50_percent_off(self):
        # actual = 6, target = 4 -> diff = 2, 2/4*100 = 50% -> score = 50
        assert compute_timing_score(6.0, 4.0) == 50.0

    def test_timing_score_clamped_to_zero(self):
        # actual = 100, target = 4 -> diff overwhelmingly > 100%
        assert compute_timing_score(100.0, 4.0) == 0.0

    def test_timing_score_zero_target(self):
        assert compute_timing_score(3.0, 0.0) == 0.0

    def test_combined_score_average(self):
        assert combined_score(80, 60) == 70.0


@pytest.mark.unit
class TestSentencePayloadValidation:

    def test_accepts_valid_payload(self):
        out = _validate_sentence_payload({
            "sentence": "I will pick up some groceries on the way home tonight.",
            "focus_tip": "Link 'pick up'.",
            "target_seconds": 4.5,
        })
        assert out is not None
        assert out["sentence"].startswith("I will")
        assert out["target_seconds"] == 4.5

    def test_rejects_too_short_sentence(self):
        assert _validate_sentence_payload({
            "sentence": "Too short.",
            "focus_tip": "x",
            "target_seconds": 3.0,
        }) is None

    def test_rejects_non_dict(self):
        assert _validate_sentence_payload(["not", "a", "dict"]) is None

    def test_clamps_invalid_target_seconds(self):
        out = _validate_sentence_payload({
            "sentence": "I usually grab a coffee on my way to work in the morning.",
            "focus_tip": "",
            "target_seconds": 999,
        })
        assert out is not None
        assert 2.0 <= out["target_seconds"] <= 8.0
        assert out["focus_tip"]  # backfilled


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_and_count_attempts(test_db):
    new_id = await dal.record_attempt(
        test_db,
        sentence="Hello world from shadowing.",
        transcript="hello world from shadowing",
        accuracy=95.0,
        timing_score=80.0,
        duration_ms=4200,
    )
    assert new_id > 0
    assert await dal.count_attempts(test_db) == 1

    rows = await dal.list_recent(test_db, limit=5)
    assert len(rows) == 1
    assert rows[0]["sentence"].startswith("Hello world")
    assert rows[0]["accuracy"] == 95.0
    assert rows[0]["duration_ms"] == 4200
