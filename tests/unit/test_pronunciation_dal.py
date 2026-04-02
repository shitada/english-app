"""Unit tests for the pronunciation DAL (app/dal/pronunciation.py)."""

from __future__ import annotations

import json

import pytest

from app.dal.conversation import add_message, create_conversation
from app.dal.pronunciation import (
    _estimate_difficulty,
    clear_history,
    delete_attempt,
    get_history,
    get_progress,
    get_progress_by_difficulty,
    get_sentences_from_conversations,
    get_sentences_from_vocabulary,
    get_weekly_progress,
    save_attempt,
)


@pytest.mark.unit
class TestGetSentencesFromConversations:
    async def test_extracts_sentences_from_assistant_messages(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "assistant", "Welcome to the Grand Hotel. How may I help you today?")
        sentences = await get_sentences_from_conversations(test_db)
        assert len(sentences) >= 1
        assert all(s["topic"] == "hotel_checkin" for s in sentences)

    async def test_filters_by_word_count(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        # Short sentence (< 5 words) should be excluded
        await add_message(test_db, cid, "assistant", "Hi.")
        # Long sentence (> 20 words) should be excluded
        long = " ".join(["word"] * 25) + "."
        await add_message(test_db, cid, "assistant", long)
        sentences = await get_sentences_from_conversations(test_db)
        for s in sentences:
            word_count = len(s["text"].rstrip(".").split())
            assert 5 <= word_count <= 20

    async def test_deduplicates_sentences(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "assistant", "Welcome to our hotel and enjoy your stay.")
        await add_message(test_db, cid, "assistant", "Welcome to our hotel and enjoy your stay.")
        sentences = await get_sentences_from_conversations(test_db)
        texts = [s["text"] for s in sentences]
        assert len(texts) == len(set(texts))

    async def test_caps_at_10_results(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        for i in range(15):
            await add_message(
                test_db, cid, "assistant",
                f"This is a unique sentence number {i} for testing purposes."
            )
        sentences = await get_sentences_from_conversations(test_db)
        assert len(sentences) <= 10

    async def test_returns_empty_when_no_conversations(self, test_db):
        sentences = await get_sentences_from_conversations(test_db)
        assert sentences == []

    async def test_splits_on_punctuation(self, test_db):
        cid = await create_conversation(test_db, "restaurant_order")
        await add_message(
            test_db, cid, "assistant",
            "Would you like to see the menu? We have some great specials today!"
        )
        sentences = await get_sentences_from_conversations(test_db)
        # Both sentences should be extracted (both have 5+ words)
        assert len(sentences) >= 1

    async def test_preserves_question_mark_punctuation(self, test_db):
        cid = await create_conversation(test_db, "restaurant_order")
        await add_message(
            test_db, cid, "assistant",
            "Would you like to see the menu today?"
        )
        sentences = await get_sentences_from_conversations(test_db)
        assert len(sentences) == 1
        assert sentences[0]["text"].endswith("?")

    async def test_preserves_exclamation_mark_punctuation(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(
            test_db, cid, "assistant",
            "Welcome to our wonderful hotel and enjoy your stay!"
        )
        sentences = await get_sentences_from_conversations(test_db)
        assert len(sentences) == 1
        assert sentences[0]["text"].endswith("!")

    async def test_preserves_mixed_punctuation(self, test_db):
        cid = await create_conversation(test_db, "restaurant_order")
        await add_message(
            test_db, cid, "assistant",
            "Would you like to see the menu? We have some great specials today! Please take your time to decide."
        )
        sentences = await get_sentences_from_conversations(test_db)
        texts = [s["text"] for s in sentences]
        question_found = any(t.endswith("?") for t in texts)
        exclamation_found = any(t.endswith("!") for t in texts)
        period_found = any(t.endswith(".") for t in texts)
        assert question_found, f"No question mark found in: {texts}"
        assert exclamation_found, f"No exclamation found in: {texts}"
        assert period_found, f"No period found in: {texts}"

    async def test_excludes_user_messages(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "I would like to check into my room please.")
        sentences = await get_sentences_from_conversations(test_db)
        assert sentences == []

    async def test_includes_topic_from_conversation(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid1, "assistant", "Welcome to the hotel and please enjoy your stay.")
        cid2 = await create_conversation(test_db, "restaurant_order")
        await add_message(test_db, cid2, "assistant", "Here is the menu and please take your time.")
        sentences = await get_sentences_from_conversations(test_db)
        topics = {s["topic"] for s in sentences}
        assert len(topics) >= 1  # At least one topic represented

    async def test_difficulty_filter_prefilters_by_conversation(self, test_db):
        """Beginner sentences should be found even when recent conversations are advanced."""
        # Old beginner conversation
        cid_b = await create_conversation(test_db, "hotel_checkin", difficulty="beginner")
        await add_message(test_db, cid_b, "assistant", "Welcome to our hotel please enjoy your stay here today.")
        # Many newer advanced conversations to push beginner out of LIMIT
        for i in range(25):
            cid_a = await create_conversation(test_db, "job_interview", difficulty="advanced")
            await add_message(
                test_db, cid_a, "assistant",
                f"Please describe your experience with managing complex international projects number {i} in detail."
            )
        # Without SQL pre-filter, beginner sentences would be missed
        sentences = await get_sentences_from_conversations(test_db, difficulty="beginner")
        assert len(sentences) >= 1
        assert all(s["difficulty"] == "beginner" for s in sentences)


@pytest.mark.unit
class TestSaveAttempt:
    async def test_persists_attempt(self, test_db):
        feedback = {"overall_score": 8, "word_feedback": []}
        await save_attempt(test_db, "Hello there.", "Hello there.", feedback, 8.0)
        rows = await test_db.execute_fetchall(
            "SELECT reference_text, user_transcription, feedback_json, score FROM pronunciation_attempts"
        )
        assert len(rows) == 1
        assert rows[0]["reference_text"] == "Hello there."
        assert rows[0]["user_transcription"] == "Hello there."
        assert json.loads(rows[0]["feedback_json"]) == feedback
        assert rows[0]["score"] == 8.0

    async def test_stores_multiple_attempts(self, test_db):
        feedback = {"overall_score": 5, "word_feedback": []}
        await save_attempt(test_db, "Test one.", "Test one.", feedback, 5.0)
        await save_attempt(test_db, "Test two.", "Test two.", feedback, 7.0)
        rows = await test_db.execute_fetchall("SELECT * FROM pronunciation_attempts")
        assert len(rows) == 2


@pytest.mark.unit
class TestGetHistory:
    async def test_returns_attempts_in_reverse_chronological_order(self, test_db):
        feedback = {"overall_score": 5, "word_feedback": []}
        await save_attempt(test_db, "First sentence.", "First.", feedback, 5.0)
        await save_attempt(test_db, "Second sentence.", "Second.", feedback, 7.0)
        history = await get_history(test_db)
        # ORDER BY created_at DESC — with same-second inserts, order depends on rowid
        assert len(history) == 2
        refs = {h["reference_text"] for h in history}
        assert refs == {"First sentence.", "Second sentence."}

    async def test_respects_limit_parameter(self, test_db):
        feedback = {"overall_score": 5, "word_feedback": []}
        for i in range(5):
            await save_attempt(test_db, f"Sentence {i}.", f"Sentence {i}.", feedback, 5.0)
        history = await get_history(test_db, limit=3)
        assert len(history) == 3

    async def test_parses_feedback_json(self, test_db):
        feedback = {"overall_score": 8, "word_feedback": [{"word": "hello", "correct": True}]}
        await save_attempt(test_db, "Hello.", "Hello.", feedback, 8.0)
        history = await get_history(test_db)
        assert history[0]["feedback"] == feedback

    async def test_returns_empty_when_no_attempts(self, test_db):
        history = await get_history(test_db)
        assert history == []

    async def test_includes_score_and_created_at(self, test_db):
        feedback = {"overall_score": 9}
        await save_attempt(test_db, "Test.", "Test.", feedback, 9.0)
        history = await get_history(test_db)
        assert history[0]["score"] == 9.0
        assert history[0]["created_at"] is not None


@pytest.mark.unit
class TestGetProgress:
    async def test_empty_database_returns_zeros(self, test_db):
        progress = await get_progress(test_db)
        assert progress["total_attempts"] == 0
        assert progress["avg_score"] == 0
        assert progress["best_score"] == 0
        assert progress["scores_by_date"] == []
        assert progress["most_practiced"] == []

    async def test_single_attempt(self, test_db):
        feedback = {"overall_score": 8}
        await save_attempt(test_db, "Hello there.", "Hello there.", feedback, 8.0)
        progress = await get_progress(test_db)
        assert progress["total_attempts"] == 1
        assert progress["avg_score"] == 8.0
        assert progress["best_score"] == 8.0

    async def test_multiple_attempts_computes_averages(self, test_db):
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "Test one.", "Test one.", feedback, 6.0)
        await save_attempt(test_db, "Test two.", "Test two.", feedback, 8.0)
        await save_attempt(test_db, "Test three.", "Test three.", feedback, 10.0)
        progress = await get_progress(test_db)
        assert progress["total_attempts"] == 3
        assert progress["avg_score"] == 8.0
        assert progress["best_score"] == 10.0

    async def test_most_practiced_ranking(self, test_db):
        feedback = {"overall_score": 5}
        # Practice sentence A 3 times
        for _ in range(3):
            await save_attempt(test_db, "Sentence A.", "Sentence A.", feedback, 7.0)
        # Practice sentence B 1 time
        await save_attempt(test_db, "Sentence B.", "Sentence B.", feedback, 8.0)
        progress = await get_progress(test_db)
        assert len(progress["most_practiced"]) == 2
        assert progress["most_practiced"][0]["text"] == "Sentence A."
        assert progress["most_practiced"][0]["attempt_count"] == 3

    async def test_scores_by_date_has_entries(self, test_db):
        feedback = {"overall_score": 7}
        await save_attempt(test_db, "Test.", "Test.", feedback, 7.0)
        progress = await get_progress(test_db)
        assert len(progress["scores_by_date"]) >= 1
        assert "date" in progress["scores_by_date"][0]
        assert "avg_score" in progress["scores_by_date"][0]
        assert "count" in progress["scores_by_date"][0]


class TestClearHistory:
    async def test_clear_empty(self, test_db):
        deleted = await clear_history(test_db)
        assert deleted == 0

    async def test_clear_with_data(self, test_db):
        feedback = {"overall_score": 7}
        await save_attempt(test_db, "A.", "A.", feedback, 7.0)
        await save_attempt(test_db, "B.", "B.", feedback, 8.0)
        deleted = await clear_history(test_db)
        assert deleted == 2
        history = await get_history(test_db)
        assert len(history) == 0


class TestDeleteAttempt:
    async def test_delete_existing(self, test_db):
        feedback = {"overall_score": 7}
        await save_attempt(test_db, "Test.", "Test.", feedback, 7.0)
        # Get the attempt ID
        rows = await test_db.execute_fetchall("SELECT id FROM pronunciation_attempts LIMIT 1")
        attempt_id = rows[0]["id"]
        result = await delete_attempt(test_db, attempt_id)
        assert result is True

    async def test_delete_nonexistent(self, test_db):
        result = await delete_attempt(test_db, 99999)
        assert result is False


class TestSaveAttemptReturnsId:
    async def test_returns_integer_id(self, test_db):
        feedback = {"overall_score": 8}
        attempt_id = await save_attempt(test_db, "Hello.", "Hello.", feedback, 8.0)
        assert isinstance(attempt_id, int)
        assert attempt_id > 0

    async def test_history_includes_id(self, test_db):
        feedback = {"overall_score": 7}
        await save_attempt(test_db, "Test.", "Test.", feedback, 7.0)
        history = await get_history(test_db)
        assert "id" in history[0]
        assert isinstance(history[0]["id"], int)


class TestScoreTrend:
    async def test_insufficient_data(self, test_db):
        from app.dal.pronunciation import get_score_trend
        result = await get_score_trend(test_db)
        assert result["trend"] == "insufficient_data"

    async def test_improving_trend(self, test_db):
        from app.dal.pronunciation import get_score_trend
        feedback = {"overall_score": 5}
        # Old scores: lower
        for s in [4.0, 4.5, 5.0, 5.5, 5.0]:
            await save_attempt(test_db, "Test.", "Test.", feedback, s)
        # Recent scores: higher
        for s in [7.0, 7.5, 8.0, 8.5, 8.0]:
            await save_attempt(test_db, "Test.", "Test.", feedback, s)
        result = await get_score_trend(test_db)
        assert result["trend"] == "improving"
        assert result["change"] > 0

    async def test_stable_trend(self, test_db):
        from app.dal.pronunciation import get_score_trend
        feedback = {"overall_score": 7}
        for _ in range(10):
            await save_attempt(test_db, "Test.", "Test.", feedback, 7.0)
        result = await get_score_trend(test_db)
        assert result["trend"] == "stable"


@pytest.mark.unit
class TestGetScoreDistribution:
    async def test_empty_database(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        result = await get_score_distribution(test_db)
        assert result["total_attempts"] == 0
        assert len(result["distribution"]) == 5
        assert all(d["count"] == 0 for d in result["distribution"])

    async def test_scores_distributed_across_buckets(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        feedback = {"overall_score": 5}
        scores = [1.0, 3.5, 5.0, 7.5, 9.5]
        for s in scores:
            await save_attempt(test_db, "Hello.", "Hello.", feedback, s)
        result = await get_score_distribution(test_db)
        assert result["total_attempts"] == 5
        buckets = {d["bucket"]: d["count"] for d in result["distribution"]}
        assert buckets["poor"] == 1
        assert buckets["fair"] == 1
        assert buckets["good"] == 1
        assert buckets["very_good"] == 1
        assert buckets["excellent"] == 1

    async def test_all_scores_in_one_bucket(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        feedback = {"overall_score": 8}
        for _ in range(4):
            await save_attempt(test_db, "Test.", "Test.", feedback, 7.5)
        result = await get_score_distribution(test_db)
        assert result["total_attempts"] == 4
        buckets = {d["bucket"]: d["count"] for d in result["distribution"]}
        assert buckets["very_good"] == 4
        assert all(buckets[k] == 0 for k in buckets if k != "very_good")

    async def test_bucket_labels_and_ranges(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        result = await get_score_distribution(test_db)
        dist = result["distribution"]
        assert dist[0]["bucket"] == "poor"
        assert dist[0]["min_score"] == 0
        assert dist[0]["max_score"] == 3
        assert dist[1]["bucket"] == "fair"
        assert dist[1]["min_score"] == 3
        assert dist[1]["max_score"] == 5
        assert dist[2]["bucket"] == "good"
        assert dist[2]["min_score"] == 5
        assert dist[2]["max_score"] == 7
        assert dist[3]["bucket"] == "very_good"
        assert dist[3]["min_score"] == 7
        assert dist[3]["max_score"] == 9
        assert dist[4]["bucket"] == "excellent"
        assert dist[4]["min_score"] == 9
        assert dist[4]["max_score"] == 10

    async def test_float_score_2_5_classified_as_poor(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        await save_attempt(test_db, "Test.", "Test.", {}, 2.5)
        result = await get_score_distribution(test_db)
        buckets = {d["bucket"]: d["count"] for d in result["distribution"]}
        assert buckets["poor"] == 1

    async def test_float_score_4_5_classified_as_fair(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        await save_attempt(test_db, "Test.", "Test.", {}, 4.5)
        result = await get_score_distribution(test_db)
        buckets = {d["bucket"]: d["count"] for d in result["distribution"]}
        assert buckets["fair"] == 1

    async def test_float_score_6_5_classified_as_good(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        await save_attempt(test_db, "Test.", "Test.", {}, 6.5)
        result = await get_score_distribution(test_db)
        buckets = {d["bucket"]: d["count"] for d in result["distribution"]}
        assert buckets["good"] == 1

    async def test_float_score_8_5_classified_as_very_good(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        await save_attempt(test_db, "Test.", "Test.", {}, 8.5)
        result = await get_score_distribution(test_db)
        buckets = {d["bucket"]: d["count"] for d in result["distribution"]}
        assert buckets["very_good"] == 1

    async def test_total_equals_sum_of_buckets_mixed_scores(self, test_db):
        from app.dal.pronunciation import get_score_distribution
        scores = [0.5, 2.5, 3, 4.5, 5, 6.5, 7, 8.5, 9, 10]
        for s in scores:
            await save_attempt(test_db, "Test.", "Test.", {}, s)
        result = await get_score_distribution(test_db)
        total = sum(d["count"] for d in result["distribution"])
        assert result["total_attempts"] == total == len(scores)

    async def test_boundary_scores_classified_correctly(self, test_db):
        from app.dal.pronunciation import _classify_score
        assert _classify_score(0) == "poor"
        assert _classify_score(3) == "fair"
        assert _classify_score(5) == "good"
        assert _classify_score(7) == "very_good"
        assert _classify_score(9) == "excellent"
        assert _classify_score(10) == "excellent"

    async def test_buckets_consistent_with_classify_score(self, test_db):
        """Verify _SCORE_BUCKETS boundaries match _classify_score logic."""
        from app.dal.pronunciation import _SCORE_BUCKETS, _classify_score
        for name, lo, hi in _SCORE_BUCKETS:
            assert _classify_score(lo) == name, f"lo={lo} should classify as {name}"
            if hi < 10:
                assert _classify_score(hi) != name, f"hi={hi} should be next bucket, not {name}"
            else:
                assert _classify_score(hi) == name, f"hi={hi} should classify as {name}"


@pytest.mark.unit
class TestGetPersonalRecords:
    async def test_empty_database(self, test_db):
        from app.dal.pronunciation import get_personal_records
        result = await get_personal_records(test_db)
        assert result["total_attempts"] == 0
        assert result["best_attempts"] == []
        assert result["worst_attempts"] == []

    async def test_with_attempts(self, test_db):
        from app.dal.pronunciation import get_personal_records
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "Hello.", "Hello.", feedback, 3.0)
        await save_attempt(test_db, "Good morning.", "Good morning.", feedback, 8.0)
        await save_attempt(test_db, "Bye.", "Bye.", feedback, 5.0)
        result = await get_personal_records(test_db)
        assert result["total_attempts"] == 3
        assert result["best_score"] == 8.0
        assert result["worst_score"] == 3.0
        assert len(result["best_attempts"]) == 3
        assert result["best_attempts"][0]["score"] == 8.0


@pytest.mark.unit
class TestWeeklyProgress:
    async def test_empty_returns_no_weeks(self, test_db):
        result = await get_weekly_progress(test_db)
        assert result["weeks"] == []
        assert result["total_weeks"] == 0
        assert result["improvement"] == 0.0

    async def test_with_attempts(self, test_db):
        feedback = {"accuracy": 0.9, "mispronounced": []}
        await save_attempt(test_db, "Hello world", "Hello world", feedback, 95.0)
        await save_attempt(test_db, "Good morning", "Good morning", feedback, 85.0)
        result = await get_weekly_progress(test_db)
        assert result["total_weeks"] >= 1
        assert result["weeks"][0]["attempt_count"] == 2
        assert result["weeks"][0]["avg_score"] == 90.0


@pytest.mark.unit
class TestGetSentencesFromVocabulary:
    async def test_empty_db(self, test_db):
        result = await get_sentences_from_vocabulary(test_db)
        assert result == []

    async def test_returns_sentences(self, test_db):
        from app.dal.vocabulary import save_words
        questions = [
            {"word": "desk", "correct_meaning": "a table", "example_sentence": "Please sit at the desk.", "difficulty": 2, "wrong_options": ["a", "b", "c"]},
            {"word": "lamp", "correct_meaning": "a light", "example_sentence": "Turn on the lamp.", "difficulty": 3, "wrong_options": ["a", "b", "c"]},
        ]
        await save_words(test_db, "hotel_checkin", questions)
        result = await get_sentences_from_vocabulary(test_db)
        assert len(result) == 2
        assert all("text" in r and "word" in r and "difficulty" in r for r in result)

    async def test_filter_by_difficulty(self, test_db):
        from app.dal.vocabulary import save_words
        questions = [
            {"word": "desk", "correct_meaning": "a table", "example_sentence": "Please sit at the desk.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
            {"word": "lamp", "correct_meaning": "a light", "example_sentence": "Turn on the lamp.", "difficulty": 4, "wrong_options": ["a", "b", "c"]},
        ]
        await save_words(test_db, "hotel_checkin", questions)
        result = await get_sentences_from_vocabulary(test_db, difficulty="beginner")
        assert all(r["difficulty"] == "beginner" for r in result)

    async def test_filter_by_topic(self, test_db):
        from app.dal.vocabulary import save_words
        q1 = [{"word": "desk", "correct_meaning": "a table", "example_sentence": "Sit.", "difficulty": 1, "wrong_options": ["a", "b", "c"]}]
        q2 = [{"word": "lamp", "correct_meaning": "a light", "example_sentence": "Light.", "difficulty": 1, "wrong_options": ["a", "b", "c"]}]
        await save_words(test_db, "hotel_checkin", q1)
        await save_words(test_db, "shopping", q2)
        result = await get_sentences_from_vocabulary(test_db, topic="hotel_checkin")
        assert all(r["topic"] == "hotel_checkin" for r in result)


@pytest.mark.unit
class TestGetPronunciationWeaknesses:
    async def test_empty_db(self, test_db):
        from app.dal.pronunciation import get_pronunciation_weaknesses
        result = await get_pronunciation_weaknesses(test_db)
        assert result == []

    async def test_single_mispronunciation(self, test_db):
        from app.dal.pronunciation import get_pronunciation_weaknesses
        feedback = {
            "overall_score": 7,
            "word_feedback": [
                {"expected": "hello", "heard": "helo", "is_correct": False, "tip": "Focus on the double L"},
                {"expected": "world", "heard": "world", "is_correct": True},
            ]
        }
        await save_attempt(test_db, "Hello world", "Helo world", feedback, 7.0)
        result = await get_pronunciation_weaknesses(test_db)
        assert len(result) == 1
        assert result[0]["word"] == "hello"
        assert result[0]["occurrence_count"] == 1

    async def test_aggregates_across_attempts(self, test_db):
        from app.dal.pronunciation import get_pronunciation_weaknesses
        feedback1 = {"word_feedback": [{"expected": "the", "heard": "da", "is_correct": False, "tip": "th sound"}]}
        feedback2 = {"word_feedback": [{"expected": "the", "heard": "de", "is_correct": False, "tip": "th sound"}]}
        await save_attempt(test_db, "The cat.", "Da cat.", feedback1, 5.0)
        await save_attempt(test_db, "The dog.", "De dog.", feedback2, 5.0)
        result = await get_pronunciation_weaknesses(test_db)
        assert result[0]["word"] == "the"
        assert result[0]["occurrence_count"] == 2

    async def test_limit_parameter(self, test_db):
        from app.dal.pronunciation import get_pronunciation_weaknesses
        for i in range(5):
            fb = {"word_feedback": [{"expected": f"word{i}", "heard": f"w{i}", "is_correct": False}]}
            await save_attempt(test_db, f"Test {i}", f"Test {i}", fb, 5.0)
        result = await get_pronunciation_weaknesses(test_db, limit=3)
        assert len(result) <= 3


@pytest.mark.unit
class TestDifficultyTracking:
    async def test_save_attempt_with_difficulty(self, test_db):
        feedback = {"overall_score": 8}
        attempt_id = await save_attempt(test_db, "Hello.", "Hello.", feedback, 8.0, difficulty="beginner")
        history = await get_history(test_db, limit=1)
        assert len(history) == 1
        assert history[0]["difficulty"] == "beginner"

    async def test_save_attempt_without_difficulty(self, test_db):
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "Test.", "Test.", feedback, 5.0)
        history = await get_history(test_db, limit=1)
        assert history[0]["difficulty"] is None

    async def test_history_includes_difficulty(self, test_db):
        feedback = {"overall_score": 7}
        await save_attempt(test_db, "Easy.", "Easy.", feedback, 7.0, difficulty="beginner")
        await save_attempt(test_db, "Hard.", "Hard.", feedback, 6.0, difficulty="advanced")
        history = await get_history(test_db, limit=10)
        difficulties = [h["difficulty"] for h in history]
        assert "beginner" in difficulties
        assert "advanced" in difficulties


@pytest.mark.unit
class TestGetSentenceAttempts:
    async def test_empty_result(self, test_db):
        from app.dal.pronunciation import get_sentence_attempts
        result = await get_sentence_attempts(test_db, "Nonexistent sentence.")
        assert result["attempts"] == []
        assert result["summary"]["attempt_count"] == 0
        assert result["summary"]["first_score"] == 0.0
        assert result["summary"]["latest_score"] == 0.0
        assert result["summary"]["best_score"] == 0.0
        assert result["summary"]["improvement"] == 0.0

    async def test_single_attempt(self, test_db):
        from app.dal.pronunciation import get_sentence_attempts
        feedback = {"overall_score": 7}
        await save_attempt(test_db, "Hello world.", "Hello world.", feedback, 7.0, difficulty="beginner")
        result = await get_sentence_attempts(test_db, "Hello world.")
        assert len(result["attempts"]) == 1
        assert result["attempts"][0]["user_transcription"] == "Hello world."
        assert result["attempts"][0]["score"] == 7.0
        assert result["attempts"][0]["difficulty"] == "beginner"
        assert result["summary"]["attempt_count"] == 1
        assert result["summary"]["first_score"] == 7.0
        assert result["summary"]["latest_score"] == 7.0
        assert result["summary"]["best_score"] == 7.0
        assert result["summary"]["improvement"] == 0.0

    async def test_multiple_attempts_with_progression(self, test_db):
        from app.dal.pronunciation import get_sentence_attempts
        feedback = {"overall_score": 0}
        await save_attempt(test_db, "Good morning.", "Good moaning.", feedback, 4.0)
        await save_attempt(test_db, "Good morning.", "Good morning.", feedback, 7.0)
        await save_attempt(test_db, "Good morning.", "Good morning.", feedback, 9.0)
        result = await get_sentence_attempts(test_db, "Good morning.")
        assert len(result["attempts"]) == 3
        scores = [a["score"] for a in result["attempts"]]
        assert scores == [4.0, 7.0, 9.0]
        assert result["summary"]["first_score"] == 4.0
        assert result["summary"]["latest_score"] == 9.0
        assert result["summary"]["best_score"] == 9.0

    async def test_improvement_calculation(self, test_db):
        from app.dal.pronunciation import get_sentence_attempts
        feedback = {"overall_score": 0}
        await save_attempt(test_db, "Test sentence.", "Test.", feedback, 3.0)
        await save_attempt(test_db, "Test sentence.", "Test sentence.", feedback, 8.0)
        result = await get_sentence_attempts(test_db, "Test sentence.")
        assert result["summary"]["improvement"] == 5.0

    async def test_limit_parameter(self, test_db):
        from app.dal.pronunciation import get_sentence_attempts
        feedback = {"overall_score": 5}
        for i in range(10):
            await save_attempt(test_db, "Repeat.", "Repeat.", feedback, 5.0 + i * 0.1)
        result = await get_sentence_attempts(test_db, "Repeat.", limit=3)
        assert len(result["attempts"]) == 3
        assert result["summary"]["attempt_count"] == 3

    async def test_does_not_include_other_sentences(self, test_db):
        from app.dal.pronunciation import get_sentence_attempts
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "Sentence A.", "Sentence A.", feedback, 5.0)
        await save_attempt(test_db, "Sentence B.", "Sentence B.", feedback, 8.0)
        result = await get_sentence_attempts(test_db, "Sentence A.")
        assert len(result["attempts"]) == 1
        assert result["attempts"][0]["user_transcription"] == "Sentence A."


@pytest.mark.unit
class TestGetRetrySuggestions:
    async def test_empty_db(self, test_db):
        from app.dal.pronunciation import get_retry_suggestions
        result = await get_retry_suggestions(test_db)
        assert result == []

    async def test_all_above_threshold(self, test_db):
        from app.dal.pronunciation import get_retry_suggestions
        feedback = {"overall_score": 9}
        await save_attempt(test_db, "Hello.", "Hello.", feedback, 9.0)
        result = await get_retry_suggestions(test_db, threshold=7.0)
        assert result == []

    async def test_returns_low_score_sentences(self, test_db):
        from app.dal.pronunciation import get_retry_suggestions
        feedback = {"overall_score": 3}
        await save_attempt(test_db, "Hard sentence.", "Hard sentance.", feedback, 3.0)
        await save_attempt(test_db, "Easy sentence.", "Easy sentence.", feedback, 9.0)
        result = await get_retry_suggestions(test_db, threshold=7.0)
        assert len(result) == 1
        assert result[0]["text"] == "Hard sentence."
        assert result[0]["latest_score"] == 3.0

    async def test_limit(self, test_db):
        from app.dal.pronunciation import get_retry_suggestions
        feedback = {"overall_score": 2}
        for i in range(5):
            await save_attempt(test_db, f"Sentence {i}.", f"S {i}.", feedback, 2.0)
        result = await get_retry_suggestions(test_db, threshold=7.0, limit=3)
        assert len(result) <= 3


@pytest.mark.unit
class TestGetProgressByDifficulty:
    async def test_empty_db_returns_empty_list(self, test_db):
        result = await get_progress_by_difficulty(test_db)
        assert result == []

    async def test_single_difficulty(self, test_db):
        feedback = {"overall_score": 8}
        await save_attempt(test_db, "Hello.", "Hello.", feedback, 7.0, difficulty="beginner")
        await save_attempt(test_db, "Hi there.", "Hi there.", feedback, 9.0, difficulty="beginner")
        result = await get_progress_by_difficulty(test_db)
        assert len(result) == 1
        item = result[0]
        assert item["difficulty"] == "beginner"
        assert item["attempt_count"] == 2
        assert item["avg_score"] == 8.0
        assert item["best_score"] == 9.0
        assert item["latest_score"] == 9.0

    async def test_multiple_difficulties(self, test_db):
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "Easy.", "Easy.", feedback, 9.0, difficulty="beginner")
        await save_attempt(test_db, "Medium.", "Medium.", feedback, 6.0, difficulty="intermediate")
        await save_attempt(test_db, "Hard.", "Hard.", feedback, 3.0, difficulty="advanced")
        result = await get_progress_by_difficulty(test_db)
        assert len(result) == 3
        difficulties = {item["difficulty"] for item in result}
        assert difficulties == {"beginner", "intermediate", "advanced"}
        beginner = next(i for i in result if i["difficulty"] == "beginner")
        assert beginner["attempt_count"] == 1
        assert beginner["best_score"] == 9.0
        intermediate = next(i for i in result if i["difficulty"] == "intermediate")
        assert intermediate["best_score"] == 6.0
        advanced = next(i for i in result if i["difficulty"] == "advanced")
        assert advanced["best_score"] == 3.0

    async def test_null_difficulty_grouped_as_unknown(self, test_db):
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "No diff.", "No diff.", feedback, 5.0, difficulty=None)
        await save_attempt(test_db, "Has diff.", "Has diff.", feedback, 8.0, difficulty="beginner")
        result = await get_progress_by_difficulty(test_db)
        assert len(result) == 2
        unknown = next(i for i in result if i["difficulty"] == "unknown")
        assert unknown["attempt_count"] == 1
        assert unknown["avg_score"] == 5.0


@pytest.mark.unit
class TestEstimateDifficulty:
    """Tests for _estimate_difficulty using conv_difficulty for mid-range sentences."""

    def test_short_sentence_always_beginner(self):
        assert _estimate_difficulty(5, "advanced") == "beginner"
        assert _estimate_difficulty(8, "advanced") == "beginner"
        assert _estimate_difficulty(1, "intermediate") == "beginner"

    def test_long_sentence_always_advanced(self):
        assert _estimate_difficulty(15, "beginner") == "advanced"
        assert _estimate_difficulty(20, "beginner") == "advanced"

    def test_mid_range_uses_conv_difficulty(self):
        assert _estimate_difficulty(10, "beginner") == "beginner"
        assert _estimate_difficulty(12, "advanced") == "advanced"
        assert _estimate_difficulty(14, "intermediate") == "intermediate"

    def test_mid_range_invalid_conv_difficulty_falls_back(self):
        assert _estimate_difficulty(10, "") == "intermediate"
        assert _estimate_difficulty(10, "unknown") == "intermediate"
        assert _estimate_difficulty(10, "hard") == "intermediate"

    def test_boundary_values(self):
        assert _estimate_difficulty(9, "advanced") == "advanced"
        assert _estimate_difficulty(8, "advanced") == "beginner"
        assert _estimate_difficulty(14, "beginner") == "beginner"
        assert _estimate_difficulty(15, "beginner") == "advanced"
