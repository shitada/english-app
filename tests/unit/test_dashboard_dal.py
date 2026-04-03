"""Unit tests for the dashboard DAL (app/dal/dashboard.py)."""

from __future__ import annotations

import pytest

from app.dal.conversation import add_message, create_conversation
from app.dal.dashboard import (
    delete_learning_goal,
    get_learning_goals,
    get_learning_insights,
    get_learning_summary,
    get_stats,
    set_learning_goal,
)
from app.dal.pronunciation import save_attempt
from app.dal.vocabulary import save_words, update_progress


@pytest.mark.unit
class TestGetStats:
    async def test_empty_database(self, test_db):
        stats = await get_stats(test_db)
        assert stats["total_conversations"] == 0
        assert stats["total_messages"] == 0
        assert stats["total_pronunciation"] == 0
        assert stats["avg_pronunciation_score"] == 0
        assert stats["total_vocab_reviewed"] == 0
        assert stats["vocab_mastered"] == 0
        assert stats["streak"] == 0
        assert stats["recent_activity"] == []

    async def test_counts_conversations(self, test_db):
        await create_conversation(test_db, "hotel_checkin")
        await create_conversation(test_db, "shopping")
        stats = await get_stats(test_db)
        assert stats["total_conversations"] == 2

    async def test_counts_user_messages_only(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello")
        await add_message(test_db, cid, "assistant", "Welcome!")
        await add_message(test_db, cid, "user", "I need a room")
        stats = await get_stats(test_db)
        assert stats["total_messages"] == 2  # Only user messages

    async def test_counts_pronunciation_attempts(self, test_db):
        feedback = {"overall_score": 7}
        await save_attempt(test_db, "Hello.", "Hello.", feedback, 7.0)
        await save_attempt(test_db, "Goodbye.", "Goodbye.", feedback, 8.0)
        stats = await get_stats(test_db)
        assert stats["total_pronunciation"] == 2
        assert stats["avg_pronunciation_score"] == 7.5

    async def test_counts_vocabulary_progress(self, test_db):
        questions = [
            {"word": "hello", "correct_meaning": "greeting"},
            {"word": "goodbye", "correct_meaning": "farewell"},
            {"word": "thanks", "correct_meaning": "gratitude"},
        ]
        words = await save_words(test_db, "hotel_checkin", questions)
        # First two have progress, one is mastered (level >= 3)
        await update_progress(test_db, words[0]["id"], True)  # level 1
        await update_progress(test_db, words[1]["id"], True)  # level 1
        for _ in range(3):
            await update_progress(test_db, words[1]["id"], True)  # level 4
        stats = await get_stats(test_db)
        assert stats["total_vocab_reviewed"] == 2
        assert stats["vocab_mastered"] == 1

    async def test_recent_activity_includes_conversations_and_pronunciation(self, test_db):
        await create_conversation(test_db, "hotel_checkin")
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "Test.", "Test.", feedback, 5.0)
        stats = await get_stats(test_db)
        types = {a["type"] for a in stats["recent_activity"]}
        assert "conversation" in types
        assert "pronunciation" in types

    async def test_recent_activity_limited_to_7(self, test_db):
        for i in range(10):
            await create_conversation(test_db, f"topic_{i}")
        stats = await get_stats(test_db)
        assert len(stats["recent_activity"]) <= 7

    async def test_recent_activity_includes_vocabulary(self, test_db):
        questions = [{"word": "hello", "correct_meaning": "greeting"}]
        words = await save_words(test_db, "hotel_checkin", questions)
        await update_progress(test_db, words[0]["id"], True)
        stats = await get_stats(test_db)
        types = {a["type"] for a in stats["recent_activity"]}
        assert "vocabulary" in types

    async def test_streak_includes_vocabulary_only_days(self, test_db):
        """Vocabulary-only activity should count toward the streak."""
        questions = [{"word": "hello", "correct_meaning": "greeting"}]
        words = await save_words(test_db, "hotel_checkin", questions)
        await update_progress(test_db, words[0]["id"], True)
        stats = await get_stats(test_db)
        assert stats["streak"] >= 1

    async def test_vocab_due_count_empty(self, test_db):
        stats = await get_stats(test_db)
        assert stats["vocab_due_count"] == 0

    async def test_vocab_due_count_with_due_words(self, test_db):
        """Words answered incorrectly (level 0, interval 0) should be immediately due."""
        questions = [{"word": "test", "correct_meaning": "exam"}]
        words = await save_words(test_db, "study", questions)
        await update_progress(test_db, words[0]["id"], False)
        stats = await get_stats(test_db)
        assert stats["vocab_due_count"] >= 1

    async def test_vocab_due_count_includes_null_next_review_at(self, test_db):
        """Words with NULL next_review_at should be counted as due."""
        questions = [{"word": "nullword", "correct_meaning": "test"}]
        words = await save_words(test_db, "study", questions)
        await test_db.execute(
            "INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, level, next_review_at) VALUES (?, 0, 0, 0, NULL)",
            (words[0]["id"],),
        )
        await test_db.commit()
        stats = await get_stats(test_db)
        assert stats["vocab_due_count"] >= 1

    async def test_streak_uses_quiz_attempts_not_last_reviewed(self, test_db):
        """Re-reviewing a word should not erase original day from streak."""
        questions = [{"word": "streak", "correct_meaning": "test"}]
        words = await save_words(test_db, "study", questions)
        wid = words[0]["id"]
        # First review: today
        await update_progress(test_db, wid, True)
        stats = await get_stats(test_db)
        assert stats["streak"] >= 1
        # Verify quiz_attempts has records
        rows = await test_db.execute_fetchall(
            "SELECT COUNT(*) as cnt FROM quiz_attempts WHERE word_id = ?", (wid,)
        )
        assert rows[0]["cnt"] >= 1


class TestConversationsByDifficulty:
    async def test_empty(self, test_db):
        from app.dal.dashboard import get_conversations_by_difficulty
        result = await get_conversations_by_difficulty(test_db)
        assert result == []

    async def test_with_conversations(self, test_db):
        from app.dal.conversation import create_conversation
        from app.dal.dashboard import get_conversations_by_difficulty
        await create_conversation(test_db, "hotel_checkin", "beginner")
        await create_conversation(test_db, "shopping", "beginner")
        await create_conversation(test_db, "airport", "advanced")
        result = await get_conversations_by_difficulty(test_db)
        assert len(result) == 2
        # beginner has 2, should be first (ordered by count DESC)
        assert result[0]["difficulty"] == "beginner"
        assert result[0]["count"] == 2
        assert result[1]["difficulty"] == "advanced"
        assert result[1]["count"] == 1


class TestGrammarStats:
    async def test_empty(self, test_db):
        from app.dal.dashboard import get_grammar_stats
        result = await get_grammar_stats(test_db)
        assert result["total_checked"] == 0
        assert result["grammar_accuracy"] == 0

    async def test_with_feedback(self, test_db):
        from app.dal.conversation import add_message, create_conversation
        from app.dal.dashboard import get_grammar_stats
        cid = await create_conversation(test_db, "hotel_checkin")
        # Message with no errors (is_correct=true)
        await add_message(test_db, cid, "user", "Hello", feedback={"is_correct": True, "errors": [], "suggestions": []})
        # Message with errors (is_correct=false)
        await add_message(test_db, cid, "user", "I go yesterday", feedback={"is_correct": False, "errors": [{"original": "go", "correction": "went"}], "suggestions": []})
        result = await get_grammar_stats(test_db)
        assert result["total_checked"] == 2
        assert result["error_free"] == 1
        assert result["grammar_accuracy"] == 50.0

    async def test_is_correct_with_minor_errors(self, test_db):
        """is_correct=true with non-empty errors should count as correct."""
        from app.dal.conversation import add_message, create_conversation
        from app.dal.dashboard import get_grammar_stats
        cid = await create_conversation(test_db, "hotel_checkin")
        # Correct overall but with minor style suggestions
        await add_message(test_db, cid, "user", "I am good", feedback={
            "is_correct": True, "errors": [{"original": "good", "suggestion": "well"}], "suggestions": []
        })
        result = await get_grammar_stats(test_db)
        assert result["error_free"] == 1
        assert result["grammar_accuracy"] == 100.0


class TestVocabLevelDistribution:
    async def test_empty(self, test_db):
        from app.dal.dashboard import get_vocab_level_distribution
        result = await get_vocab_level_distribution(test_db)
        assert result == []

    async def test_with_progress(self, test_db):
        from app.dal.dashboard import get_vocab_level_distribution
        from app.dal.vocabulary import save_words, update_progress
        words = await save_words(test_db, "food", [
            {"word": "a", "correct_meaning": "m", "example_sentence": "s", "difficulty": 1},
            {"word": "b", "correct_meaning": "m", "example_sentence": "s", "difficulty": 1},
            {"word": "c", "correct_meaning": "m", "example_sentence": "s", "difficulty": 1},
        ])
        # Create progress entries by answering
        await update_progress(test_db, words[0]["id"], True)  # level 1
        await update_progress(test_db, words[1]["id"], True)  # level 1
        await update_progress(test_db, words[2]["id"], True)  # level 1
        await update_progress(test_db, words[2]["id"], True)  # level 2
        result = await get_vocab_level_distribution(test_db)
        assert len(result) >= 1


class TestConversationsByTopic:
    async def test_empty(self, test_db):
        from app.dal.dashboard import get_conversations_by_topic
        result = await get_conversations_by_topic(test_db)
        assert result == []

    async def test_with_data(self, test_db):
        from app.dal.conversation import create_conversation
        from app.dal.dashboard import get_conversations_by_topic
        await create_conversation(test_db, "hotel_checkin")
        await create_conversation(test_db, "hotel_checkin")
        await create_conversation(test_db, "shopping")
        result = await get_conversations_by_topic(test_db)
        assert len(result) == 2
        assert result[0]["topic"] == "hotel_checkin"
        assert result[0]["count"] == 2


@pytest.mark.unit
class TestGetDailyActivity:
    async def test_empty_database(self, test_db):
        from app.dal.dashboard import get_daily_activity
        result = await get_daily_activity(test_db, days=7)
        assert isinstance(result, list)
        assert len(result) == 8  # today + 7 past days
        assert all(r["conversations"] == 0 for r in result)
        assert all(r["messages"] == 0 for r in result)

    async def test_with_activity(self, test_db):
        from app.dal.dashboard import get_daily_activity
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello")
        result = await get_daily_activity(test_db, days=1)
        today_entry = result[-1]
        assert today_entry["conversations"] >= 1
        assert today_entry["messages"] >= 1

    async def test_all_dates_present(self, test_db):
        from app.dal.dashboard import get_daily_activity
        result = await get_daily_activity(test_db, days=3)
        assert len(result) == 4
        dates = [r["date"] for r in result]
        assert len(set(dates)) == 4  # all unique


@pytest.mark.unit
class TestStreakMilestones:
    async def test_empty_database(self, test_db):
        from app.dal.dashboard import get_streak_milestones
        result = await get_streak_milestones(test_db)
        assert result["current_streak"] == 0
        assert result["longest_streak"] == 0
        assert len(result["milestones"]) == 5
        assert all(not m["achieved"] for m in result["milestones"])
        assert result["next_milestone"] is not None
        assert result["next_milestone"]["days"] == 7

    async def test_with_activity_today(self, test_db):
        from app.dal.dashboard import get_streak_milestones
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello")
        result = await get_streak_milestones(test_db)
        assert result["current_streak"] >= 1
        assert result["longest_streak"] >= 1

    async def test_longest_streak_calculation(self, test_db):
        from app.dal.dashboard import _calculate_longest_streak
        result = await _calculate_longest_streak(test_db)
        assert isinstance(result, int)
        assert result >= 0


@pytest.mark.unit
class TestConversationDurationStats:
    async def test_empty_database(self, test_db):
        from app.dal.dashboard import get_conversation_duration_stats
        result = await get_conversation_duration_stats(test_db)
        assert result["total_completed"] == 0
        assert result["total_duration_seconds"] == 0
        assert result["duration_by_difficulty"] == []

    async def test_with_ended_conversations(self, test_db):
        from app.dal.conversation import end_conversation
        from app.dal.dashboard import get_conversation_duration_stats
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid)
        result = await get_conversation_duration_stats(test_db)
        assert result["total_completed"] == 1
        assert result["total_duration_seconds"] >= 0

    async def test_excludes_active_conversations(self, test_db):
        from app.dal.dashboard import get_conversation_duration_stats
        await create_conversation(test_db, "hotel_checkin")  # active, not ended
        result = await get_conversation_duration_stats(test_db)
        assert result["total_completed"] == 0


@pytest.mark.unit
class TestLearningGoals:
    async def test_empty_goals(self, test_db):
        result = await get_learning_goals(test_db)
        assert result == []

    async def test_set_and_get_goal(self, test_db):
        goal = await set_learning_goal(test_db, "conversations", 3)
        assert goal["goal_type"] == "conversations"
        assert goal["daily_target"] == 3
        goals = await get_learning_goals(test_db)
        assert len(goals) == 1
        assert goals[0]["daily_target"] == 3
        assert goals[0]["today_count"] == 0
        assert goals[0]["completed"] is False

    async def test_update_existing_goal(self, test_db):
        await set_learning_goal(test_db, "conversations", 3)
        goal = await set_learning_goal(test_db, "conversations", 5)
        assert goal["daily_target"] == 5
        goals = await get_learning_goals(test_db)
        assert len(goals) == 1

    async def test_delete_goal(self, test_db):
        await set_learning_goal(test_db, "conversations", 3)
        assert await delete_learning_goal(test_db, "conversations") is True
        assert await get_learning_goals(test_db) == []

    async def test_delete_nonexistent_goal(self, test_db):
        assert await delete_learning_goal(test_db, "conversations") is False


@pytest.mark.unit
class TestGetLearningInsights:
    async def test_empty_database_defaults(self, test_db):
        """Empty DB returns neutral/default insights."""
        result = await get_learning_insights(test_db)
        assert result["streak"] == 0
        assert result["streak_at_risk"] is False
        assert result["module_strengths"]["conversation"] == 0
        assert result["module_strengths"]["vocabulary"] == 0
        assert result["module_strengths"]["pronunciation"] == 0
        assert result["strongest_area"] is None
        assert result["weakest_area"] is None
        assert result["recommendations"] == []
        assert result["weekly_comparison"]["conversations"]["this_week"] == 0
        assert result["weekly_comparison"]["vocabulary"]["this_week"] == 0
        assert result["weekly_comparison"]["pronunciation"]["this_week"] == 0

    async def test_strongest_weakest_identification(self, test_db):
        """Correctly identifies strongest and weakest areas."""
        # Conversation: add messages with grammar feedback (100% accuracy)
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(
            test_db, cid, "user", "Hello",
            feedback={"is_correct": True, "errors": [], "suggestions": []},
        )

        # Pronunciation: score=3 → strength=30
        await save_attempt(test_db, "Hi.", "Hi.", {"overall_score": 3}, 3.0)

        # Vocabulary: 1 reviewed, 0 mastered → strength=0
        words = await save_words(test_db, "food", [
            {"word": "apple", "correct_meaning": "fruit"},
        ])
        await update_progress(test_db, words[0]["id"], True)  # level 1

        result = await get_learning_insights(test_db)
        assert result["strongest_area"] == "conversation"  # 100%
        assert result["weakest_area"] == "vocabulary"  # 0%
        assert result["module_strengths"]["conversation"] == 100.0
        assert result["module_strengths"]["pronunciation"] == 30.0

    async def test_streak_at_risk_detection(self, test_db):
        """Detects streak at risk when activity was yesterday but not today."""
        # Insert activity dated yesterday only
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-1 day'))",
            ("Hello", "Hello", 8.0),
        )
        await test_db.commit()

        result = await get_learning_insights(test_db)
        assert result["streak_at_risk"] is True
        assert "Complete an activity today to keep your streak" in result["recommendations"]

    async def test_streak_not_at_risk_with_today_activity(self, test_db):
        """No risk when there is activity today."""
        await save_attempt(test_db, "Hi.", "Hi.", {"overall_score": 5}, 5.0)
        result = await get_learning_insights(test_db)
        assert result["streak_at_risk"] is False

    async def test_recommendation_vocab_due(self, test_db):
        """Recommends review when vocabulary words are due."""
        words = await save_words(test_db, "study", [
            {"word": "test", "correct_meaning": "exam"},
        ])
        await update_progress(test_db, words[0]["id"], False)  # level 0, due immediately
        result = await get_learning_insights(test_db)
        due_recs = [r for r in result["recommendations"] if "words due" in r]
        assert len(due_recs) == 1

    async def test_recommendation_low_pronunciation(self, test_db):
        """Recommends pronunciation practice when avg score < 50%."""
        await save_attempt(test_db, "Hello.", "Helo.", {"overall_score": 3}, 3.0)
        result = await get_learning_insights(test_db)
        assert "Try pronunciation retry suggestions to improve" in result["recommendations"]

    async def test_recommendation_no_recent_conversations(self, test_db):
        """Recommends conversation practice when none in 7 days."""
        # Insert an old conversation (>7 days ago) so the user has history
        await test_db.execute(
            "INSERT INTO conversations (topic, started_at) VALUES (?, datetime('now', '-10 days'))",
            ("hotel_checkin",),
        )
        await test_db.commit()
        # Also add pronunciation so there's some current activity
        await save_attempt(test_db, "Hi.", "Hi.", {"overall_score": 8}, 8.0)
        result = await get_learning_insights(test_db)
        assert "Practice a conversation to maintain skills" in result["recommendations"]

    async def test_weekly_comparison_counts(self, test_db):
        """Weekly comparison includes this_week counts."""
        await create_conversation(test_db, "hotel_checkin")
        await save_attempt(test_db, "Hi.", "Hi.", {"overall_score": 7}, 7.0)
        result = await get_learning_insights(test_db)
        assert result["weekly_comparison"]["conversations"]["this_week"] >= 1
        assert result["weekly_comparison"]["pronunciation"]["this_week"] >= 1

    async def test_weekly_comparison_vocabulary_counts_events(self, test_db):
        """Vocabulary weekly count should reflect quiz attempt events, not unique words."""
        from app.dal.vocabulary import log_attempt
        words = await save_words(test_db, "food", _make_questions(1))
        word_id = words[0]["id"]
        # Same word answered 3 times
        for _ in range(3):
            await log_attempt(test_db, word_id, True)
        await test_db.commit()
        result = await get_learning_insights(test_db)
        assert result["weekly_comparison"]["vocabulary"]["this_week"] == 3


def _make_questions(count=1):
    return [
        {"word": f"word_{i}", "correct_meaning": f"m_{i}", "example_sentence": f"Ex {i}.", "difficulty": 1, "wrong_options": ["a", "b", "c"]}
        for i in range(count)
    ]


@pytest.mark.unit
class TestGetLearningSummary:
    async def test_empty_db(self, test_db):
        result = await get_learning_summary(test_db)
        assert result["total_study_days"] == 0
        assert result["words_learning"] == 0
        assert result["total_quiz_attempts"] == 0
        assert result["quiz_accuracy_percent"] == 0

    async def test_study_days_from_messages(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "user", "Hello")
        result = await get_learning_summary(test_db)
        assert result["total_study_days"] >= 1

    async def test_words_learning_count(self, test_db):
        words = await save_words(test_db, "hotel", _make_questions(2))
        await update_progress(test_db, words[0]["id"], is_correct=True)
        result = await get_learning_summary(test_db)
        assert result["words_learning"] == 1  # Only 1 word has level >= 1

    async def test_quiz_accuracy_all_correct(self, test_db):
        words = await save_words(test_db, "hotel", _make_questions(1))
        from app.dal.vocabulary import log_attempt
        await log_attempt(test_db, words[0]["id"], is_correct=True)
        await log_attempt(test_db, words[0]["id"], is_correct=True)
        result = await get_learning_summary(test_db)
        assert result["quiz_accuracy_percent"] == 100.0

    async def test_quiz_accuracy_mixed(self, test_db):
        words = await save_words(test_db, "hotel", _make_questions(1))
        from app.dal.vocabulary import log_attempt
        await log_attempt(test_db, words[0]["id"], is_correct=True)
        await log_attempt(test_db, words[0]["id"], is_correct=False)
        result = await get_learning_summary(test_db)
        assert result["quiz_accuracy_percent"] == 50.0


@pytest.mark.asyncio
@pytest.mark.unit
class TestStreakYesterdayAlive:
    """Verify streak stays alive when last activity was yesterday."""

    async def test_streak_positive_when_activity_yesterday_only(self, test_db):
        """Streak should be >= 1 when activity was yesterday but not today."""
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-1 day'))",
            ("Hello", "Hello", 8.0),
        )
        await test_db.commit()
        stats = await get_stats(test_db)
        assert stats["streak"] >= 1

    async def test_streak_zero_when_activity_two_days_ago(self, test_db):
        """Streak should be 0 when last activity was 2+ days ago."""
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-2 days'))",
            ("Hello", "Hello", 8.0),
        )
        await test_db.commit()
        stats = await get_stats(test_db)
        assert stats["streak"] == 0

    async def test_streak_at_risk_when_no_today_activity(self, test_db):
        """streak_at_risk should be True when streak alive but no activity today."""
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-1 day'))",
            ("Hello", "Hello", 8.0),
        )
        await test_db.commit()
        result = await get_learning_insights(test_db)
        assert result["streak"] >= 1
        assert result["streak_at_risk"] is True

    async def test_multi_day_streak_alive_from_yesterday(self, test_db):
        """Multi-day streak counted back from yesterday when today has no activity."""
        for i in range(1, 4):
            await test_db.execute(
                "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
                "VALUES (?, ?, ?, datetime('now', ? || ' days'))",
                ("Hello", "Hello", 8.0, f"-{i}"),
            )
        await test_db.commit()
        stats = await get_stats(test_db)
        assert stats["streak"] == 3
