"""Unit tests for get_trouble_words DAL."""

from __future__ import annotations

import pytest

from app.dal.pronunciation import get_trouble_words, save_attempt


@pytest.mark.unit
class TestGetTroubleWords:
    async def test_empty_returns_empty(self, test_db):
        result = await get_trouble_words(test_db)
        assert result == []

    async def test_single_missing_word(self, test_db):
        await save_attempt(
            test_db,
            reference_text="Please pronounce articulation clearly.",
            user_transcription="please pronounce clearly",
            feedback={},
            score=5.0,
        )
        result = await get_trouble_words(test_db)
        words = {item["word"] for item in result}
        assert "articulation" in words
        item = next(i for i in result if i["word"] == "articulation")
        assert item["miss_count"] == 1
        assert item["total_seen"] == 1
        assert item["miss_rate"] == 1.0
        assert item["example_sentence"] == "Please pronounce articulation clearly."

    async def test_stopwords_and_short_filtered(self, test_db):
        # Reference contains stopwords (the, is, of, to) and short words (a, an)
        await save_attempt(
            test_db,
            reference_text="The cat is on a mat of straw.",
            user_transcription="",  # nothing transcribed -> all words are missing
            feedback={},
            score=2.0,
        )
        result = await get_trouble_words(test_db)
        words = {item["word"] for item in result}
        # Stopwords excluded
        for sw in {"the", "is", "on", "of", "a", "an", "to"}:
            assert sw not in words
        # Short words (<3 chars) excluded
        assert all(len(w) >= 3 for w in words)
        # Real content words (>=3 chars, not stopwords) should be present
        assert "cat" in words
        assert "mat" in words
        assert "straw" in words

    async def test_score_above_max_excluded(self, test_db):
        # High-score attempt: should not contribute trouble words
        await save_attempt(
            test_db,
            reference_text="Articulation matters tremendously here.",
            user_transcription="",
            feedback={},
            score=9.0,
        )
        # Low-score attempt: should contribute
        await save_attempt(
            test_db,
            reference_text="Different difficult vocabulary.",
            user_transcription="",
            feedback={},
            score=4.0,
        )
        result = await get_trouble_words(test_db, max_score=7.5)
        words = {item["word"] for item in result}
        assert "articulation" not in words
        assert "tremendously" not in words
        assert "different" in words
        assert "difficult" in words
        assert "vocabulary" in words

    async def test_limit_honored(self, test_db):
        # Create one attempt with many missing words
        many_words = " ".join(f"unique{i:03d}word" for i in range(15))
        await save_attempt(
            test_db,
            reference_text=many_words + ".",
            user_transcription="",
            feedback={},
            score=3.0,
        )
        result = await get_trouble_words(test_db, limit=5)
        assert len(result) == 5

    async def test_example_sentence_is_most_recent(self, test_db):
        # Older attempt with the trouble word
        await save_attempt(
            test_db,
            reference_text="An older sentence with conundrum here.",
            user_transcription="",
            feedback={},
            score=4.0,
        )
        # Newer attempt also with the trouble word
        await save_attempt(
            test_db,
            reference_text="The newer sentence about conundrum solving.",
            user_transcription="",
            feedback={},
            score=4.0,
        )
        result = await get_trouble_words(test_db)
        item = next(i for i in result if i["word"] == "conundrum")
        assert item["example_sentence"] == "The newer sentence about conundrum solving."
        assert item["miss_count"] == 2
        assert item["total_seen"] == 2

    async def test_multiset_aware(self, test_db):
        # Reference has 'really' twice; user only said it once -> miss_count 1
        await save_attempt(
            test_db,
            reference_text="Really really wonderful day.",
            user_transcription="really wonderful day",
            feedback={},
            score=5.0,
        )
        result = await get_trouble_words(test_db)
        item = next((i for i in result if i["word"] == "really"), None)
        assert item is not None
        assert item["miss_count"] == 1
