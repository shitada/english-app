"""Unit tests for the Paraphrase Practice DAL."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.dal import paraphrase as dal


@pytest.mark.unit
class TestParaphraseDAL:

    def test_normalize_level_known(self):
        assert dal.normalize_level("easy") == "easy"
        assert dal.normalize_level("MEDIUM") == "medium"
        assert dal.normalize_level("hard ") == "hard"

    def test_normalize_level_unknown_falls_back_to_easy(self):
        assert dal.normalize_level(None) == "easy"
        assert dal.normalize_level("") == "easy"
        assert dal.normalize_level("expert") == "easy"

    def test_get_random_sentences_returns_n_at_requested_level(self):
        items = dal.get_random_sentences("medium", count=5)
        assert len(items) == 5
        for it in items:
            assert it["level"] == "medium"
            assert it["text"] in dal.SENTENCES["medium"]
        # All distinct (no duplicates within one session)
        assert len({it["text"] for it in items}) == 5

    def test_get_random_sentences_unknown_level_uses_easy(self):
        items = dal.get_random_sentences("expert", count=3)
        assert len(items) == 3
        for it in items:
            assert it["level"] == "easy"
            assert it["text"] in dal.SENTENCES["easy"]

    def test_get_random_sentences_clamps_count(self):
        # Asking for more than the bank still returns the full bank, not error.
        bank_size = len(dal.SENTENCES["easy"])
        items = dal.get_random_sentences("easy", count=999)
        assert len(items) == bank_size
        # Lower bound: 0/negative count → at least 1.
        items = dal.get_random_sentences("easy", count=0)
        assert len(items) >= 1

    async def test_score_paraphrase_returns_safe_defaults_when_copilot_raises(self):
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        result = await dal.score_paraphrase(
            copilot,
            source="I usually take the bus to work.",
            attempt="I generally commute by bus.",
        )
        assert result["meaning_score"] == 0
        assert result["grammar_score"] == 0
        assert result["naturalness_score"] == 0
        assert result["overall"] == 0
        assert result["kept_meaning"] is False
        assert result["used_different_words"] is True
        assert "try again" in result["feedback"].lower()
        assert result["suggested_paraphrase"] == "I usually take the bus to work."

    async def test_score_paraphrase_normalizes_llm_response(self):
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock(return_value={
            "meaning_score": 95,
            "grammar_score": 80,
            "naturalness_score": 70,
            "overall": 82,
            "kept_meaning": True,
            "used_different_words": True,
            "feedback": "Great rewrite!",
            "suggested_paraphrase": "I generally commute by bus.",
        })
        result = await dal.score_paraphrase(
            copilot, source="I usually take the bus.", attempt="I generally take the bus."
        )
        assert result["meaning_score"] == 95
        assert result["grammar_score"] == 80
        assert result["overall"] == 82
        assert result["kept_meaning"] is True
        assert result["feedback"] == "Great rewrite!"

    async def test_score_paraphrase_clamps_out_of_range_numbers(self):
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock(return_value={
            "meaning_score": 150,        # → 100
            "grammar_score": -20,        # → 0
            "naturalness_score": "75",   # → 75
            # overall omitted → averaged
            "feedback": "",
            "suggested_paraphrase": "",
        })
        result = await dal.score_paraphrase(
            copilot, source="The cat sat.", attempt="A cat was sitting."
        )
        assert result["meaning_score"] == 100
        assert result["grammar_score"] == 0
        assert result["naturalness_score"] == 75
        # average of 100, 0, 75 → 58
        assert result["overall"] == round((100 + 0 + 75) / 3)
        # Defaults filled in:
        assert result["feedback"]
        assert result["suggested_paraphrase"] == "The cat sat."

    async def test_score_paraphrase_empty_inputs_skip_llm(self):
        copilot = type("C", (), {})()
        copilot.ask_json = AsyncMock()
        result = await dal.score_paraphrase(copilot, source="", attempt="anything")
        assert copilot.ask_json.await_count == 0
        assert result["overall"] == 0
