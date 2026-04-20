"""Unit tests for Sentence Stress Spotlight DAL + scoring helpers."""

from __future__ import annotations

import pytest

from app.dal import stress_spotlight as dal
from app.routers.stress_spotlight import (
    build_emphasis_audio,
    coerce_payload,
    compute_precision_recall,
    split_words,
)


@pytest.mark.unit
class TestPrecisionRecall:
    def test_perfect_match(self):
        assert compute_precision_recall([0, 2, 4], [0, 2, 4]) == (100.0, 100.0, 100.0)

    def test_partial(self):
        # picked 2 of 3 expected, with 0 wrong picks
        # precision = 2/2 = 100, recall = 2/3 ≈ 66.7, f1 = 80.0
        p, r, f = compute_precision_recall([0, 2, 4], [0, 2])
        assert p == 100.0
        assert r == 66.7
        assert f == 80.0

    def test_extra_picks_lower_precision(self):
        # picked 3, only 1 correct
        # precision = 1/3 = 33.3, recall = 1/2 = 50.0, f1 = 40.0
        p, r, f = compute_precision_recall([0, 2], [0, 5, 7])
        assert p == 33.3
        assert r == 50.0
        assert f == 40.0

    def test_no_picks_with_expected(self):
        assert compute_precision_recall([1, 3], []) == (100.0, 0.0, 0.0)

    def test_picks_with_no_expected(self):
        assert compute_precision_recall([], [1, 3]) == (0.0, 100.0, 0.0)

    def test_empty_both(self):
        assert compute_precision_recall([], []) == (100.0, 100.0, 100.0)

    def test_no_overlap_zero_f1(self):
        p, r, f = compute_precision_recall([0, 1], [4, 5])
        assert p == 0.0
        assert r == 0.0
        assert f == 0.0


@pytest.mark.unit
class TestCoercePayload:
    def test_accepts_valid(self):
        out = coerce_payload({
            "sentence": "I really need a coffee before the meeting starts.",
            "words": ["I", "really", "need", "a", "coffee", "before", "the", "meeting", "starts."],
            "stressed_indices": [1, 2, 4, 7, 8],
            "rationale": "Content words carry the beat.",
        })
        assert out is not None
        assert out["stressed_indices"] == [1, 2, 4, 7, 8]
        assert len(out["words"]) == 9

    def test_rejects_non_dict(self):
        assert coerce_payload(["not", "a", "dict"]) is None
        assert coerce_payload(None) is None
        assert coerce_payload("string") is None

    def test_rejects_too_short_sentence(self):
        assert coerce_payload({
            "sentence": "Too short here.",
            "stressed_indices": [0, 1],
            "rationale": "x",
        }) is None

    def test_rejects_too_long_sentence(self):
        words = ["word"] * 20
        assert coerce_payload({
            "sentence": " ".join(words),
            "words": words,
            "stressed_indices": [0, 1],
            "rationale": "x",
        }) is None

    def test_rejects_indices_out_of_range(self):
        # All indices invalid -> empty list -> < 2 -> None
        assert coerce_payload({
            "sentence": "I really need a coffee before the meeting starts.",
            "stressed_indices": [99, 100],
            "rationale": "x",
        }) is None

    def test_dedupes_and_sorts_indices(self):
        out = coerce_payload({
            "sentence": "I really need a coffee before the meeting starts.",
            "stressed_indices": [4, 1, 4, 2],
            "rationale": "x",
        })
        assert out is not None
        assert out["stressed_indices"] == [1, 2, 4]

    def test_backfills_rationale(self):
        out = coerce_payload({
            "sentence": "I really need a coffee before the meeting starts.",
            "stressed_indices": [1, 2, 4],
            "rationale": "",
        })
        assert out is not None
        assert out["rationale"]


@pytest.mark.unit
class TestBuildEmphasisAudio:
    def test_capitalization_fallback(self):
        words = ["I", "love", "coffee", "in", "the", "morning."]
        ssml, fallback, indices, emph = build_emphasis_audio(words, [1, 2, 5])
        assert indices == [1, 2, 5]
        # Capitalized words should appear in fallback (preserving punctuation)
        assert "LOVE" in fallback
        assert "COFFEE" in fallback
        assert "MORNING." in fallback
        # Non-emphasized stay lowercase
        assert " I " in f" {fallback} "  # I is index 0, unchanged
        assert " in " in fallback

    def test_ssml_wraps_emphasized_words(self):
        words = ["She", "ran", "fast"]
        ssml, _, _, emph = build_emphasis_audio(words, [1])
        assert ssml.startswith("<speak>")
        assert ssml.endswith("</speak>")
        assert '<emphasis level="strong">ran</emphasis>' in ssml
        assert emph == ["ran"]

    def test_invalid_indices_dropped(self):
        words = ["a", "b", "c"]
        ssml, fallback, indices, emph = build_emphasis_audio(words, [0, 99, -1, "bad"])  # type: ignore[list-item]
        assert indices == [0]

    def test_empty_emphasis(self):
        words = ["one", "two", "three"]
        ssml, fallback, indices, emph = build_emphasis_audio(words, [])
        assert indices == []
        assert emph == []
        assert "one two three" in fallback


@pytest.mark.unit
def test_split_words_handles_whitespace():
    assert split_words("  hello   world ") == ["hello", "world"]
    assert split_words("") == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_and_list_recent(test_db):
    new_id = await dal.record_attempt(
        test_db,
        sentence="I really need a coffee before the meeting starts.",
        words=["I", "really", "need", "a", "coffee", "before", "the", "meeting", "starts."],
        expected_indices=[1, 2, 4, 7, 8],
        user_indices=[1, 4, 7],
        precision=100.0,
        recall=60.0,
        f1=75.0,
        difficulty="intermediate",
    )
    assert new_id > 0
    assert await dal.count_attempts(test_db) == 1

    rows = await dal.list_recent(test_db, limit=5)
    assert len(rows) == 1
    r = rows[0]
    assert r["sentence"].startswith("I really")
    assert r["words"][0] == "I"
    assert r["expected_indices"] == [1, 2, 4, 7, 8]
    assert r["user_indices"] == [1, 4, 7]
    assert r["precision_score"] == 100.0
    assert r["f1_score"] == 75.0
    assert r["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_list_recent_orders_newest_first_and_limits(test_db):
    for i in range(12):
        await dal.record_attempt(
            test_db,
            sentence=f"Sentence number {i} with several words.",
            words=["Sentence", "number", str(i), "with", "several", "words."],
            expected_indices=[0, 5],
            user_indices=[0],
            precision=100.0,
            recall=50.0,
            f1=66.7,
        )
    rows = await dal.list_recent(test_db, limit=10)
    assert len(rows) == 10
    # Most recent first: highest id appears first
    ids = [r["id"] for r in rows]
    assert ids == sorted(ids, reverse=True)
