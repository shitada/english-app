"""Unit tests for Elastic Sentence: validation, scoring, DAL."""

from __future__ import annotations

import pytest

from app.dal import elastic_sentence as dal
from app.routers.elastic_sentence import (
    _validate_chain,
    compute_accuracy,
    normalize_words,
    word_count,
    FALLBACK_BANK,
)


@pytest.mark.unit
class TestScoring:
    def test_normalize_words_lowercases_and_strips_punct(self):
        assert normalize_words("I'd like Coffee, please!") == ["i'd", "like", "coffee", "please"]

    def test_word_count(self):
        assert word_count("hello world") == 2
        assert word_count("") == 0

    def test_accuracy_full_match(self):
        assert compute_accuracy("I went to the store", "i WENT to, the store!") == 100.0

    def test_accuracy_partial(self):
        # 3/5 = 60.0
        assert compute_accuracy("I went to the store", "i went store") == 60.0

    def test_accuracy_empty_expected(self):
        assert compute_accuracy("", "anything") == 0.0

    def test_accuracy_empty_transcript(self):
        assert compute_accuracy("hello world", "") == 0.0


@pytest.mark.unit
class TestValidateChain:
    def _valid_medium(self):
        return {
            "target": "I usually grab a coffee on the way to work",  # 10 words
            "chain": [
                "a coffee",
                "grab a coffee",
                "usually grab a coffee",
                "I usually grab a coffee on the way",
                "I usually grab a coffee on the way to work",
            ],
        }

    def test_accepts_valid(self):
        out = _validate_chain(self._valid_medium(), "medium")
        assert out is not None
        assert out["target"].startswith("I usually")
        assert len(out["chain"]) == 5

    def test_rejects_non_dict(self):
        assert _validate_chain(["nope"], "medium") is None

    def test_rejects_short_chain(self):
        payload = self._valid_medium()
        payload["chain"] = payload["chain"][:2]
        assert _validate_chain(payload, "medium") is None

    def test_rejects_non_increasing_chain(self):
        payload = self._valid_medium()
        # swap steps so word counts are not strictly increasing
        payload["chain"][1] = payload["chain"][0]
        assert _validate_chain(payload, "medium") is None

    def test_rejects_final_step_not_matching_target(self):
        payload = self._valid_medium()
        payload["chain"][-1] = "Something entirely different and much longer than before here"
        assert _validate_chain(payload, "medium") is None

    def test_rejects_target_wrong_length_for_difficulty(self):
        # 'short' expects ~6 words; medium target has 10 -> diff=4, still tolerated.
        # Use 'short' with long target to force failure.
        payload = {
            "target": "I usually grab a coffee on the way to work very early every morning",  # 15 words
            "chain": [
                "coffee",
                "a coffee",
                "grab a coffee",
                "usually grab a coffee",
                "I usually grab a coffee on the way to work very early every morning",
            ],
        }
        assert _validate_chain(payload, "short") is None

    def test_fallback_bank_entries_are_valid(self):
        for difficulty, items in FALLBACK_BANK.items():
            for item in items:
                # fallback should have strictly increasing chain ending in target
                counts = [word_count(s) for s in item["chain"]]
                assert counts == sorted(counts)
                assert len(set(counts)) == len(counts)
                assert normalize_words(item["chain"][-1]) == normalize_words(item["target"])


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dal_create_and_recent(test_db):
    new_id = await dal.create_session(
        test_db,
        difficulty="medium",
        target_sentence="I usually grab a coffee on the way to work",
        chain=["coffee", "a coffee", "grab a coffee", "I usually grab a coffee on the way to work"],
        max_reached=4,
        accuracy=92.5,
        longest_words=10,
    )
    assert new_id > 0

    rows = await dal.recent_sessions(test_db, limit=5)
    assert len(rows) == 1
    r = rows[0]
    assert r["difficulty"] == "medium"
    assert r["accuracy"] == 92.5
    assert r["chain_len"] == 4
    assert isinstance(r["chain"], list)
    assert r["chain"][0] == "coffee"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dal_stats_empty(test_db):
    stats = await dal.get_stats(test_db)
    assert stats == {
        "total_sessions": 0,
        "avg_accuracy_last_20": 0.0,
        "longest_words": 0,
        "last_session_at": None,
    }


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dal_stats_aggregates(test_db):
    await dal.create_session(
        test_db, difficulty="short", target_sentence="I like coffee please",
        chain=["coffee", "like coffee", "I like coffee please"],
        max_reached=3, accuracy=80.0, longest_words=4,
    )
    await dal.create_session(
        test_db, difficulty="long", target_sentence="If you have time this weekend let us try that new ramen place",
        chain=["ramen", "the ramen", "that ramen place", "that new ramen place",
               "try that new ramen place",
               "If you have time this weekend let us try that new ramen place"],
        max_reached=6, accuracy=100.0, longest_words=13,
    )
    stats = await dal.get_stats(test_db)
    assert stats["total_sessions"] == 2
    assert stats["avg_accuracy_last_20"] == 90.0
    assert stats["longest_words"] == 13
    assert stats["last_session_at"] is not None
