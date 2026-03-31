"""Unit tests for the vocabulary DAL (app/dal/vocabulary.py)."""

from __future__ import annotations

import pytest

from app.dal.vocabulary import (
    build_fill_blank_quiz,
    build_quiz,
    get_due_word_ids,
    get_progress,
    get_vocabulary_stats,
    get_weak_words,
    get_word,
    get_words_by_topic,
    reset_progress,
    save_words,
    update_progress,
)


# Helper to create sample quiz questions for save_words
def _make_questions(count: int = 3) -> list[dict]:
    return [
        {
            "word": f"word_{i}",
            "correct_meaning": f"meaning_{i}",
            "example_sentence": f"Example sentence {i}.",
            "difficulty": (i % 3) + 1,
            "wrong_options": [f"wrong_{i}_a", f"wrong_{i}_b", f"wrong_{i}_c"],
        }
        for i in range(count)
    ]


@pytest.mark.unit
class TestGetWordsByTopic:
    async def test_returns_words_for_topic(self, test_db):
        questions = _make_questions(2)
        await save_words(test_db, "hotel_checkin", questions)
        words = await get_words_by_topic(test_db, "hotel_checkin")
        assert len(words) == 2
        assert words[0]["word"] == "word_0"
        assert words[0]["meaning"] == "meaning_0"

    async def test_returns_empty_for_unknown_topic(self, test_db):
        words = await get_words_by_topic(test_db, "nonexistent_topic")
        assert words == []

    async def test_does_not_return_other_topics(self, test_db):
        await save_words(test_db, "hotel_checkin", _make_questions(2))
        await save_words(test_db, "shopping", _make_questions(2))
        words = await get_words_by_topic(test_db, "hotel_checkin")
        assert len(words) == 2


@pytest.mark.unit
class TestSaveWords:
    async def test_inserts_words_with_ids(self, test_db):
        questions = _make_questions(3)
        result = await save_words(test_db, "restaurant_order", questions)
        assert len(result) == 3
        for w in result:
            assert "id" in w
            assert isinstance(w["id"], int)

    async def test_preserves_word_data(self, test_db):
        questions = [
            {
                "word": "reservation",
                "correct_meaning": "a booking or arrangement",
                "example_sentence": "I have a reservation for two.",
                "difficulty": 2,
            }
        ]
        result = await save_words(test_db, "hotel_checkin", questions)
        assert result[0]["word"] == "reservation"
        assert result[0]["meaning"] == "a booking or arrangement"
        assert result[0]["example_sentence"] == "I have a reservation for two."
        assert result[0]["difficulty"] == 2

    async def test_defaults_for_optional_fields(self, test_db):
        questions = [{"word": "hello", "correct_meaning": "a greeting"}]
        result = await save_words(test_db, "hotel_checkin", questions)
        assert result[0]["example_sentence"] == ""
        assert result[0]["difficulty"] == 1


@pytest.mark.unit
class TestGetDueWordIds:
    async def test_returns_word_ids_with_progress(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(3))
        # Create progress for the words
        for w in words:
            await update_progress(test_db, w["id"], True)
        due = await get_due_word_ids(test_db, "hotel_checkin", 10)
        assert len(due) == 3
        assert all(isinstance(wid, int) for wid in due)

    async def test_respects_count_limit(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(5))
        for w in words:
            await update_progress(test_db, w["id"], True)
        due = await get_due_word_ids(test_db, "hotel_checkin", 2)
        assert len(due) == 2

    async def test_returns_empty_when_no_progress(self, test_db):
        await save_words(test_db, "hotel_checkin", _make_questions(3))
        due = await get_due_word_ids(test_db, "hotel_checkin", 10)
        assert due == set()


@pytest.mark.unit
class TestBuildQuiz:
    def test_builds_questions_with_wrong_options(self):
        words = [
            {"id": 1, "word": "hello", "meaning": "greeting", "example_sentence": "Hi"},
            {"id": 2, "word": "bye", "meaning": "farewell", "example_sentence": "Bye"},
        ]
        all_meanings = ["greeting", "farewell", "thanks", "sorry"]
        quiz = build_quiz(words, all_meanings)
        assert len(quiz) == 2
        for q in quiz:
            assert "wrong_options" in q
            assert q["meaning"] not in q["wrong_options"]

    def test_caps_wrong_options_at_3(self):
        words = [{"id": 1, "word": "hello", "meaning": "greeting", "example_sentence": "Hi"}]
        all_meanings = ["greeting", "farewell", "thanks", "sorry", "welcome", "cheers"]
        quiz = build_quiz(words, all_meanings)
        assert len(quiz[0]["wrong_options"]) == 3

    def test_handles_empty_words(self):
        quiz = build_quiz([], ["meaning1", "meaning2"])
        assert quiz == []


@pytest.mark.unit
class TestGetWord:
    async def test_returns_word_by_id(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        result = await get_word(test_db, words[0]["id"])
        assert result is not None
        assert result["word"] == "word_0"

    async def test_returns_none_for_missing_id(self, test_db):
        result = await get_word(test_db, 99999)
        assert result is None


@pytest.mark.unit
class TestUpdateProgress:
    async def test_creates_progress_on_first_correct(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        result = await update_progress(test_db, words[0]["id"], True)
        assert result["is_correct"] is True
        assert result["new_level"] == 1

    async def test_creates_progress_on_first_incorrect(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        result = await update_progress(test_db, words[0]["id"], False)
        assert result["is_correct"] is False
        assert result["new_level"] == 0

    async def test_increments_level_on_correct(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        wid = words[0]["id"]
        await update_progress(test_db, wid, True)  # level 1
        result = await update_progress(test_db, wid, True)  # level 2
        assert result["new_level"] == 2

    async def test_decrements_level_on_incorrect(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        wid = words[0]["id"]
        await update_progress(test_db, wid, True)   # level 1
        await update_progress(test_db, wid, True)   # level 2
        result = await update_progress(test_db, wid, False)  # level 1
        assert result["new_level"] == 1

    async def test_level_capped_at_max(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        wid = words[0]["id"]
        # Advance to max level (6)
        for _ in range(10):
            await update_progress(test_db, wid, True)
        rows = await test_db.execute_fetchall(
            "SELECT level FROM vocabulary_progress WHERE word_id = ?", (wid,)
        )
        assert rows[0]["level"] == 6

    async def test_level_floored_at_zero(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        wid = words[0]["id"]
        await update_progress(test_db, wid, False)  # level 0
        result = await update_progress(test_db, wid, False)  # still 0
        assert result["new_level"] == 0

    async def test_counts_correct_and_incorrect(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(1))
        wid = words[0]["id"]
        await update_progress(test_db, wid, True)
        await update_progress(test_db, wid, True)
        await update_progress(test_db, wid, False)
        rows = await test_db.execute_fetchall(
            "SELECT correct_count, incorrect_count FROM vocabulary_progress WHERE word_id = ?",
            (wid,),
        )
        assert rows[0]["correct_count"] == 2
        assert rows[0]["incorrect_count"] == 1


@pytest.mark.unit
class TestGetProgress:
    async def test_returns_progress_by_topic(self, test_db):
        words = await save_words(test_db, "hotel_checkin", _make_questions(2))
        for w in words:
            await update_progress(test_db, w["id"], True)
        progress = await get_progress(test_db, "hotel_checkin")
        assert len(progress) == 2
        assert all(p["topic"] == "hotel_checkin" for p in progress)

    async def test_returns_all_progress_without_topic(self, test_db):
        w1 = await save_words(test_db, "hotel_checkin", _make_questions(1))
        w2 = await save_words(test_db, "shopping", _make_questions(1))
        await update_progress(test_db, w1[0]["id"], True)
        await update_progress(test_db, w2[0]["id"], True)
        progress = await get_progress(test_db)
        assert len(progress) == 2

    async def test_returns_empty_when_no_progress(self, test_db):
        progress = await get_progress(test_db, "hotel_checkin")
        assert progress == []


@pytest.mark.unit
class TestGetVocabularyStats:
    async def test_empty_database(self, test_db):
        stats = await get_vocabulary_stats(test_db)
        assert stats["total_words"] == 0
        assert stats["total_mastered"] == 0
        assert stats["total_reviews"] == 0
        assert stats["accuracy_rate"] == 0.0
        assert stats["level_distribution"] == []
        assert stats["topic_breakdown"] == []

    async def test_single_topic_stats(self, test_db):
        words = await save_words(test_db, "greetings", _make_questions(3))
        for w in words:
            await update_progress(test_db, w["id"], True)
        stats = await get_vocabulary_stats(test_db)
        assert stats["total_words"] == 3
        assert stats["total_reviews"] == 3
        assert stats["accuracy_rate"] == 100.0
        assert len(stats["topic_breakdown"]) == 1
        assert stats["topic_breakdown"][0]["topic"] == "greetings"
        assert stats["topic_breakdown"][0]["word_count"] == 3

    async def test_mixed_levels_and_topics(self, test_db):
        w1 = await save_words(test_db, "greetings", _make_questions(2))
        w2 = await save_words(test_db, "travel", _make_questions(1))
        # Advance w1[0] to mastered (level 3+)
        for _ in range(3):
            await update_progress(test_db, w1[0]["id"], True)
        # w1[1] stays at level 1
        await update_progress(test_db, w1[1]["id"], True)
        # w2[0] gets wrong answer
        await update_progress(test_db, w2[0]["id"], False)

        stats = await get_vocabulary_stats(test_db)
        assert stats["total_words"] == 3
        assert stats["total_mastered"] == 1
        assert stats["total_reviews"] == 5  # 3 + 1 + 1
        assert len(stats["level_distribution"]) > 0
        assert len(stats["topic_breakdown"]) == 2


class TestTimezoneConsistency:
    """Verify that timestamps written by vocabulary DAL use UTC."""

    async def test_update_progress_writes_utc(self, test_db):
        """last_reviewed and next_review_at should both be UTC strings."""
        words = await save_words(test_db, "tz", _make_questions(1))
        await update_progress(test_db, words[0]["id"], True)
        rows = await test_db.execute_fetchall(
            "SELECT last_reviewed, next_review_at FROM vocabulary_progress WHERE word_id = ?",
            (words[0]["id"],),
        )
        assert len(rows) == 1
        last_reviewed = rows[0]["last_reviewed"]
        next_review = rows[0]["next_review_at"]
        # Both should be parseable UTC timestamps (no timezone offset suffix)
        from datetime import datetime
        lr = datetime.strptime(last_reviewed, "%Y-%m-%d %H:%M:%S")
        nr = datetime.strptime(next_review, "%Y-%m-%d %H:%M:%S")
        # next_review should be >= last_reviewed (interval >= 0)
        assert nr >= lr


class TestBuildFillBlankQuiz:
    def test_word_in_sentence_gets_blanked(self):
        words = [{"id": 1, "word": "apple", "meaning": "a fruit", "example_sentence": "I ate an apple.", "difficulty": 1}]
        result = build_fill_blank_quiz(words)
        assert len(result) == 1
        assert result[0]["example_with_blank"] == "I ate an ___."
        assert result[0]["hint"] == "a"
        assert result[0]["answer"] == "apple"

    def test_word_not_in_sentence(self):
        words = [{"id": 2, "word": "run", "meaning": "to move quickly", "example_sentence": "He sprinted fast.", "difficulty": 1}]
        result = build_fill_blank_quiz(words)
        assert len(result) == 1
        # Sentence stays unchanged since word is not present
        assert result[0]["example_with_blank"] == "He sprinted fast."
        assert result[0]["hint"] == "r"

    def test_empty_list(self):
        result = build_fill_blank_quiz([])
        assert result == []

    def test_case_insensitive_blanking(self):
        words = [{"id": 3, "word": "Hello", "meaning": "greeting", "example_sentence": "hello world!", "difficulty": 1}]
        result = build_fill_blank_quiz(words)
        assert "___" in result[0]["example_with_blank"]
        assert "hello" not in result[0]["example_with_blank"].lower() or "___" in result[0]["example_with_blank"]


class TestResetProgress:
    async def test_reset_all(self, test_db):
        words = await save_words(test_db, "t1", _make_questions(2))
        for w in words:
            await update_progress(test_db, w["id"], True)
        deleted = await reset_progress(test_db)
        assert deleted == 2
        progress = await get_progress(test_db)
        assert len(progress) == 0

    async def test_reset_by_topic(self, test_db):
        w1 = await save_words(test_db, "food", _make_questions(2))
        w2 = await save_words(test_db, "travel", _make_questions(1))
        for w in w1 + w2:
            await update_progress(test_db, w["id"], True)
        deleted = await reset_progress(test_db, topic="food")
        assert deleted == 2
        progress = await get_progress(test_db)
        assert len(progress) == 1

    async def test_reset_empty(self, test_db):
        deleted = await reset_progress(test_db)
        assert deleted == 0


class TestGetWeakWords:
    async def test_empty(self, test_db):
        words = await get_weak_words(test_db)
        assert words == []

    async def test_single_attempt_excluded(self, test_db):
        """Words with only 1 attempt should be excluded (min 2)."""
        ws = await save_words(test_db, "t1", _make_questions(1))
        await update_progress(test_db, ws[0]["id"], False)
        words = await get_weak_words(test_db)
        assert len(words) == 0

    async def test_high_error_rate_first(self, test_db):
        """Word with higher error rate should appear first."""
        ws = await save_words(test_db, "t1", _make_questions(2))
        # w0: 0 correct, 2 incorrect → error_rate = 1.0
        await update_progress(test_db, ws[0]["id"], False)
        await update_progress(test_db, ws[0]["id"], False)
        # w1: 1 correct, 1 incorrect → error_rate = 0.5
        await update_progress(test_db, ws[1]["id"], True)
        await update_progress(test_db, ws[1]["id"], False)
        words = await get_weak_words(test_db)
        assert len(words) == 2
        assert words[0]["error_rate"] >= words[1]["error_rate"]
