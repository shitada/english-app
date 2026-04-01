"""Unit tests for the vocabulary DAL (app/dal/vocabulary.py)."""

from __future__ import annotations

import pytest

from app.dal.vocabulary import (
    build_fill_blank_quiz,
    build_quiz,
    delete_word,
    get_due_word_ids,
    get_due_words,
    get_progress,
    get_review_forecast,
    get_vocabulary_stats,
    get_weak_words,
    get_word,
    get_words_by_topic,
    reset_progress,
    save_words,
    search_words,
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


class TestSearchWords:
    async def test_empty(self, test_db):
        total, words = await search_words(test_db)
        assert total == 0
        assert words == []

    async def test_returns_all(self, test_db):
        await save_words(test_db, "t1", _make_questions(3))
        total, words = await search_words(test_db)
        assert total == 3
        assert len(words) == 3

    async def test_filter_by_topic(self, test_db):
        await save_words(test_db, "food", _make_questions(2))
        await save_words(test_db, "travel", _make_questions(1))
        total, words = await search_words(test_db, topic="food")
        assert total == 2

    async def test_search_by_query(self, test_db):
        await save_words(test_db, "t1", [
            {"word": "apple", "correct_meaning": "a fruit"},
            {"word": "car", "correct_meaning": "a vehicle"},
        ])
        total, words = await search_words(test_db, query="apple")
        assert total == 1
        assert words[0]["word"] == "apple"

    async def test_pagination(self, test_db):
        await save_words(test_db, "t1", _make_questions(5))
        total, words = await search_words(test_db, limit=2, offset=0)
        assert total == 5
        assert len(words) == 2


class TestSaveWordsDedup:
    async def test_skips_duplicates(self, test_db):
        q = [{"word": "apple", "correct_meaning": "a fruit"}]
        w1 = await save_words(test_db, "food", q)
        w2 = await save_words(test_db, "food", q)
        assert w1[0]["id"] == w2[0]["id"]
        all_words = await get_words_by_topic(test_db, "food")
        assert len(all_words) == 1

    async def test_same_word_different_topic(self, test_db):
        q = [{"word": "bank", "correct_meaning": "financial institution"}]
        w1 = await save_words(test_db, "finance", q)
        w2 = await save_words(test_db, "geography", q)
        assert w1[0]["id"] != w2[0]["id"]

    async def test_case_insensitive(self, test_db):
        q1 = [{"word": "Hello", "correct_meaning": "greeting"}]
        q2 = [{"word": "hello", "correct_meaning": "greeting"}]
        w1 = await save_words(test_db, "greetings", q1)
        w2 = await save_words(test_db, "greetings", q2)
        assert w1[0]["id"] == w2[0]["id"]

    async def test_returns_existing_id(self, test_db):
        q = [{"word": "test", "correct_meaning": "exam"}]
        w1 = await save_words(test_db, "study", q)
        original_id = w1[0]["id"]
        w2 = await save_words(test_db, "study", q)
        assert w2[0]["id"] == original_id


class TestDeleteWord:
    async def test_delete_existing_word(self, test_db):
        words = await save_words(test_db, "food", _make_questions(1))
        word_id = words[0]["id"]
        result = await delete_word(test_db, word_id)
        assert result is True
        remaining = await get_words_by_topic(test_db, "food")
        assert len(remaining) == 0

    async def test_delete_nonexistent_word(self, test_db):
        result = await delete_word(test_db, 99999)
        assert result is False


class TestDatabaseIndexes:
    async def test_compound_index_exists(self, test_db):
        rows = await test_db.execute_fetchall(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
        )
        index_names = {r["name"] for r in rows}
        assert "idx_vocabulary_progress_word_review" in index_names
        assert "idx_pron_attempts_created" in index_names


class TestExportWords:
    async def test_export_empty(self, test_db):
        from app.dal.vocabulary import export_words
        result = await export_words(test_db)
        assert result == []

    async def test_export_with_data(self, test_db):
        from app.dal.vocabulary import export_words
        await save_words(test_db, "food", _make_questions(2))
        result = await export_words(test_db)
        assert len(result) == 2
        assert "correct_count" in result[0]
        assert "level" in result[0]

    async def test_export_with_topic_filter(self, test_db):
        from app.dal.vocabulary import export_words
        await save_words(test_db, "food", _make_questions(2))
        await save_words(test_db, "greetings", _make_questions(1))
        result = await export_words(test_db, topic="food")
        assert len(result) == 2


class TestTopicSummary:
    async def test_empty(self, test_db):
        from app.dal.vocabulary import get_topic_summary
        result = await get_topic_summary(test_db)
        assert result == []

    async def test_with_data(self, test_db):
        from app.dal.vocabulary import get_topic_summary
        await save_words(test_db, "food", _make_questions(3))
        await save_words(test_db, "greetings", _make_questions(2))
        result = await get_topic_summary(test_db)
        assert len(result) == 2
        food_topic = next(t for t in result if t["topic"] == "food")
        assert food_topic["total_words"] == 3
        assert food_topic["reviewed_words"] == 0
        assert food_topic["mastered_words"] == 0


@pytest.mark.unit
class TestGetReviewForecast:
    async def test_empty_database(self, test_db):
        result = await get_review_forecast(test_db)
        assert result["overdue_count"] == 0
        assert result["total_upcoming"] == 0
        assert result["daily_forecast"] == []

    async def test_with_overdue_words(self, test_db):
        await save_words(test_db, "food", _make_questions(2))
        words = await get_words_by_topic(test_db, "food")
        for w in words:
            await update_progress(test_db, w["id"], is_correct=False)
        # Set next_review_at to yesterday
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now', '-1 day')"
        )
        await test_db.commit()
        result = await get_review_forecast(test_db)
        assert result["overdue_count"] == 2

    async def test_with_upcoming_words(self, test_db):
        await save_words(test_db, "food", _make_questions(3))
        words = await get_words_by_topic(test_db, "food")
        for w in words:
            await update_progress(test_db, w["id"], is_correct=False)
        # Set next_review_at to today
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now')"
        )
        await test_db.commit()
        result = await get_review_forecast(test_db)
        assert result["total_upcoming"] == 3
        assert len(result["daily_forecast"]) >= 1

    async def test_total_matches_daily_sum(self, test_db):
        await save_words(test_db, "food", _make_questions(2))
        words = await get_words_by_topic(test_db, "food")
        for w in words:
            await update_progress(test_db, w["id"], is_correct=False)
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now')"
        )
        await test_db.commit()
        result = await get_review_forecast(test_db)
        assert result["total_upcoming"] == sum(
            d["count"] for d in result["daily_forecast"]
        )


@pytest.mark.unit
class TestGetDueWords:
    async def test_empty_database(self, test_db):
        result = await get_due_words(test_db)
        assert result == []

    async def test_no_due_words(self, test_db):
        await save_words(test_db, "food", _make_questions(2))
        words = await get_words_by_topic(test_db, "food")
        for w in words:
            await update_progress(test_db, w["id"], is_correct=True)
        # Set next_review_at to tomorrow (not due)
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now', '+1 day')"
        )
        await test_db.commit()
        result = await get_due_words(test_db)
        assert result == []

    async def test_returns_due_words(self, test_db):
        await save_words(test_db, "food", _make_questions(2))
        words = await get_words_by_topic(test_db, "food")
        for w in words:
            await update_progress(test_db, w["id"], is_correct=False)
        # Set next_review_at to past
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now', '-1 hour')"
        )
        await test_db.commit()
        result = await get_due_words(test_db)
        assert len(result) == 2
        assert all("word" in r and "topic" in r for r in result)

    async def test_filter_by_topic(self, test_db):
        await save_words(test_db, "food", _make_questions(2))
        await save_words(test_db, "greetings", _make_questions(1))
        all_words = await get_words_by_topic(test_db, "food")
        for w in all_words:
            await update_progress(test_db, w["id"], is_correct=False)
        greet_words = await get_words_by_topic(test_db, "greetings")
        for w in greet_words:
            await update_progress(test_db, w["id"], is_correct=False)
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now', '-1 hour')"
        )
        await test_db.commit()
        result = await get_due_words(test_db, topic="food")
        assert len(result) == 2
        assert all(r["topic"] == "food" for r in result)

    async def test_respects_limit(self, test_db):
        await save_words(test_db, "food", _make_questions(3))
        words = await get_words_by_topic(test_db, "food")
        for w in words:
            await update_progress(test_db, w["id"], is_correct=False)
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now', '-1 hour')"
        )
        await test_db.commit()
        result = await get_due_words(test_db, limit=1)
        assert len(result) == 1
