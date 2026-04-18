"""Unit tests for word family DAL functions."""

from __future__ import annotations

import pytest

from app.dal.vocabulary import (
    get_word_family,
    save_word_family,
    save_words,
)


def _make_word(word: str = "negotiate") -> list[dict]:
    return [{
        "word": word,
        "correct_meaning": "to discuss terms",
        "example_sentence": "We need to negotiate the contract.",
        "difficulty": 2,
        "wrong_options": ["ignore", "celebrate", "complain"],
    }]


@pytest.mark.unit
class TestGetWordFamily:
    async def test_returns_none_for_nonexistent_word(self, test_db):
        word, family = await get_word_family(test_db, 9999)
        assert word is None
        assert family is None

    async def test_returns_none_when_no_cached_data(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_word())
        word_id = words[0]["id"]
        word, family = await get_word_family(test_db, word_id)
        assert word == "negotiate"
        assert family is None

    async def test_returns_cached_data_after_save(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_word())
        word_id = words[0]["id"]
        family_data = {
            "forms": [
                {
                    "part_of_speech": "verb",
                    "form": "negotiate",
                    "example_sentence": "We need to negotiate.",
                    "pronunciation_tip": "ni-GOH-shee-ayt",
                },
                {
                    "part_of_speech": "noun",
                    "form": "negotiation",
                    "example_sentence": "The negotiation took hours.",
                    "pronunciation_tip": "ni-goh-shee-AY-shun",
                },
            ]
        }
        await save_word_family(test_db, word_id, family_data)
        word, family = await get_word_family(test_db, word_id)
        assert word == "negotiate"
        assert family is not None
        assert len(family["forms"]) == 2
        assert family["forms"][0]["form"] == "negotiate"
        assert family["forms"][1]["form"] == "negotiation"


@pytest.mark.unit
class TestSaveWordFamily:
    async def test_saves_and_persists(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_word())
        word_id = words[0]["id"]
        data = {"forms": [{"part_of_speech": "verb", "form": "negotiate", "example_sentence": "x", "pronunciation_tip": ""}]}
        await save_word_family(test_db, word_id, data)

        # Read back directly to confirm persistence
        rows = await test_db.execute_fetchall(
            "SELECT word_family_json FROM vocabulary_words WHERE id = ?", (word_id,)
        )
        assert rows[0]["word_family_json"] is not None

    async def test_overwrites_previous_data(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_word())
        word_id = words[0]["id"]
        first = {"forms": [{"part_of_speech": "verb", "form": "negotiate", "example_sentence": "x", "pronunciation_tip": ""}]}
        await save_word_family(test_db, word_id, first)

        second = {"forms": [{"part_of_speech": "noun", "form": "negotiation", "example_sentence": "y", "pronunciation_tip": "tip"}]}
        await save_word_family(test_db, word_id, second)

        word, family = await get_word_family(test_db, word_id)
        assert family is not None
        assert len(family["forms"]) == 1
        assert family["forms"][0]["form"] == "negotiation"
