"""Unit tests for the Pause & Predict DAL."""

from __future__ import annotations

from unittest.mock import AsyncMock

import aiosqlite
import pytest

from app.dal import pause_predict as dal


@pytest.mark.unit
class TestPausePredictHelpers:

    def test_normalize_difficulty_known(self):
        assert dal.normalize_difficulty("beginner") == "beginner"
        assert dal.normalize_difficulty("INTERMEDIATE") == "intermediate"
        assert dal.normalize_difficulty(" advanced ") == "advanced"

    def test_normalize_difficulty_unknown(self):
        assert dal.normalize_difficulty(None) == "beginner"
        assert dal.normalize_difficulty("") == "beginner"
        assert dal.normalize_difficulty("expert") == "beginner"

    def test_normalize_answer_strips_punct_and_case(self):
        assert dal.normalize_answer("  Store.  ") == "store"
        assert dal.normalize_answer("Store!") == "store"
        assert dal.normalize_answer("Storm's brewing") == "storm's brewing"
        assert dal.normalize_answer(None) == ""
        assert dal.normalize_answer("") == ""

    def test_static_bank_items_have_strict_prefix(self):
        for diff, items in dal.STATIC_BANK.items():
            assert items, f"{diff} bank is empty"
            for it in items:
                full = it["full_sentence"]
                prefix = it["prefix_text"]
                assert full.startswith(prefix)
                assert prefix != full
                assert it["expected_completion"]


@pytest.mark.unit
class TestPausePredictScoring:

    def test_exact_match_is_correct(self):
        r = dal.score_answer("store", "store", [])
        assert r["is_correct"] is True
        assert r["is_close"] is False
        assert r["score"] == 1.0

    def test_exact_match_with_punctuation_still_correct(self):
        r = dal.score_answer("Store.", "store", [])
        assert r["is_correct"] is True
        assert r["score"] == 1.0

    def test_alternative_match(self):
        r = dal.score_answer("shop", "store", ["shop", "market"])
        assert r["is_correct"] is True
        assert r["is_close"] is False
        assert r["score"] == 0.9

    def test_semantic_close_gets_partial_credit(self):
        # Shared 4-char prefix "aver" with expected "averted" → close
        r = dal.score_answer("average", "averted", [])
        assert r["is_correct"] is False
        assert r["is_close"] is True
        assert r["score"] == 0.6

    def test_substring_is_close(self):
        r = dal.score_answer("prevent", "prevented", [])
        assert r["is_close"] is True
        assert r["score"] == 0.6

    def test_clearly_wrong_scores_zero(self):
        r = dal.score_answer("banana", "store", ["shop"])
        assert r["is_correct"] is False
        assert r["is_close"] is False
        assert r["score"] == 0.0

    def test_empty_answer_returns_feedback(self):
        r = dal.score_answer("", "store", [])
        assert r["is_correct"] is False
        assert r["score"] == 0.0


@pytest.mark.unit
class TestPausePredictGenerate:

    async def test_generate_uses_llm_when_valid(self):
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock(
            return_value={
                "items": [
                    {
                        "full_sentence": "I drank a cup of hot tea.",
                        "prefix_text": "I drank a cup of hot",
                        "expected_completion": "tea",
                        "alternatives": ["coffee"],
                        "context_hint": "Breakfast",
                    }
                ]
            }
        )
        items = await dal.generate_items(copilot, difficulty="beginner", count=1)
        assert len(items) == 1
        it = items[0]
        assert it["full_sentence"].startswith(it["prefix_text"])
        assert it["prefix_text"] != it["full_sentence"]
        assert it["expected_completion"] == "tea"

    async def test_generate_falls_back_to_static_on_error(self):
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        items = await dal.generate_items(copilot, difficulty="beginner", count=5)
        assert len(items) == 5
        for it in items:
            assert it["full_sentence"].startswith(it["prefix_text"])
            assert it["prefix_text"] != it["full_sentence"]
            assert it["expected_completion"]

    async def test_generate_fills_count_when_llm_returns_fewer(self):
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock(
            return_value={
                "items": [
                    {
                        "full_sentence": "She went to the store.",
                        "prefix_text": "She went to the",
                        "expected_completion": "store",
                        "alternatives": [],
                        "context_hint": "",
                    }
                ]
            }
        )
        items = await dal.generate_items(copilot, difficulty="beginner", count=4)
        assert len(items) == 4

    async def test_generate_rejects_items_without_strict_prefix(self):
        # Prefix is not a prefix of full_sentence → item is discarded,
        # static fallback fills the gap.
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock(
            return_value={
                "items": [
                    {
                        "full_sentence": "Hello world.",
                        "prefix_text": "Goodbye",
                        "expected_completion": "world",
                        "alternatives": [],
                        "context_hint": "",
                    }
                ]
            }
        )
        items = await dal.generate_items(copilot, difficulty="beginner", count=2)
        assert len(items) == 2
        for it in items:
            assert it["full_sentence"].startswith(it["prefix_text"])


@pytest.mark.unit
class TestPausePredictDB:

    async def test_insert_and_fetch_session(self, test_db: aiosqlite.Connection):
        new_id = await dal.insert_session(
            test_db,
            difficulty="intermediate",
            total=5,
            correct=3,
            close=1,
            avg_score=0.78,
        )
        assert new_id > 0

        rows = await dal.recent_sessions(test_db, limit=10)
        assert len(rows) == 1
        r = rows[0]
        assert r["id"] == new_id
        assert r["difficulty"] == "intermediate"
        assert r["total"] == 5
        assert r["correct"] == 3
        assert r["close"] == 1
        assert abs(r["avg_score"] - 0.78) < 1e-6

    async def test_stats_aggregates(self, test_db: aiosqlite.Connection):
        await dal.insert_session(
            test_db, difficulty="beginner",
            total=5, correct=4, close=1, avg_score=0.9,
        )
        await dal.insert_session(
            test_db, difficulty="advanced",
            total=5, correct=2, close=2, avg_score=0.5,
        )
        s = await dal.stats(test_db)
        assert s["sessions"] == 2
        assert s["total_items"] == 10
        assert s["total_correct"] == 6
        assert s["total_close"] == 3
        assert s["accuracy"] == 0.6
        assert 0.6 <= s["avg_score"] <= 0.8

    async def test_stats_empty(self, test_db: aiosqlite.Connection):
        s = await dal.stats(test_db)
        assert s["sessions"] == 0
        assert s["accuracy"] == 0.0

    async def test_insert_normalizes_difficulty(self, test_db: aiosqlite.Connection):
        await dal.insert_session(
            test_db, difficulty="BOGUS",
            total=0, correct=0, close=0, avg_score=0.0,
        )
        rows = await dal.recent_sessions(test_db)
        assert rows[0]["difficulty"] == "beginner"
