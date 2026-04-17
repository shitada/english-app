"""Unit tests for the dashboard DAL (app/dal/dashboard.py)."""

from __future__ import annotations

import pytest

from app.dal.conversation import add_message, create_conversation, end_conversation, update_message_feedback
from app.dal.dashboard import (
    _categorize_error,
    _get_recent_activity,
    delete_learning_goal,
    get_achievements,
    get_confidence_trend,
    get_daily_challenge,
    get_grammar_trend,
    get_grammar_weak_spots,
    get_learning_goals,
    get_learning_insights,
    get_learning_summary,
    get_learning_velocity,
    get_listening_progress,
    get_mistake_journal,
    get_mistake_review_items,
    get_module_streaks,
    get_recent_activity,
    get_self_assessment_trend,
    get_session_analytics,
    get_skill_radar,
    get_stats,
    get_study_plan,
    get_today_activity,
    get_phrase_of_the_day,
    get_vocabulary_activation,
    get_vocabulary_forecast,
    get_fluency_progression,
    get_topic_coverage,
    get_review_queue,
    get_weekly_report,
    get_word_of_the_day,
    set_learning_goal,
)
from app.dal.pronunciation import save_attempt, save_listening_quiz_result
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

    async def test_string_true_is_correct_counted(self, test_db):
        """String 'true' is_correct should count as error_free."""
        from app.dal.conversation import add_message, create_conversation
        from app.dal.dashboard import get_grammar_stats
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello", feedback={"is_correct": "true", "errors": [], "suggestions": []})
        result = await get_grammar_stats(test_db)
        assert result["error_free"] == 1
        assert result["grammar_accuracy"] == 100.0

    async def test_string_false_is_correct_not_counted(self, test_db):
        """String 'false' is_correct should NOT count as error_free."""
        from app.dal.conversation import add_message, create_conversation
        from app.dal.dashboard import get_grammar_stats
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "I go yesterday", feedback={"is_correct": "false", "errors": [], "suggestions": []})
        result = await get_grammar_stats(test_db)
        assert result["error_free"] == 0

    async def test_mixed_bool_and_string(self, test_db):
        """Mix of True, 'true', False, 'false' should give correct accuracy."""
        from app.dal.conversation import add_message, create_conversation
        from app.dal.dashboard import get_grammar_stats
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hi", feedback={"is_correct": True, "errors": [], "suggestions": []})
        await add_message(test_db, cid, "user", "OK", feedback={"is_correct": "true", "errors": [], "suggestions": []})
        await add_message(test_db, cid, "user", "Bad", feedback={"is_correct": False, "errors": [], "suggestions": []})
        await add_message(test_db, cid, "user", "Bad2", feedback={"is_correct": "false", "errors": [], "suggestions": []})
        result = await get_grammar_stats(test_db)
        assert result["total_checked"] == 4
        assert result["error_free"] == 2
        assert result["grammar_accuracy"] == 50.0


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
        assert len(result) == 7  # 7 most recent days including today
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
        assert len(result) == 3
        dates = [r["date"] for r in result]
        assert len(set(dates)) == 3  # all unique


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

    async def test_longest_streak_zero_with_null_dates(self, test_db):
        """Longest streak should be 0 when all dates are unparseable."""
        from app.dal.dashboard import _calculate_longest_streak
        # Insert a message with an unparseable created_at to simulate corrupt data
        cid = await create_conversation(test_db, "hotel_checkin")
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (cid, "user", "corrupt", "not-a-date"),
        )
        await test_db.commit()
        result = await _calculate_longest_streak(test_db)
        assert result == 0


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
        assert result["weekly_comparison"]["listening"]["this_week"] == 0
        assert result["weekly_comparison"]["speaking_journal"]["this_week"] == 0

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

    async def test_equal_strengths_returns_none(self, test_db):
        """When all module strengths are equal, strongest/weakest should be None."""
        # Create identical activity in conversation and pronunciation (vocabulary stays 0)
        # This creates a case where min == max value
        result = await get_learning_insights(test_db)
        # With no data, all strengths are 0 → both None
        assert result["strongest_area"] is None
        assert result["weakest_area"] is None

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

    async def test_weekly_comparison_excludes_old_data(self, test_db):
        """Rows older than 14 days should not appear in either this_week or last_week."""
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, started_at) VALUES (?, ?, datetime('now', '-20 days'))",
            ("hotel_checkin", "beginner"),
        )
        await test_db.commit()
        result = await get_learning_insights(test_db)
        assert result["weekly_comparison"]["conversations"]["this_week"] == 0
        assert result["weekly_comparison"]["conversations"]["last_week"] == 0


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


@pytest.mark.unit
class TestGetTodayActivity:
    async def test_empty_database(self, test_db):
        result = await get_today_activity(test_db)
        assert result == {
            "conversations": 0,
            "vocabulary_reviews": 0,
            "pronunciation_attempts": 0,
            "listening_quizzes": 0,
            "speaking_journal_entries": 0,
        }

    async def test_counts_today_activity(self, test_db):
        # Create a conversation today
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, started_at) VALUES (?, ?, datetime('now'))",
            ("hotel", "intermediate"),
        )
        # Create a pronunciation attempt today
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (?, ?, ?, datetime('now'))",
            ("Hello", "Hello", 9.0),
        )
        # Create a vocabulary word first (needed for FK)
        await test_db.execute(
            "INSERT INTO vocabulary_words (word, meaning, topic) VALUES (?, ?, ?)",
            ("hello", "a greeting", "greetings"),
        )
        # Create a quiz attempt today
        await test_db.execute(
            "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) "
            "VALUES (?, ?, datetime('now'))",
            (1, 1),
        )
        await test_db.commit()
        result = await get_today_activity(test_db)
        assert result["conversations"] == 1
        assert result["pronunciation_attempts"] == 1
        assert result["vocabulary_reviews"] == 1

    async def test_ignores_yesterday_activity(self, test_db):
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, started_at) VALUES (?, ?, datetime('now', '-1 day'))",
            ("restaurant", "beginner"),
        )
        await test_db.commit()
        result = await get_today_activity(test_db)
        assert result["conversations"] == 0


@pytest.mark.unit
class TestGetAchievementsStreakConsistency:
    async def test_achievement_streak_matches_dashboard_streak(self, test_db):
        """Achievements streak should match dashboard streak even with no activity today."""
        from app.dal.dashboard import get_achievements, get_stats

        # Insert user messages on yesterday and day before (consecutive, but not today)
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty) VALUES (?, ?)",
            ("hotel_checkin", "beginner"),
        )
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-1 day'))",
            (1, "user", "hello"),
        )
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-2 days'))",
            (1, "user", "hi"),
        )
        await test_db.commit()

        stats = await get_stats(test_db)
        dashboard_streak = stats["streak"]

        achievements_data = await get_achievements(test_db)
        streak_badges = [a for a in achievements_data["achievements"] if a["id"] == "streak_7"]
        achievement_streak = streak_badges[0]["progress"]["current"] if streak_badges else 0

        assert dashboard_streak == achievement_streak, (
            f"Dashboard streak ({dashboard_streak}) != achievement streak ({achievement_streak})"
        )
        assert dashboard_streak >= 2


@pytest.mark.unit
class TestGetAchievementsVocabMastery:
    async def test_vocab_mastery_threshold_matches_dashboard(self, test_db):
        """Achievements should count vocab as mastered at level >= 3, same as dashboard."""
        from app.dal.dashboard import get_achievements, get_stats

        # Insert a word at level 3 (mastered threshold)
        await test_db.execute(
            "INSERT INTO vocabulary_words (word, meaning, topic) VALUES (?, ?, ?)",
            ("test", "テスト", "daily_life"),
        )
        await test_db.execute(
            "INSERT INTO vocabulary_progress (word_id, level, correct_count, incorrect_count) "
            "VALUES (?, ?, ?, ?)",
            (1, 3, 5, 1),
        )
        await test_db.commit()

        stats = await get_stats(test_db)
        assert stats["vocab_mastered"] >= 1, "Dashboard should count level 3 as mastered"

        achievements_data = await get_achievements(test_db)
        vocab_badges = [a for a in achievements_data["achievements"] if a["id"] == "vocab_1"]
        assert vocab_badges[0]["progress"]["current"] >= 1, (
            "Achievement should count level 3 as mastered (same threshold as dashboard)"
        )


@pytest.mark.unit
class TestGetAchievementsStudyDays:
    async def test_study_days_counts_pronunciation_only_days(self, test_db):
        """Days with only pronunciation activity should count toward dedicated_10."""
        from app.dal.dashboard import get_achievements

        # Insert pronunciation attempts on two different days (no conversations)
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-1 day'))",
            ("hello world", "hello world", 9.0),
        )
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (?, ?, ?, datetime('now', '-2 days'))",
            ("good morning", "good morning", 8.5),
        )
        await test_db.commit()

        achievements_data = await get_achievements(test_db)
        dedicated = [a for a in achievements_data["achievements"] if a["id"] == "dedicated_10"]
        assert dedicated[0]["progress"]["current"] >= 2, (
            "Pronunciation-only days should count toward dedicated_10 achievement"
        )

    async def test_study_days_counts_vocabulary_only_days(self, test_db):
        """Days with only vocabulary activity should count toward dedicated_10."""
        from app.dal.dashboard import get_achievements

        await test_db.execute(
            "INSERT INTO vocabulary_words (word, meaning, topic) VALUES (?, ?, ?)",
            ("test", "テスト", "daily_life"),
        )
        await test_db.execute(
            "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) "
            "VALUES (?, ?, datetime('now', '-1 day'))",
            (1, 1),
        )
        await test_db.execute(
            "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) "
            "VALUES (?, ?, datetime('now', '-3 days'))",
            (1, 0),
        )
        await test_db.commit()

        achievements_data = await get_achievements(test_db)
        dedicated = [a for a in achievements_data["achievements"] if a["id"] == "dedicated_10"]
        assert dedicated[0]["progress"]["current"] >= 2, (
            "Vocabulary-only days should count toward dedicated_10 achievement"
        )


    async def test_century_achievement_includes_listening_and_speaking(self, test_db):
        """total_activities for 'century' must count listening_quiz_results and speaking_journal."""
        from app.dal.dashboard import get_achievements

        # Add listening quiz results
        await test_db.execute(
            "INSERT INTO listening_quiz_results (title, difficulty, total_questions, correct_count, score) "
            "VALUES ('Test Quiz', 'beginner', 5, 4, 80.0)"
        )
        await test_db.execute(
            "INSERT INTO listening_quiz_results (title, difficulty, total_questions, correct_count, score) "
            "VALUES ('Test Quiz 2', 'intermediate', 5, 3, 60.0)"
        )
        # Add speaking journal entries
        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, duration_seconds, word_count, unique_word_count, wpm) "
            "VALUES ('Talk about food', 'I like sushi', 30, 3, 3, 6.0)"
        )
        await test_db.commit()

        achievements_data = await get_achievements(test_db)
        century = [a for a in achievements_data["achievements"] if a["id"] == "century"]
        assert century[0]["progress"]["current"] >= 3, (
            "century achievement should include listening quiz and speaking journal entries"
        )

    async def test_all_rounder_includes_listening_and_speaking(self, test_db):
        """all_rounder modules_used must count listening and speaking_journal modules."""
        from app.dal.dashboard import get_achievements

        # Add one of each module type
        cid = await create_conversation(test_db, "hotel_checkin")
        await test_db.execute(
            "UPDATE conversations SET ended_at = datetime('now') WHERE id = ?", (cid,)
        )
        await test_db.execute(
            "INSERT INTO vocabulary_words (word, meaning, topic) VALUES ('hi', 'こんにちは', 'daily_life')"
        )
        await test_db.execute(
            "INSERT INTO quiz_attempts (word_id, is_correct) VALUES (1, 1)"
        )
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score) VALUES ('hi', 'hi', 9.0)"
        )
        await test_db.execute(
            "INSERT INTO listening_quiz_results (title, difficulty, total_questions, correct_count, score) "
            "VALUES ('Test', 'beginner', 5, 5, 100.0)"
        )
        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, duration_seconds, word_count, unique_word_count, wpm) "
            "VALUES ('Talk', 'hello world', 30, 2, 2, 4.0)"
        )
        await test_db.commit()

        achievements_data = await get_achievements(test_db)
        all_rounder = [a for a in achievements_data["achievements"] if a["id"] == "all_rounder"]
        assert all_rounder[0]["progress"]["current"] >= 5, (
            "all_rounder should count 5 modules: conversation, quiz, pronunciation, listening, speaking_journal"
        )


@pytest.mark.unit
class TestGetMistakeJournal:
    async def test_empty_database(self, test_db):
        result = await get_mistake_journal(test_db)
        assert result["items"] == []
        assert result["total_count"] == 0

    async def test_grammar_mistakes_extracted(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "I want check in")
        feedback = {
            "is_correct": False,
            "errors": [{"original": "check in", "correction": "to check in", "explanation": "Use infinitive"}],
            "suggestions": [],
        }
        await update_message_feedback(test_db, mid, feedback)
        result = await get_mistake_journal(test_db)
        assert result["total_count"] == 1
        item = result["items"][0]
        assert item["module"] == "grammar"
        assert item["detail"]["original"] == "check in"
        assert item["detail"]["correction"] == "to check in"

    async def test_pronunciation_mistakes_low_scores(self, test_db):
        await save_attempt(test_db, "Hello there", "Hello dare", {"overall_score": 5.0}, 5.0)
        await save_attempt(test_db, "Good morning", "Good morning", {"overall_score": 9.0}, 9.0)
        result = await get_mistake_journal(test_db, module="pronunciation")
        assert result["total_count"] == 1
        assert result["items"][0]["detail"]["score"] == 5.0

    async def test_module_filter_grammar(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "Bad grammar")
        await update_message_feedback(test_db, mid, {
            "is_correct": False,
            "errors": [{"original": "Bad", "correction": "Poor", "explanation": "word choice"}],
            "suggestions": [],
        })
        await save_attempt(test_db, "Test", "Tset", {"overall_score": 3.0}, 3.0)
        # Grammar-only filter
        result = await get_mistake_journal(test_db, module="grammar")
        assert all(item["module"] == "grammar" for item in result["items"])
        assert result["total_count"] >= 1

    async def test_pagination(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        for i in range(5):
            mid = await add_message(test_db, cid, "user", f"Mistake {i}")
            await update_message_feedback(test_db, mid, {
                "is_correct": False,
                "errors": [{"original": f"err{i}", "correction": f"fix{i}", "explanation": "test"}],
                "suggestions": [],
            })
        result = await get_mistake_journal(test_db, limit=2, offset=0)
        assert len(result["items"]) == 2
        assert result["total_count"] == 5
        result2 = await get_mistake_journal(test_db, limit=2, offset=2)
        assert len(result2["items"]) == 2

    async def test_malformed_feedback_handled(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "test")
        # Store malformed JSON
        await test_db.execute(
            "UPDATE messages SET feedback_json = ? WHERE id = ?",
            ("not valid json{{{", mid),
        )
        await test_db.commit()
        result = await get_mistake_journal(test_db, module="grammar")
        assert result["total_count"] == 0

    async def test_no_errors_not_included(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "Perfect sentence")
        await update_message_feedback(test_db, mid, {
            "is_correct": True, "errors": [], "suggestions": [],
        })
        result = await get_mistake_journal(test_db, module="grammar")
        assert result["total_count"] == 0


@pytest.mark.unit
class TestGrammarTrend:
    """Tests for get_grammar_trend."""

    async def test_empty_database(self, test_db):
        result = await get_grammar_trend(test_db)
        assert result["conversations"] == []
        assert result["trend"] == "insufficient_data"

    async def test_single_conversation(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await test_db.execute("UPDATE conversations SET status = 'ended' WHERE id = ?", (cid,))
        mid = await add_message(test_db, cid, "user", "Hello")
        await update_message_feedback(test_db, mid, {"is_correct": True, "errors": [], "suggestions": []})
        await test_db.commit()
        result = await get_grammar_trend(test_db)
        assert len(result["conversations"]) == 1
        assert result["conversations"][0]["accuracy_rate"] == 100.0
        assert result["trend"] == "insufficient_data"

    async def test_multiple_conversations_trend(self, test_db):
        # Create 4 conversations with varying accuracy
        for i in range(4):
            cid = await create_conversation(test_db, "hotel_checkin")
            await test_db.execute("UPDATE conversations SET status = 'ended' WHERE id = ?", (cid,))
            for j in range(3):
                mid = await add_message(test_db, cid, "user", f"Message {j}")
                is_correct = (i >= 2)  # first 2 wrong, last 2 correct
                await update_message_feedback(test_db, mid, {
                    "is_correct": is_correct, "errors": [], "suggestions": [],
                })
            await test_db.commit()
        result = await get_grammar_trend(test_db)
        assert len(result["conversations"]) == 4
        assert result["trend"] == "improving"

    async def test_limit_parameter(self, test_db):
        for _ in range(5):
            cid = await create_conversation(test_db, "hotel_checkin")
            await test_db.execute("UPDATE conversations SET status = 'ended' WHERE id = ?", (cid,))
            mid = await add_message(test_db, cid, "user", "Test")
            await update_message_feedback(test_db, mid, {"is_correct": True, "errors": [], "suggestions": []})
            await test_db.commit()
        result = await get_grammar_trend(test_db, limit=3)
        assert len(result["conversations"]) == 3

    async def test_excludes_active_conversations(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        # Don't end the conversation
        mid = await add_message(test_db, cid, "user", "Active msg")
        await update_message_feedback(test_db, mid, {"is_correct": True, "errors": [], "suggestions": []})
        await test_db.commit()
        result = await get_grammar_trend(test_db)
        assert len(result["conversations"]) == 0


@pytest.mark.unit
class TestGetMistakeReviewItems:
    async def test_empty_database(self, test_db):
        items = await get_mistake_review_items(test_db)
        assert items == []

    async def test_extracts_errors_from_feedback(self, test_db):
        import json

        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "I go to hotel yesterday")
        feedback = {
            "is_correct": False,
            "errors": [
                {
                    "original": "I go to hotel yesterday",
                    "correction": "I went to the hotel yesterday",
                    "explanation": "Use past tense for past events",
                }
            ],
        }
        await update_message_feedback(test_db, mid, feedback)
        await test_db.commit()

        items = await get_mistake_review_items(test_db)
        assert len(items) >= 1
        item = items[0]
        assert item["original"] == "I go to hotel yesterday"
        assert item["correction"] == "I went to the hotel yesterday"
        assert item["explanation"] == "Use past tense for past events"
        assert item["topic"] == "hotel_checkin"

    async def test_skips_messages_with_no_errors(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "I went to the hotel yesterday")
        feedback = {"is_correct": True, "errors": []}
        await update_message_feedback(test_db, mid, feedback)
        await test_db.commit()

        items = await get_mistake_review_items(test_db)
        assert items == []

    async def test_skips_malformed_feedback(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "Test message")
        await test_db.execute(
            "UPDATE messages SET feedback_json = ? WHERE id = ?",
            ("not valid json{{{", mid),
        )
        await test_db.commit()

        items = await get_mistake_review_items(test_db)
        assert items == []

    async def test_respects_count_parameter(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        for i in range(5):
            mid = await add_message(test_db, cid, "user", f"Mistake {i}")
            feedback = {
                "errors": [
                    {"original": f"mistake {i}", "correction": f"correct {i}", "explanation": ""}
                ]
            }
            await update_message_feedback(test_db, mid, feedback)
        await test_db.commit()

        items = await get_mistake_review_items(test_db, count=2)
        assert len(items) == 2

    async def test_skips_errors_missing_original_or_correction(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "Test")
        feedback = {
            "errors": [
                {"original": "test", "correction": "", "explanation": "no correction"},
                {"original": "", "correction": "fixed", "explanation": "no original"},
                {"correction": "only correction"},
            ]
        }
        await update_message_feedback(test_db, mid, feedback)
        await test_db.commit()

        items = await get_mistake_review_items(test_db)
        assert items == []


@pytest.mark.unit
class TestGetConfidenceTrend:
    async def test_empty_database(self, test_db):
        result = await get_confidence_trend(test_db)
        assert result["sessions"] == []
        assert result["trend"] == "insufficient_data"

    async def test_single_ended_conversation_with_performance(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {
            "performance": {
                "grammar_accuracy_rate": 80,
                "vocabulary_diversity": 60,
                "avg_words_per_message": 12,
                "total_user_messages": 5,
            }
        }
        await end_conversation(test_db, cid, summary=summary)

        result = await get_confidence_trend(test_db)
        assert len(result["sessions"]) == 1
        session = result["sessions"][0]
        assert session["topic"] == "hotel_checkin"
        assert session["score"] > 0
        assert session["grammar_score"] == 80.0
        assert session["diversity_score"] == 60.0
        assert result["trend"] == "insufficient_data"

    async def test_improving_trend(self, test_db):
        import json

        for i in range(6):
            cid = await create_conversation(test_db, "hotel_checkin")
            summary = {
                "performance": {
                    "grammar_accuracy_rate": 50 + i * 10,
                    "vocabulary_diversity": 50 + i * 5,
                    "avg_words_per_message": 8 + i,
                    "total_user_messages": 5 + i,
                }
            }
            # Set distinct started_at so ordering is deterministic
            await test_db.execute(
                "UPDATE conversations SET started_at = ?, status = 'ended', summary_json = ? WHERE id = ?",
                (f"2026-01-0{i + 1} 10:00:00", json.dumps(summary), cid),
            )
        await test_db.commit()

        result = await get_confidence_trend(test_db)
        assert len(result["sessions"]) == 6
        assert result["trend"] == "improving"

    async def test_skips_conversations_without_performance(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {"some_other_key": "value"}
        await end_conversation(test_db, cid, summary=summary)

        result = await get_confidence_trend(test_db)
        assert result["sessions"] == []

    async def test_sub_score_normalization_caps_at_100(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {
            "performance": {
                "grammar_accuracy_rate": 150,
                "vocabulary_diversity": 200,
                "avg_words_per_message": 100,
                "total_user_messages": 50,
            }
        }
        await end_conversation(test_db, cid, summary=summary)

        result = await get_confidence_trend(test_db)
        session = result["sessions"][0]
        assert session["grammar_score"] == 100.0
        assert session["diversity_score"] == 100.0
        assert session["complexity_score"] == 100.0
        assert session["participation_score"] == 100.0
        assert session["score"] == 100.0


@pytest.mark.unit
class TestGetDailyChallenge:
    async def test_returns_valid_challenge_structure(self, test_db):
        challenge = await get_daily_challenge(test_db)
        assert "challenge_type" in challenge
        assert "title" in challenge
        assert "description" in challenge
        assert "target_count" in challenge
        assert "current_count" in challenge
        assert "completed" in challenge
        assert "route" in challenge
        assert "topic" in challenge

    async def test_challenge_type_is_valid(self, test_db):
        challenge = await get_daily_challenge(test_db)
        assert challenge["challenge_type"] in ("conversation", "vocabulary", "pronunciation")

    async def test_completed_when_current_meets_target(self, test_db):
        challenge = await get_daily_challenge(test_db)
        if challenge["current_count"] >= challenge["target_count"]:
            assert challenge["completed"] is True
        else:
            assert challenge["completed"] is False

    async def test_route_matches_challenge_type(self, test_db):
        challenge = await get_daily_challenge(test_db)
        routes = {
            "conversation": "/conversation",
            "vocabulary": "/vocabulary",
            "pronunciation": "/pronunciation",
        }
        assert challenge["route"] == routes[challenge["challenge_type"]]


@pytest.mark.unit
class TestGetWordOfTheDay:
    async def test_returns_none_when_no_words(self, test_db):
        result = await get_word_of_the_day(test_db)
        assert result is None

    async def test_returns_valid_word_dict(self, test_db):
        await save_words(test_db, "travel", [
            {"word": "luggage", "meaning": "bags and suitcases", "example_sentence": "Check your luggage.", "difficulty": 1},
        ])

        result = await get_word_of_the_day(test_db)
        assert result is not None
        assert "word_id" in result
        assert result["word"] == "luggage"
        assert result["meaning"] == "bags and suitcases"
        assert result["topic"] == "travel"
        assert result["difficulty"] == 1
        assert "example_sentence" in result

    async def test_deterministic_for_same_day(self, test_db):
        await save_words(test_db, "travel", [
            {"word": "luggage", "meaning": "bags", "example_sentence": "", "difficulty": 1},
            {"word": "passport", "meaning": "travel document", "example_sentence": "", "difficulty": 2},
            {"word": "ticket", "meaning": "boarding pass", "example_sentence": "", "difficulty": 1},
        ])

        result1 = await get_word_of_the_day(test_db)
        result2 = await get_word_of_the_day(test_db)
        assert result1["word"] == result2["word"]


@pytest.mark.unit
class TestGetRecentActivity:
    async def test_empty_db_returns_empty(self, test_db):
        result = await get_recent_activity(test_db)
        assert result == []

    async def test_returns_items_sorted_by_time(self, test_db):
        await create_conversation(test_db, "hotel_checkin", "beginner")
        await save_attempt(test_db, "Hello world", "Hello world", 95, {})
        result = await get_recent_activity(test_db)
        assert len(result) >= 2
        # sorted descending
        for i in range(len(result) - 1):
            assert result[i]["timestamp"] >= result[i + 1]["timestamp"]

    async def test_respects_limit(self, test_db):
        for i in range(5):
            await create_conversation(test_db, f"topic_{i}", "beginner")
        result = await get_recent_activity(test_db, limit=3)
        assert len(result) == 3

    async def test_items_have_required_fields(self, test_db):
        await create_conversation(test_db, "hotel_checkin", "beginner")
        result = await get_recent_activity(test_db, limit=1)
        assert len(result) == 1
        item = result[0]
        assert "type" in item
        assert "detail" in item
        assert "timestamp" in item
        assert "route" in item
        assert item["route"] == "/conversation"

    async def test_speaking_journal_routes_to_home(self, test_db):
        """speaking_journal activity should route to '/' (Home page)."""
        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
            ("Talk about travel", "I love Japan", 3, 3, 60, 3.0),
        )
        await test_db.commit()
        result = await get_recent_activity(test_db)
        sj_items = [r for r in result if r["type"] == "speaking_journal"]
        assert len(sj_items) >= 1
        assert sj_items[0]["route"] == "/"

    async def test_null_detail_does_not_crash(self, test_db):
        """_get_recent_activity handles NULL detail without crashing.

        All detail columns currently have NOT NULL constraints, but this
        guards against corrupt/migrated data.  We temporarily drop the
        constraint by re-creating the pronunciation_attempts table.
        """
        # Drop and recreate pronunciation_attempts without NOT NULL on reference_text
        await test_db.execute("DROP TABLE IF EXISTS pronunciation_attempts")
        await test_db.execute(
            "CREATE TABLE pronunciation_attempts ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  reference_text TEXT,"  # deliberately nullable
            "  user_transcription TEXT NOT NULL,"
            "  feedback_json TEXT,"
            "  score REAL,"
            "  difficulty TEXT,"
            "  created_at TEXT NOT NULL DEFAULT (datetime('now'))"
            ")"
        )
        await test_db.execute(
            "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, created_at) "
            "VALUES (NULL, 'hello', 80, datetime('now'))"
        )
        await test_db.commit()
        result = await _get_recent_activity(test_db)
        assert len(result) == 1
        # The NULL detail should fall back to the type name
        assert result[0]["detail"] == "pronunciation"
        assert result[0]["type"] == "pronunciation"


@pytest.mark.unit
class TestGetAchievements:
    async def test_empty_db_all_locked(self, test_db):
        result = await get_achievements(test_db)
        assert result["unlocked_count"] == 0
        assert result["total_count"] > 0
        for a in result["achievements"]:
            assert a["unlocked"] is False
            assert a["progress"]["current"] == 0

    async def test_conv_achievement_unlocks(self, test_db):
        for i in range(10):
            cid = await create_conversation(test_db, "hotel_checkin", "beginner")
            await end_conversation(test_db, cid)
        result = await get_achievements(test_db)
        conv_10 = next(a for a in result["achievements"] if a["id"] == "conv_10")
        assert conv_10["unlocked"] is True
        assert conv_10["progress"]["current"] >= 10

    async def test_century_sums_all_activities(self, test_db):
        for _ in range(5):
            cid = await create_conversation(test_db, "hotel_checkin", "beginner")
            await end_conversation(test_db, cid)
        for _ in range(5):
            await save_attempt(test_db, "test sentence", "test sentence", 80, {})
        result = await get_achievements(test_db)
        century = next(a for a in result["achievements"] if a["id"] == "century")
        assert century["progress"]["current"] >= 10


@pytest.mark.unit
class TestGetSkillRadar:
    """Tests for get_skill_radar()."""

    async def test_empty_db_returns_all_zeros(self, test_db):
        result = await get_skill_radar(test_db)
        assert len(result) == 5
        names = {r["name"] for r in result}
        assert names == {"speaking", "listening", "vocabulary", "grammar", "pronunciation"}
        for r in result:
            assert r["score"] == 0
            assert "label" in r

    async def test_speaking_score_from_conversations(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin", "beginner")
        await add_message(test_db, cid, "assistant", "Hello!")
        await add_message(test_db, cid, "user", "Hi there")
        await add_message(test_db, cid, "user", "I need a room")
        await end_conversation(test_db, cid)
        result = await get_skill_radar(test_db)
        speaking = next(r for r in result if r["name"] == "speaking")
        # 1 conversation * 5 + 2 user messages + 0 journal entries * 3 = 7, / 2 = 3
        assert speaking["score"] >= 3

    async def test_vocabulary_score_from_mastery(self, test_db):
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "alpha", "correct_meaning": "m"},
            {"word": "beta", "correct_meaning": "m"},
            {"word": "gamma", "correct_meaning": "m"},
            {"word": "delta", "correct_meaning": "m"},
        ])
        # Level up 3 words to level 3+ (mastered) — need 3 correct answers each
        for w in words[:3]:
            for _ in range(4):
                await update_progress(test_db, w["id"], True)
        result = await get_skill_radar(test_db)
        vocab = next(r for r in result if r["name"] == "vocabulary")
        # 3/4 mastered ≈ 75%
        assert vocab["score"] >= 50

    async def test_scores_capped_at_100(self, test_db):
        # Create many conversations to push speaking score past 100
        for _ in range(25):
            cid = await create_conversation(test_db, "hotel_checkin", "beginner")
            for _ in range(10):
                await add_message(test_db, cid, "user", "test message")
            await end_conversation(test_db, cid)
        result = await get_skill_radar(test_db)
        speaking = next(r for r in result if r["name"] == "speaking")
        assert speaking["score"] <= 100

    async def test_listening_includes_quiz_results(self, test_db):
        """Listening skill score should incorporate listening_quiz_results data."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        # Insert listening quiz results
        for i in range(5):
            await test_db.execute(
                "INSERT INTO listening_quiz_results (title, difficulty, total_questions, correct_count, score, passage, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (f"Quiz {i}", "beginner", 10, 8, 80.0, "test passage", now),
            )
        await test_db.commit()
        result = await get_skill_radar(test_db)
        listening = next(r for r in result if r["name"] == "listening")
        # 5 quiz results with avg score 80 should contribute to listening score
        assert listening["score"] > 0

    async def test_speaking_score_includes_speaking_journal(self, test_db):
        """Speaking skill score should incorporate speaking_journal entries."""
        # Add speaking journal entries only (no conversations)
        for i in range(5):
            await test_db.execute(
                "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                (f"Prompt {i}", f"Transcript {i}", 10, 8, 60, 10.0),
            )
        await test_db.commit()
        result = await get_skill_radar(test_db)
        speaking = next(r for r in result if r["name"] == "speaking")
        # 5 entries * 3 = 15, / 2 = 7 minimum
        assert speaking["score"] >= 7

    async def test_grammar_handles_string_is_correct(self, test_db):
        """Grammar skill score should count string 'true' as correct."""
        import json
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        cid = await create_conversation(test_db, "hotel_checkin", "beginner")
        # Insert messages with string is_correct values
        for val in [True, "true", "yes", "1"]:
            await test_db.execute(
                "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) "
                "VALUES (?, 'user', ?, ?, ?)",
                (cid, f"msg {val}", json.dumps({"is_correct": val}), now),
            )
        # Insert one incorrect message
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) "
            "VALUES (?, 'user', ?, ?, ?)",
            (cid, "wrong", json.dumps({"is_correct": False}), now),
        )
        await test_db.commit()
        result = await get_skill_radar(test_db)
        grammar = next(r for r in result if r["name"] == "grammar")
        # 4/5 correct = 80%
        assert grammar["score"] == 80


@pytest.mark.unit
class TestGetWeeklyReport:
    """Tests for get_weekly_report()."""

    async def test_empty_db_returns_zeroed_stats(self, test_db):
        result = await get_weekly_report(test_db)
        assert result["conversations"] == 0
        assert result["messages_sent"] == 0
        assert result["vocabulary_reviewed"] == 0
        assert result["quiz_accuracy"] == 0
        assert result["pronunciation_attempts"] == 0
        assert result["speaking_journal_entries"] == 0
        assert result["speaking_journal_avg_wpm"] == 0
        assert result["listening_quizzes"] == 0
        assert result["listening_avg_score"] == 0
        assert "text_summary" in result
        assert len(result["text_summary"]) > 0
        assert "week_start" in result
        assert "week_end" in result

    async def test_counts_conversations_this_week(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin", "beginner")
        await add_message(test_db, cid, "user", "Hello")
        await add_message(test_db, cid, "user", "Good morning")
        result = await get_weekly_report(test_db)
        assert result["conversations"] >= 1
        assert result["messages_sent"] >= 2

    async def test_quiz_accuracy_calculation(self, test_db):
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "correct1", "correct_meaning": "m"},
            {"word": "correct2", "correct_meaning": "m"},
            {"word": "wrong1", "correct_meaning": "m"},
        ])
        await update_progress(test_db, words[0]["id"], True)
        await update_progress(test_db, words[1]["id"], True)
        await update_progress(test_db, words[2]["id"], False)
        result = await get_weekly_report(test_db)
        assert result["vocabulary_reviewed"] >= 3
        # 2/3 correct ≈ 66.7%
        assert 60 <= result["quiz_accuracy"] <= 70

    async def test_highlights_include_streak(self, test_db):
        # Streak counts days with messages/pronunciation/quiz_attempts
        import json
        from datetime import datetime, timedelta, timezone
        for i in range(7):
            d = (datetime.now(timezone.utc) - timedelta(days=i)).isoformat()
            cursor = await test_db.execute(
                "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at) VALUES (?, ?, 'ended', ?, ?)",
                ("hotel_checkin", "beginner", d, d),
            )
            cid = cursor.lastrowid
            await test_db.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', 'hello', ?)",
                (cid, d),
            )
        await test_db.commit()
        result = await get_weekly_report(test_db)
        assert result["streak"] >= 7
        streak_highlight = [h for h in result["highlights"] if "streak" in h.lower()]
        assert len(streak_highlight) > 0

    async def test_grammar_accuracy_weekly_scoped(self, test_db):
        """Grammar accuracy in weekly report should only count messages from the past 7 days."""
        import json
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        recent_date = now.isoformat()
        old_date = (now - timedelta(days=30)).isoformat()

        # Create a conversation
        cursor = await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at) VALUES (?, ?, 'ended', ?, ?)",
            ("hotel_checkin", "beginner", recent_date, recent_date),
        )
        cid = cursor.lastrowid

        # Insert old messages (30 days ago) — all incorrect grammar
        for i in range(5):
            await test_db.execute(
                "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) VALUES (?, 'user', ?, ?, ?)",
                (cid, f"old msg {i}", json.dumps({"is_correct": False}), old_date),
            )

        # Insert recent messages — 3 correct, 1 incorrect
        for i in range(3):
            await test_db.execute(
                "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) VALUES (?, 'user', ?, ?, ?)",
                (cid, f"recent correct {i}", json.dumps({"is_correct": True}), recent_date),
            )
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, feedback_json, created_at) VALUES (?, 'user', ?, ?, ?)",
            (cid, "recent wrong", json.dumps({"is_correct": False}), recent_date),
        )
        await test_db.commit()

        result = await get_weekly_report(test_db)
        # Weekly grammar accuracy: 3/4 = 75.0% (NOT 3/9 = 33.3% which would be all-time)
        assert result["grammar_accuracy"] == 75.0

    async def test_includes_speaking_journal_entries(self, test_db):
        """Weekly report should count speaking journal entries from the past 7 days."""
        for i in range(4):
            await test_db.execute(
                "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                (f"Prompt {i}", f"Transcript {i}", 10, 8, 60, 12.0),
            )
        await test_db.commit()
        result = await get_weekly_report(test_db)
        assert result["speaking_journal_entries"] == 4
        assert result["speaking_journal_avg_wpm"] == 12.0
        assert "Speaking Journal" in result["text_summary"]
        highlight = [h for h in result["highlights"] if "speaking journal" in h.lower()]
        assert len(highlight) > 0

    async def test_includes_listening_quizzes(self, test_db):
        """Weekly report should count listening quizzes from the past 7 days."""
        for i in range(3):
            await test_db.execute(
                "INSERT INTO listening_quiz_results (title, difficulty, total_questions, correct_count, score, questions_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                (f"Quiz {i}", "beginner", 10, 8, 80.0, "[]"),
            )
        await test_db.commit()
        result = await get_weekly_report(test_db)
        assert result["listening_quizzes"] == 3
        assert result["listening_avg_score"] == 80.0
        assert "Listening Quizzes" in result["text_summary"]
        highlight = [h for h in result["highlights"] if "listening quiz" in h.lower()]
        assert len(highlight) > 0


@pytest.mark.unit
class TestGetSessionAnalytics:
    """Tests for get_session_analytics()."""

    async def test_empty_db_returns_empty_daily(self, test_db):
        result = await get_session_analytics(test_db)
        assert result["daily"] == []
        assert len(result["modules"]) == 5
        for m in result["modules"]:
            assert m["total_seconds"] == 0
            assert m["session_count"] == 0

    async def test_conversation_time_from_timestamps(self, test_db):
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        start = now.isoformat()
        end = (now + timedelta(minutes=5)).isoformat()
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at) VALUES (?, ?, 'ended', ?, ?)",
            ("hotel_checkin", "beginner", start, end),
        )
        await test_db.commit()
        result = await get_session_analytics(test_db, days=7)
        conv_mod = next(m for m in result["modules"] if m["module"] == "conversation")
        assert conv_mod["session_count"] == 1
        assert 250 <= conv_mod["total_seconds"] <= 350  # ~300 seconds (5 min)

    async def test_pronunciation_time_estimation(self, test_db):
        import json
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        for _ in range(3):
            await test_db.execute(
                "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score, feedback_json, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("Test sentence", "Test sentence", 8.0, json.dumps({"overall_score": 8.0}), now),
            )
        await test_db.commit()
        result = await get_session_analytics(test_db, days=7)
        pron_mod = next(m for m in result["modules"] if m["module"] == "pronunciation")
        assert pron_mod["session_count"] == 3
        assert pron_mod["total_seconds"] == 360  # 3 * 120

    async def test_vocabulary_time_estimation(self, test_db):
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "word1", "correct_meaning": "m"},
            {"word": "word2", "correct_meaning": "m"},
            {"word": "word3", "correct_meaning": "m"},
            {"word": "word4", "correct_meaning": "m"},
        ])
        for w in words:
            await update_progress(test_db, w["id"], True)
        result = await get_session_analytics(test_db, days=30)
        vocab_mod = next(m for m in result["modules"] if m["module"] == "vocabulary")
        assert vocab_mod["session_count"] == 4
        assert vocab_mod["total_seconds"] == 120  # 4 * 30

    async def test_daily_breakdown_has_all_modules(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin", "beginner")
        await end_conversation(test_db, cid)
        result = await get_session_analytics(test_db, days=7)
        if result["daily"]:
            day = result["daily"][0]
            assert "conversation_seconds" in day
            assert "pronunciation_seconds" in day
            assert "vocabulary_seconds" in day
            assert "date" in day


@pytest.mark.unit
class TestGetListeningProgress:
    async def test_empty_database(self, test_db):
        """Empty DB returns zeroed stats."""
        result = await get_listening_progress(test_db)
        assert result["total_quizzes"] == 0
        assert result["avg_score"] == 0
        assert result["best_score"] == 0
        assert result["by_difficulty"] == []
        assert result["trend"] == "insufficient_data"

    async def test_with_data(self, test_db):
        """Returns correct aggregate stats."""
        await save_listening_quiz_result(test_db, "Q1", "beginner", 5, 4, 80.0)
        await save_listening_quiz_result(test_db, "Q2", "beginner", 5, 5, 100.0)
        await save_listening_quiz_result(test_db, "Q3", "intermediate", 5, 3, 60.0)
        result = await get_listening_progress(test_db)
        assert result["total_quizzes"] == 3
        assert result["best_score"] == 100.0
        assert result["avg_score"] == 80.0

    async def test_by_difficulty_breakdown(self, test_db):
        """Returns per-difficulty breakdown."""
        await save_listening_quiz_result(test_db, "Q1", "beginner", 5, 4, 80.0)
        await save_listening_quiz_result(test_db, "Q2", "advanced", 5, 3, 60.0)
        result = await get_listening_progress(test_db)
        difficulties = {d["difficulty"] for d in result["by_difficulty"]}
        assert "beginner" in difficulties
        assert "advanced" in difficulties

    async def test_trend_insufficient_data(self, test_db):
        """Trend is insufficient_data with < 6 results."""
        for i in range(5):
            await save_listening_quiz_result(test_db, f"Q{i}", "beginner", 5, 3, 60.0)
        result = await get_listening_progress(test_db)
        assert result["trend"] == "insufficient_data"

    async def test_trend_improving(self, test_db):
        """Trend is improving when recent scores > older scores."""
        # Older 5 (low scores) — backdated
        for i in range(5):
            await save_listening_quiz_result(test_db, f"Old{i}", "beginner", 5, 2, 40.0)
        await test_db.execute("UPDATE listening_quiz_results SET created_at = datetime('now', '-10 minutes')")
        await test_db.commit()
        # Recent 5 (high scores)
        for i in range(5):
            await save_listening_quiz_result(test_db, f"New{i}", "beginner", 5, 5, 90.0)
        result = await get_listening_progress(test_db)
        assert result["trend"] == "improving"

    async def test_trend_stable(self, test_db):
        """Trend is stable when scores are similar."""
        for i in range(10):
            await save_listening_quiz_result(test_db, f"Q{i}", "beginner", 5, 4, 70.0)
        result = await get_listening_progress(test_db)
        assert result["trend"] == "stable"


@pytest.mark.unit
class TestGetModuleStreaks:
    async def test_empty_database(self, test_db):
        """All streaks are 0 with no data."""
        result = await get_module_streaks(test_db)
        assert result["overall_streak"] == 0
        assert result["modules"]["conversation"]["current_streak"] == 0
        assert result["modules"]["vocabulary"]["current_streak"] == 0
        assert result["modules"]["pronunciation"]["current_streak"] == 0
        assert result["modules"]["listening"]["current_streak"] == 0
        assert result["modules"]["conversation"]["last_active"] is None
        assert result["least_consistent"] is not None

    async def test_conversation_only_streak(self, test_db):
        """Streak shows for conversation when user has messages today."""
        conv_id = await create_conversation(test_db, "hotel", "beginner")
        await add_message(test_db, conv_id, "user", "Hello there")
        result = await get_module_streaks(test_db)
        assert result["modules"]["conversation"]["current_streak"] >= 1
        assert result["modules"]["conversation"]["last_active"] is not None
        assert result["modules"]["vocabulary"]["current_streak"] == 0
        assert result["most_consistent"] == "conversation"

    async def test_pronunciation_only_streak(self, test_db):
        """Streak shows for pronunciation when user has attempts today."""
        await save_attempt(test_db, "hello world", "hello world", {"overall": "Good"}, 85.0)
        result = await get_module_streaks(test_db)
        assert result["modules"]["pronunciation"]["current_streak"] >= 1
        assert result["modules"]["pronunciation"]["last_active"] is not None
        assert result["most_consistent"] == "pronunciation"

    async def test_vocabulary_only_streak(self, test_db):
        """Streak shows for vocabulary when user has quiz attempts today."""
        await save_words(test_db, "travel", [
            {"word": "hotel", "definition": "a place to stay", "example": "The hotel is nice"},
        ])
        rows = await test_db.execute_fetchall("SELECT id FROM vocabulary_words LIMIT 1")
        word_id = rows[0]["id"]
        await update_progress(test_db, word_id, True)
        result = await get_module_streaks(test_db)
        assert result["modules"]["vocabulary"]["current_streak"] >= 1
        assert result["most_consistent"] == "vocabulary"

    async def test_listening_only_streak(self, test_db):
        """Streak shows for listening when user has quiz results today."""
        await save_listening_quiz_result(test_db, "Test Quiz", "beginner", 5, 4, 80.0)
        result = await get_module_streaks(test_db)
        assert result["modules"]["listening"]["current_streak"] >= 1
        assert result["most_consistent"] == "listening"

    async def test_multiple_modules_active(self, test_db):
        """Most and least consistent are correct with multiple modules."""
        conv_id = await create_conversation(test_db, "hotel", "beginner")
        await add_message(test_db, conv_id, "user", "Hello")
        await save_attempt(test_db, "test sentence", "test sentence", {"overall": "OK"}, 75.0)
        result = await get_module_streaks(test_db)
        assert result["modules"]["conversation"]["current_streak"] >= 1
        assert result["modules"]["pronunciation"]["current_streak"] >= 1
        assert result["overall_streak"] >= 1
        assert result["most_consistent"] is not None
        assert result["least_consistent"] is not None

    async def test_all_four_modules_keys(self, test_db):
        """Response includes all five module keys."""
        result = await get_module_streaks(test_db)
        assert set(result["modules"].keys()) == {"conversation", "vocabulary", "pronunciation", "listening", "speaking_journal"}


# ── Learning Velocity ──────────────────────────────────────────


@pytest.mark.unit
class TestLearningVelocity:
    async def test_learning_velocity_empty_db(self, test_db):
        """Learning velocity returns zeros when no activity exists."""
        result = await get_learning_velocity(test_db, weeks=8)
        assert result["weekly_data"] == []
        assert result["current_pace"]["words_per_day"] == 0
        assert result["trend"] == "insufficient_data"
        assert result["total_active_days"] == 0
        assert result["words_per_study_day"] == 0

    async def test_learning_velocity_with_activity(self, test_db):
        """Learning velocity calculates weekly data correctly."""
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)

        # Insert words and vocabulary progress across multiple weeks
        for i in range(10):
            days_ago = i * 3  # spread across ~30 days
            reviewed = (now - timedelta(days=days_ago)).isoformat()
            await test_db.execute(
                "INSERT INTO vocabulary_words (word, meaning, topic, difficulty) VALUES (?, ?, ?, ?)",
                (f"word{i}", f"meaning{i}", "hotel", 1),
            )
            rows = await test_db.execute_fetchall("SELECT last_insert_rowid() AS id")
            word_id = rows[0]["id"]
            await test_db.execute(
                "INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, level, last_reviewed) VALUES (?, 1, 0, 1, ?)",
                (word_id, reviewed),
            )

        # Insert quiz attempts
        for i in range(5):
            days_ago = i * 2
            answered = (now - timedelta(days=days_ago)).isoformat()
            await test_db.execute(
                "INSERT INTO quiz_attempts (word_id, is_correct, answered_at) VALUES (?, ?, ?)",
                (1, 1, answered),
            )

        await test_db.commit()

        result = await get_learning_velocity(test_db, weeks=8)
        assert len(result["weekly_data"]) > 0
        assert result["total_active_days"] > 0
        assert result["current_pace"]["words_per_day"] >= 0
        assert result["trend"] in ("accelerating", "decelerating", "steady", "insufficient_data")

    async def test_learning_velocity_weeks_param(self, test_db):
        """Learning velocity respects the weeks parameter."""
        result = await get_learning_velocity(test_db, weeks=2)
        assert result["weekly_data"] == []  # empty DB
        assert result["trend"] == "insufficient_data"


# ---------------------------------------------------------------------------
# Grammar weak-spots analysis
# ---------------------------------------------------------------------------


class TestCategorizeError:
    """Unit tests for _categorize_error helper."""

    def test_article_keyword(self):
        assert _categorize_error("Missing article before noun") == "Articles"

    def test_tense_keyword(self):
        assert _categorize_error("Wrong past tense form used") == "Verb Tenses"

    def test_subject_verb_agreement(self):
        assert _categorize_error("subject and verb agreement error") == "Subject-Verb Agreement"

    def test_preposition(self):
        assert _categorize_error("Wrong preposition after 'depend'") == "Prepositions"

    def test_unknown_category(self):
        assert _categorize_error("Completely unknown explanation") == "Other"


class TestGrammarWeakSpots:
    """Unit tests for get_grammar_weak_spots."""

    @pytest.mark.unit
    async def test_empty_database(self, test_db):
        """Returns empty categories when no messages exist."""
        result = await get_grammar_weak_spots(test_db)
        assert result["categories"] == []
        assert result["total_errors"] == 0
        assert result["category_count"] == 0
        assert result["most_common_category"] is None

    @pytest.mark.unit
    async def test_single_error_category(self, test_db):
        """A single error is correctly categorized and returned."""
        conv_id = await create_conversation(test_db, "hotel", "beginner")
        feedback = {"is_correct": False, "errors": [
            {"original": "go", "correction": "went", "explanation": "Wrong past tense form"}
        ]}
        msg_id = await add_message(test_db, conv_id, "user", "I go to hotel yesterday", feedback)

        result = await get_grammar_weak_spots(test_db)
        assert result["total_errors"] == 1
        assert result["category_count"] == 1
        assert result["most_common_category"] == "Verb Tenses"
        assert len(result["categories"]) == 1
        assert result["categories"][0]["name"] == "Verb Tenses"
        assert result["categories"][0]["total_count"] == 1

    @pytest.mark.unit
    async def test_multiple_categories_ranked(self, test_db):
        """Multiple categories are ranked by frequency."""
        conv_id = await create_conversation(test_db, "hotel", "beginner")

        # 3 article errors, 1 tense error
        for i in range(3):
            feedback = {"is_correct": False, "errors": [
                {"original": "x", "correction": "y", "explanation": "Missing article before noun"}
            ]}
            await add_message(test_db, conv_id, "user", f"sentence {i}", feedback)

        feedback = {"is_correct": False, "errors": [
            {"original": "go", "correction": "went", "explanation": "Wrong verb tense"}
        ]}
        await add_message(test_db, conv_id, "user", "tense error", feedback)

        result = await get_grammar_weak_spots(test_db)
        assert result["total_errors"] == 4
        assert result["category_count"] == 2
        assert result["most_common_category"] == "Articles"
        assert result["categories"][0]["name"] == "Articles"
        assert result["categories"][0]["total_count"] == 3
        assert result["categories"][1]["name"] == "Verb Tenses"

    @pytest.mark.unit
    async def test_trend_computation(self, test_db):
        """Recent-vs-older trend is computed correctly."""
        from datetime import datetime, timedelta, timezone

        conv_id = await create_conversation(test_db, "hotel", "beginner")
        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

        # 5 older article errors — insert with old created_at directly
        for i in range(5):
            feedback = {"is_correct": False, "errors": [
                {"original": "x", "correction": "y", "explanation": "article usage error"}
            ]}
            mid = await add_message(test_db, conv_id, "user", f"old {i}", feedback)
            await test_db.execute("UPDATE messages SET created_at = ? WHERE id = ?", (old_date, mid))
        await test_db.commit()

        # 1 recent article error → improving
        feedback = {"is_correct": False, "errors": [
            {"original": "x", "correction": "y", "explanation": "article usage error"}
        ]}
        await add_message(test_db, conv_id, "user", "recent", feedback)

        result = await get_grammar_weak_spots(test_db)
        articles = [c for c in result["categories"] if c["name"] == "Articles"][0]
        assert articles["trend"] == "improving"
        assert articles["recent_count"] == 1
        assert articles["older_count"] == 5

    @pytest.mark.unit
    async def test_limit_parameter(self, test_db):
        """Limit caps the number of categories returned."""
        result = await get_grammar_weak_spots(test_db, limit=1)
        assert len(result["categories"]) <= 1


# ---------------------------------------------------------------------------
# Vocabulary retention forecast
# ---------------------------------------------------------------------------


class TestVocabularyForecast:
    """Unit tests for get_vocabulary_forecast."""

    @pytest.mark.unit
    async def test_empty_database(self, test_db):
        """Returns empty results when no vocabulary progress exists."""
        result = await get_vocabulary_forecast(test_db)
        assert result["at_risk_words"] == []
        assert result["total_reviewed"] == 0
        assert result["at_risk_count"] == 0
        assert result["overdue_count"] == 0
        assert result["avg_retention_score"] == 100
        assert result["recommended_review_count"] == 5

    @pytest.mark.unit
    async def test_word_with_no_quiz_history(self, test_db):
        """Words without quiz attempts get moderate error_rate (0.5)."""
        questions = [{"word": "hello", "correct_meaning": "greeting"}]
        words = await save_words(test_db, "hotel_checkin", questions)
        # Directly insert progress without going through update_progress
        # (which also creates quiz_attempts)
        await test_db.execute(
            "INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, level, last_reviewed, next_review_at) VALUES (?, 1, 0, 1, datetime('now'), datetime('now', '+1 day'))",
            (words[0]["id"],),
        )
        await test_db.commit()

        result = await get_vocabulary_forecast(test_db)
        assert result["total_reviewed"] == 1
        assert len(result["at_risk_words"]) == 1
        assert result["at_risk_words"][0]["error_rate"] == 0.5

    @pytest.mark.unit
    async def test_overdue_word_has_higher_risk(self, test_db):
        """An overdue word has a higher risk score than an up-to-date word."""
        from datetime import datetime, timedelta, timezone

        questions = [
            {"word": "overdue", "correct_meaning": "late"},
            {"word": "current", "correct_meaning": "now"},
        ]
        words = await save_words(test_db, "hotel_checkin", questions)
        for w in words:
            await update_progress(test_db, w["id"], True)

        # Make one word overdue
        past = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%d %H:%M:%S")
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = ? WHERE word_id = ?",
            (past, words[0]["id"]),
        )
        await test_db.commit()

        result = await get_vocabulary_forecast(test_db)
        risk_map = {w["word"]: w["risk_score"] for w in result["at_risk_words"]}
        assert risk_map["overdue"] > risk_map["current"]
        assert result["overdue_count"] >= 1

    @pytest.mark.unit
    async def test_high_error_rate_increases_risk(self, test_db):
        """Words with high quiz error rate have higher risk scores."""
        questions = [
            {"word": "difficult", "correct_meaning": "hard"},
            {"word": "easy", "correct_meaning": "simple"},
        ]
        words = await save_words(test_db, "hotel_checkin", questions)
        for w in words:
            await update_progress(test_db, w["id"], True)

        # Add quiz attempts: difficult = mostly wrong, easy = all correct
        for _ in range(5):
            await test_db.execute(
                "INSERT INTO quiz_attempts (word_id, is_correct) VALUES (?, ?)",
                (words[0]["id"], 0),
            )
            await test_db.execute(
                "INSERT INTO quiz_attempts (word_id, is_correct) VALUES (?, ?)",
                (words[1]["id"], 1),
            )
        await test_db.commit()

        result = await get_vocabulary_forecast(test_db)
        risk_map = {w["word"]: w for w in result["at_risk_words"]}
        assert risk_map["difficult"]["risk_score"] > risk_map["easy"]["risk_score"]
        # update_progress adds 1 correct quiz_attempt, plus 5 incorrect = 5/6 error rate
        assert risk_map["difficult"]["error_rate"] > 0.7
        # update_progress adds 1 correct quiz_attempt, plus 5 correct = 0/6 error rate
        assert risk_map["easy"]["error_rate"] == 0.0

    @pytest.mark.unit
    async def test_limit_parameter(self, test_db):
        """Limit caps the number of at-risk words returned."""
        result = await get_vocabulary_forecast(test_db, limit=1)
        assert len(result["at_risk_words"]) <= 1


@pytest.mark.unit
class TestGetPhraseOfTheDay:
    async def test_empty_database(self, test_db):
        """Returns None when no conversations or vocabulary exist."""
        result = await get_phrase_of_the_day(test_db)
        assert result is None

    async def test_phrases_from_conversations(self, test_db):
        """Extracts phrases from completed conversation assistant messages."""
        conv = await create_conversation(test_db, "hotel_checkin", "beginner")
        # Short phrase (<20 chars) should be excluded
        await add_message(test_db, conv, "assistant", "Hi there.")
        # Valid phrase (20-80 chars)
        await add_message(
            test_db, conv, "assistant",
            "Welcome to the Grand Hotel, how can I help you today?"
        )
        await end_conversation(test_db, conv)

        result = await get_phrase_of_the_day(test_db)
        assert result is not None
        assert result["source"] == "conversation"
        assert 20 <= len(result["phrase"]) <= 80
        assert result["topic"] == "hotel_checkin"

    async def test_phrases_starting_with_star_excluded(self, test_db):
        """Phrases starting with * are filtered out."""
        conv = await create_conversation(test_db, "hotel_checkin", "beginner")
        await add_message(
            test_db, conv, "assistant",
            "*This is a correction note that should be excluded from phrases."
        )
        await end_conversation(test_db, conv)

        result = await get_phrase_of_the_day(test_db)
        assert result is None

    async def test_deterministic_selection(self, test_db):
        """Same day always produces the same phrase selection."""
        conv = await create_conversation(test_db, "restaurant", "beginner")
        await add_message(
            test_db, conv, "assistant",
            "Would you like to see our menu today? We have many great options for you."
        )
        await add_message(
            test_db, conv, "assistant",
            "Our special today is grilled salmon with fresh vegetables on the side."
        )
        await end_conversation(test_db, conv)

        result1 = await get_phrase_of_the_day(test_db)
        result2 = await get_phrase_of_the_day(test_db)
        assert result1 == result2

    async def test_vocabulary_fallback(self, test_db):
        """Falls back to vocabulary example_sentence when no conversations exist."""
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "reservation", "meaning": "予約",
             "example_sentence": "I would like to make a reservation for two nights please."},
        ])
        assert len(words) == 1

        result = await get_phrase_of_the_day(test_db)
        assert result is not None
        assert result["source"] == "vocabulary"
        assert result["topic"] == "hotel_checkin"

    async def test_long_phrases_excluded(self, test_db):
        """Phrases longer than 80 chars are filtered out."""
        conv = await create_conversation(test_db, "hotel_checkin", "beginner")
        long_msg = "A" * 81  # Exactly 81 chars — too long
        await add_message(test_db, conv, "assistant", long_msg + ".")
        await end_conversation(test_db, conv)

        result = await get_phrase_of_the_day(test_db)
        assert result is None


@pytest.mark.unit
class TestGetVocabularyActivation:
    async def test_empty_database(self, test_db):
        """Returns zeroes when no vocabulary progress exists."""
        result = await get_vocabulary_activation(test_db)
        assert result["total_studied"] == 0
        assert result["total_activated"] == 0
        assert result["activation_rate"] == 0.0
        assert result["activated_words"] == []
        assert result["unactivated_words"] == []
        assert result["by_topic"] == []

    async def test_word_boundary_matching(self, test_db):
        """'at' should NOT match 'cat' — word boundary matching."""
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "at", "meaning": "〜で", "example_sentence": "Meet me at the hotel lobby."},
        ])
        await update_progress(test_db, words[0]["id"], True)

        # Create conversation with 'cat' but not standalone 'at'
        conv = await create_conversation(test_db, "hotel_checkin", "beginner")
        await add_message(test_db, conv, "user", "I saw a cat in the lobby")
        await end_conversation(test_db, conv)

        result = await get_vocabulary_activation(test_db)
        assert result["total_studied"] == 1
        assert result["total_activated"] == 0
        assert len(result["unactivated_words"]) == 1

    async def test_activated_word_counting(self, test_db):
        """Counts times_used correctly across multiple messages."""
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "reservation", "meaning": "予約",
             "example_sentence": "I have a reservation."},
        ])
        await update_progress(test_db, words[0]["id"], True)

        conv = await create_conversation(test_db, "hotel_checkin", "beginner")
        await add_message(test_db, conv, "user", "I have a reservation for tonight")
        await add_message(test_db, conv, "user", "Can you check my reservation please")
        await end_conversation(test_db, conv)

        result = await get_vocabulary_activation(test_db)
        assert result["total_studied"] == 1
        assert result["total_activated"] == 1
        assert result["activated_words"][0]["times_used"] == 2

    async def test_per_topic_stats(self, test_db):
        """Computes per-topic activation rates correctly."""
        hotel_words = await save_words(test_db, "hotel_checkin", [
            {"word": "lobby", "meaning": "ロビー", "example_sentence": "Wait in the lobby."},
        ])
        restaurant_words = await save_words(test_db, "restaurant", [
            {"word": "menu", "meaning": "メニュー", "example_sentence": "May I see the menu?"},
        ])
        await update_progress(test_db, hotel_words[0]["id"], True)
        await update_progress(test_db, restaurant_words[0]["id"], True)

        conv = await create_conversation(test_db, "hotel_checkin", "beginner")
        await add_message(test_db, conv, "user", "I will wait in the lobby")
        await end_conversation(test_db, conv)

        result = await get_vocabulary_activation(test_db)
        topic_map = {t["topic"]: t for t in result["by_topic"]}
        assert topic_map["hotel_checkin"]["activated"] == 1
        assert topic_map["hotel_checkin"]["rate"] == 100.0
        assert topic_map["restaurant"]["activated"] == 0
        assert topic_map["restaurant"]["rate"] == 0.0

    async def test_limit_parameter(self, test_db):
        """Limit caps both activated and unactivated lists."""
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "lobby", "meaning": "ロビー", "example_sentence": "Wait in the lobby."},
            {"word": "check", "meaning": "チェック", "example_sentence": "Please check in here."},
            {"word": "room", "meaning": "部屋", "example_sentence": "This is your room key."},
        ])
        for w in words:
            await update_progress(test_db, w["id"], True)

        result = await get_vocabulary_activation(test_db, limit=1)
        assert len(result["unactivated_words"]) <= 1

    async def test_activated_sorted_by_usage(self, test_db):
        """Activated words are sorted by times_used descending."""
        words = await save_words(test_db, "hotel_checkin", [
            {"word": "lobby", "meaning": "ロビー", "example_sentence": "Wait in the lobby."},
            {"word": "room", "meaning": "部屋", "example_sentence": "This is your room key."},
        ])
        for w in words:
            await update_progress(test_db, w["id"], True)

        conv = await create_conversation(test_db, "hotel_checkin", "beginner")
        await add_message(test_db, conv, "user", "I need a room")
        await add_message(test_db, conv, "user", "Show me the room and lobby")
        await add_message(test_db, conv, "user", "The room is nice")
        await end_conversation(test_db, conv)

        result = await get_vocabulary_activation(test_db)
        assert len(result["activated_words"]) == 2
        assert result["activated_words"][0]["word"] == "room"
        assert result["activated_words"][0]["times_used"] == 3
        assert result["activated_words"][1]["word"] == "lobby"
        assert result["activated_words"][1]["times_used"] == 1


@pytest.mark.unit
class TestGetFluencyProgression:
    async def test_empty_database(self, test_db):
        result = await get_fluency_progression(test_db)
        assert result["sessions"] == []
        assert result["session_count"] == 0
        assert result["trend"] == "insufficient_data"

    async def test_single_session(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {
            "performance": {
                "grammar_accuracy_rate": 80,
                "vocabulary_diversity": 60,
                "avg_words_per_message": 12,
                "total_user_messages": 8,
            }
        }
        await end_conversation(test_db, cid, summary=summary)

        result = await get_fluency_progression(test_db)
        assert result["session_count"] == 1
        assert len(result["sessions"]) == 1
        session = result["sessions"][0]
        assert session["topic"] == "hotel_checkin"
        assert session["grammar_accuracy_rate"] == 80.0
        assert session["vocabulary_diversity"] == 60.0
        assert session["avg_words_per_message"] == 12.0
        assert session["total_user_messages"] == 8
        assert session["fluency_score"] > 0
        assert session["personal_best"] is True
        assert result["trend"] == "insufficient_data"

    async def test_improving_trend(self, test_db):
        import json

        for i in range(6):
            cid = await create_conversation(test_db, "hotel_checkin")
            summary = {
                "performance": {
                    "grammar_accuracy_rate": 40 + i * 10,
                    "vocabulary_diversity": 30 + i * 10,
                    "avg_words_per_message": 5 + i * 2,
                    "total_user_messages": 3 + i * 2,
                }
            }
            await test_db.execute(
                "UPDATE conversations SET started_at = ?, status = 'ended', summary_json = ? WHERE id = ?",
                (f"2026-01-0{i + 1} 10:00:00", json.dumps(summary), cid),
            )
        await test_db.commit()

        result = await get_fluency_progression(test_db)
        assert result["session_count"] == 6
        assert result["trend"] == "improving"
        # Last session should have highest score and be personal best
        assert result["sessions"][-1]["personal_best"] is True

    async def test_personal_best_on_highest_score(self, test_db):
        import json

        scores = [50, 80, 60, 70]
        for i, grammar in enumerate(scores):
            cid = await create_conversation(test_db, "hotel_checkin")
            summary = {
                "performance": {
                    "grammar_accuracy_rate": grammar,
                    "vocabulary_diversity": grammar,
                    "avg_words_per_message": 10,
                    "total_user_messages": 5,
                }
            }
            await test_db.execute(
                "UPDATE conversations SET started_at = ?, status = 'ended', summary_json = ? WHERE id = ?",
                (f"2026-01-0{i + 1} 10:00:00", json.dumps(summary), cid),
            )
        await test_db.commit()

        result = await get_fluency_progression(test_db)
        best_sessions = [s for s in result["sessions"] if s["personal_best"]]
        assert len(best_sessions) == 1
        assert best_sessions[0]["grammar_accuracy_rate"] == 80.0

    async def test_skips_conversations_without_performance(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {"other_key": "value"}
        await end_conversation(test_db, cid, summary=summary)

        result = await get_fluency_progression(test_db)
        assert result["sessions"] == []
        assert result["session_count"] == 0


@pytest.mark.unit
class TestGetTopicCoverage:
    async def test_empty_database_returns_all_topics_with_zero_counts(self, test_db):
        result = await get_topic_coverage(test_db)
        assert result["total_topics"] > 0
        assert result["practiced_count"] == 0
        assert result["coverage_rate"] == 0.0
        for topic in result["topics"]:
            assert topic["practice_count"] == 0
            assert topic["last_practiced_at"] is None
            assert topic["grammar_accuracy"] is None
            assert "topic_id" in topic
            assert "label" in topic

    async def test_practiced_topic_has_correct_count(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid1)
        cid2 = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid2)
        await test_db.commit()

        result = await get_topic_coverage(test_db)
        hotel = next(t for t in result["topics"] if t["topic_id"] == "hotel_checkin")
        assert hotel["practice_count"] == 2
        assert hotel["last_practiced_at"] is not None

    async def test_coverage_rate_reflects_practiced_ratio(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid)
        await test_db.commit()

        result = await get_topic_coverage(test_db)
        total = result["total_topics"]
        expected_rate = round(1 / total * 100, 1)
        assert result["practiced_count"] == 1
        assert result["coverage_rate"] == expected_rate

    async def test_grammar_accuracy_from_summary(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {"performance": {"grammar_accuracy_rate": 85.0}}
        await end_conversation(test_db, cid, summary=summary)
        await test_db.commit()

        result = await get_topic_coverage(test_db)
        hotel = next(t for t in result["topics"] if t["topic_id"] == "hotel_checkin")
        assert hotel["grammar_accuracy"] == 85.0

    async def test_unpracticed_topic_has_null_accuracy(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid)
        await test_db.commit()

        result = await get_topic_coverage(test_db)
        unpracticed = [t for t in result["topics"] if t["practice_count"] == 0]
        assert len(unpracticed) > 0
        for t in unpracticed:
            assert t["grammar_accuracy"] is None

    async def test_multiple_topics_practiced(self, test_db):
        for topic_id in ["hotel_checkin", "restaurant_order"]:
            cid = await create_conversation(test_db, topic_id)
            await end_conversation(test_db, cid)
        await test_db.commit()

        result = await get_topic_coverage(test_db)
        assert result["practiced_count"] == 2
        hotel = next(t for t in result["topics"] if t["topic_id"] == "hotel_checkin")
        restaurant = next(t for t in result["topics"] if t["topic_id"] == "restaurant_order")
        assert hotel["practice_count"] == 1
        assert restaurant["practice_count"] == 1


@pytest.mark.unit
class TestGetReviewQueue:
    async def test_empty_database(self, test_db):
        result = await get_review_queue(test_db)
        assert result == []

    async def test_vocabulary_items_due(self, test_db):
        words = [{"word": "hello", "meaning": "greeting", "example_sentence": "Hello!", "difficulty": 1}]
        await save_words(test_db, "greetings", words)
        await test_db.commit()
        # Get the word id
        row = await test_db.execute_fetchall("SELECT id FROM vocabulary_words LIMIT 1")
        word_id = row[0]["id"]
        # Set progress with past review date
        await test_db.execute(
            "INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, level, next_review_at) VALUES (?, 1, 0, 2, '2020-01-01T00:00:00+00:00')",
            (word_id,),
        )
        await test_db.commit()
        result = await get_review_queue(test_db)
        assert len(result) == 1
        assert result[0]["module"] == "vocabulary"
        assert result[0]["detail"]["word"] == "hello"
        assert result[0]["priority"] > 0
        assert result[0]["route"] == "/vocabulary"

    async def test_pronunciation_items(self, test_db):
        await save_attempt(test_db, "Good morning", "Good morning", {}, 4.5)
        await test_db.commit()
        result = await get_review_queue(test_db)
        assert len(result) == 1
        assert result[0]["module"] == "pronunciation"
        assert result[0]["detail"]["latest_score"] == 4.5
        assert result[0]["priority"] == 55  # (10 - 4.5) * 10

    async def test_mixed_items_sorted_by_priority(self, test_db):
        # Add pronunciation with low score (high priority)
        await save_attempt(test_db, "Test phrase", "Test", {}, 2.0)
        # Add vocabulary due for review
        words = [{"word": "cat", "meaning": "animal", "example_sentence": "A cat.", "difficulty": 1}]
        await save_words(test_db, "animals", words)
        await test_db.commit()
        row = await test_db.execute_fetchall("SELECT id FROM vocabulary_words LIMIT 1")
        word_id = row[0]["id"]
        await test_db.execute(
            "INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, level, next_review_at) VALUES (?, 0, 0, 0, '2026-04-14T00:00:00+00:00')",
            (word_id,),
        )
        await test_db.commit()
        result = await get_review_queue(test_db)
        assert len(result) >= 2
        # Pronunciation with score 2.0 should have priority 80, likely higher
        assert result[0]["priority"] >= result[1]["priority"]

    async def test_limit_parameter(self, test_db):
        # Add multiple pronunciation attempts with different texts
        for i in range(5):
            await save_attempt(test_db, f"Phrase {i}", f"Phrase {i}", {}, float(i))
        await test_db.commit()
        result = await get_review_queue(test_db, limit=3)
        assert len(result) == 3

    async def test_pronunciation_above_threshold_excluded(self, test_db):
        await save_attempt(test_db, "Good phrase", "Good phrase", {}, 8.5)
        await test_db.commit()
        result = await get_review_queue(test_db)
        assert len(result) == 0


class TestSpeakingJournalTracking:
    """speaking_journal entries should count in streaks, activity, and achievements."""

    async def test_streak_includes_speaking_journal(self, test_db):
        """A speaking_journal entry today should give streak >= 1."""
        from app.dal.dashboard import _calculate_streak

        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
            ("Describe your day", "I went shopping", 3, 3, 60, 3.0),
        )
        await test_db.commit()
        streak = await _calculate_streak(test_db)
        assert streak >= 1

    async def test_today_activity_includes_speaking_journal(self, test_db):
        """get_today_activity should include speaking_journal_entries."""
        from app.dal.dashboard import get_today_activity

        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
            ("Talk about food", "I like sushi", 3, 3, 60, 3.0),
        )
        await test_db.commit()
        result = await get_today_activity(test_db)
        assert "speaking_journal_entries" in result
        assert result["speaking_journal_entries"] >= 1

    async def test_learning_summary_includes_speaking_journal(self, test_db):
        """get_learning_summary study_days should count speaking_journal days."""
        from app.dal.dashboard import get_learning_summary

        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
            ("Talk about weather", "It is sunny", 3, 3, 60, 3.0),
        )
        await test_db.commit()
        result = await get_learning_summary(test_db)
        assert result["total_study_days"] >= 1

    async def test_module_streaks_includes_speaking_journal(self, test_db):
        """get_module_streaks should have a speaking_journal module."""
        from app.dal.dashboard import get_module_streaks

        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
            ("Describe a trip", "I visited Tokyo", 3, 3, 60, 3.0),
        )
        await test_db.commit()
        result = await get_module_streaks(test_db)
        assert "speaking_journal" in result["modules"]
        assert result["modules"]["speaking_journal"]["current_streak"] >= 1


class TestStreakAtRiskFalsePositive:
    """streak_at_risk should be False when only listening or speaking_journal activity today."""

    async def test_listening_quiz_clears_streak_at_risk(self, test_db):
        """Listening quiz today should not trigger streak_at_risk."""
        from app.dal.dashboard import get_learning_insights

        # Create activity yesterday to establish a streak
        await test_db.execute(
            "INSERT INTO conversations (id, topic, difficulty, started_at) VALUES (1, 'hotel_checkin', 'beginner', datetime('now', '-1 day'))",
        )
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (1, 'user', 'hi', datetime('now', '-1 day'))",
        )
        # Only listening quiz today
        await test_db.execute(
            "INSERT INTO listening_quiz_results (title, difficulty, total_questions, correct_count, score, questions_json, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
            ("Test Quiz", "beginner", 5, 4, 80.0, "[]"),
        )
        await test_db.commit()
        result = await get_learning_insights(test_db)
        assert result["streak_at_risk"] is False

    async def test_speaking_journal_clears_streak_at_risk(self, test_db):
        """Speaking journal today should not trigger streak_at_risk."""
        from app.dal.dashboard import get_learning_insights

        # Create activity yesterday
        await test_db.execute(
            "INSERT INTO conversations (id, topic, difficulty, started_at) VALUES (1, 'hotel_checkin', 'beginner', datetime('now', '-1 day'))",
        )
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (1, 'user', 'hello', datetime('now', '-1 day'))",
        )
        # Only speaking journal today
        await test_db.execute(
            "INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
            ("Talk about travel", "I love Japan", 3, 3, 60, 3.0),
        )
        await test_db.commit()
        result = await get_learning_insights(test_db)
        assert result["streak_at_risk"] is False


@pytest.mark.unit
class TestGetStudyPlan:
    async def test_empty_database_returns_some_steps(self, test_db):
        """Even with no data, the plan should return steps (e.g. conversation topic)."""
        result = await get_study_plan(test_db)
        assert isinstance(result, list)
        # Should have at most 5 steps
        assert len(result) <= 5
        for step in result:
            assert "type" in step
            assert "icon" in step
            assert "title" in step
            assert "description" in step
            assert "estimated_minutes" in step
            assert "route" in step
            assert isinstance(step["estimated_minutes"], int)
            assert step["estimated_minutes"] > 0

    async def test_includes_vocab_review_when_due(self, test_db):
        """Plan should include a vocabulary review step when words are due."""
        words = [
            {"word": "hello", "correct_meaning": "greeting"},
            {"word": "goodbye", "correct_meaning": "farewell"},
        ]
        await save_words(test_db, "hotel_checkin", words)
        # Set next_review_at to the past so they're due
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now', '-1 day')"
        )
        await test_db.commit()

        result = await get_study_plan(test_db)
        vocab_steps = [s for s in result if s["type"] == "vocabulary_review"]
        assert len(vocab_steps) == 1
        assert "/vocabulary" in vocab_steps[0]["route"]
        assert "2" in vocab_steps[0]["title"]  # "Review 2 due words"

    async def test_includes_pronunciation_practice_when_low_scores(self, test_db):
        """Plan should suggest pronunciation practice when recent scores are low."""
        feedback = {"overall_score": 4}
        await save_attempt(test_db, "The quick brown fox.", "The quick brown fox.", feedback, 4.0)
        await save_attempt(test_db, "Hello world.", "Hello world.", feedback, 5.0)

        result = await get_study_plan(test_db)
        pron_steps = [s for s in result if s["type"] == "pronunciation_practice"]
        assert len(pron_steps) == 1
        assert "/pronunciation" in pron_steps[0]["route"]

    async def test_includes_grammar_drill_when_errors_exist(self, test_db):
        """Plan should suggest grammar drill when recent messages have errors."""
        import json
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "I go to store yesterday")
        feedback = {
            "corrected_text": "I went to the store yesterday",
            "is_correct": False,
            "errors": [
                {"original": "go", "correction": "went", "explanation": "Past tense required"},
            ],
            "suggestions": [],
        }
        await update_message_feedback(test_db, mid, feedback)

        result = await get_study_plan(test_db)
        grammar_steps = [s for s in result if s["type"] == "grammar_drill"]
        assert len(grammar_steps) == 1
        assert "1" in grammar_steps[0]["description"]

    async def test_max_five_steps(self, test_db):
        """Plan should never return more than 5 steps."""
        # Add data across all areas
        import json
        words = [{"word": f"word{i}", "correct_meaning": f"meaning{i}"} for i in range(5)]
        await save_words(test_db, "hotel_checkin", words)
        await test_db.execute(
            "UPDATE vocabulary_progress SET next_review_at = datetime('now', '-1 day')"
        )
        feedback = {"overall_score": 3}
        await save_attempt(test_db, "Test sentence.", "Test sentence.", feedback, 3.0)
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "I go store")
        fb = {
            "corrected_text": "I go to the store",
            "is_correct": False,
            "errors": [{"original": "go store", "correction": "go to the store", "explanation": "Missing preposition"}],
            "suggestions": [],
        }
        await update_message_feedback(test_db, mid, fb)
        await test_db.commit()

        result = await get_study_plan(test_db)
        assert len(result) <= 5

    async def test_step_fields_are_valid(self, test_db):
        """Each step should have all required fields with correct types."""
        # Add some data to generate steps
        feedback = {"overall_score": 5}
        await save_attempt(test_db, "Hello.", "Hello.", feedback, 5.0)

        result = await get_study_plan(test_db)
        for step in result:
            assert isinstance(step["type"], str)
            assert isinstance(step["icon"], str)
            assert isinstance(step["title"], str)
            assert isinstance(step["description"], str)
            assert isinstance(step["estimated_minutes"], int)
            assert isinstance(step["route"], str)
            assert step["route"].startswith("/")


@pytest.mark.unit
class TestGetSelfAssessmentTrend:
    """Tests for get_self_assessment_trend()."""

    async def _insert_conv_and_assessment(self, db, topic, difficulty, conf, flu, comp, created_at=None):
        """Helper: insert a conversation + self-assessment and return conversation_id."""
        cursor = await db.execute(
            "INSERT INTO conversations (topic, difficulty) VALUES (?, ?)",
            (topic, difficulty),
        )
        cid = cursor.lastrowid
        if created_at:
            await db.execute(
                """INSERT INTO conversation_self_assessments
                   (conversation_id, confidence_rating, fluency_rating, comprehension_rating, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (cid, conf, flu, comp, created_at),
            )
        else:
            await db.execute(
                """INSERT INTO conversation_self_assessments
                   (conversation_id, confidence_rating, fluency_rating, comprehension_rating)
                   VALUES (?, ?, ?, ?)""",
                (cid, conf, flu, comp),
            )
        await db.commit()
        return cid

    async def test_empty_database(self, test_db):
        """No assessments should return empty entries and insufficient_data trend."""
        result = await get_self_assessment_trend(test_db)
        assert result["entries"] == []
        assert result["trend"] == "insufficient_data"

    async def test_single_entry(self, test_db):
        """A single assessment returns one entry with insufficient_data trend."""
        await self._insert_conv_and_assessment(
            test_db, "hotel_checkin", "intermediate", 4, 3, 5,
        )
        result = await get_self_assessment_trend(test_db)
        assert len(result["entries"]) == 1
        assert result["trend"] == "insufficient_data"
        entry = result["entries"][0]
        assert entry["confidence_rating"] == 4
        assert entry["fluency_rating"] == 3
        assert entry["comprehension_rating"] == 5
        assert entry["topic"] == "hotel_checkin"
        assert entry["difficulty"] == "intermediate"
        assert entry["overall_rating"] == round((4 + 3 + 5) / 3, 2)

    async def test_rolling_averages(self, test_db):
        """Rolling averages accumulate correctly across entries."""
        await self._insert_conv_and_assessment(
            test_db, "hotel_checkin", "beginner", 2, 2, 2, "2024-01-01 10:00:00",
        )
        await self._insert_conv_and_assessment(
            test_db, "shopping", "intermediate", 4, 4, 4, "2024-01-02 10:00:00",
        )
        result = await get_self_assessment_trend(test_db)
        entries = result["entries"]
        assert len(entries) == 2
        # First entry: rolling = itself
        assert entries[0]["rolling_confidence"] == 2.0
        # Second entry: avg of (2,4) = 3.0
        assert entries[1]["rolling_confidence"] == 3.0
        assert entries[1]["rolling_fluency"] == 3.0
        assert entries[1]["rolling_comprehension"] == 3.0

    async def test_trend_improving(self, test_db):
        """Trend is 'improving' when latest 3 > oldest 3."""
        # Oldest 3: low ratings
        for i, rating in enumerate([1, 1, 2]):
            await self._insert_conv_and_assessment(
                test_db, "hotel_checkin", "beginner", rating, rating, rating,
                f"2024-01-0{i+1} 10:00:00",
            )
        # Latest 3: high ratings
        for i, rating in enumerate([4, 5, 5]):
            await self._insert_conv_and_assessment(
                test_db, "shopping", "advanced", rating, rating, rating,
                f"2024-01-0{i+4} 10:00:00",
            )
        result = await get_self_assessment_trend(test_db)
        assert result["trend"] == "improving"

    async def test_trend_declining(self, test_db):
        """Trend is 'declining' when latest 3 < oldest 3."""
        for i, rating in enumerate([5, 5, 4]):
            await self._insert_conv_and_assessment(
                test_db, "hotel_checkin", "advanced", rating, rating, rating,
                f"2024-01-0{i+1} 10:00:00",
            )
        for i, rating in enumerate([1, 1, 2]):
            await self._insert_conv_and_assessment(
                test_db, "shopping", "beginner", rating, rating, rating,
                f"2024-01-0{i+4} 10:00:00",
            )
        result = await get_self_assessment_trend(test_db)
        assert result["trend"] == "declining"

    async def test_trend_stable(self, test_db):
        """Trend is 'stable' when latest 3 ≈ oldest 3."""
        for i in range(6):
            await self._insert_conv_and_assessment(
                test_db, "hotel_checkin", "intermediate", 3, 3, 3,
                f"2024-01-0{i+1} 10:00:00",
            )
        result = await get_self_assessment_trend(test_db)
        assert result["trend"] == "stable"

    async def test_limit_parameter(self, test_db):
        """The limit parameter caps the number of returned entries."""
        for i in range(5):
            await self._insert_conv_and_assessment(
                test_db, "hotel_checkin", "intermediate", 3, 3, 3,
                f"2024-01-0{i+1} 10:00:00",
            )
        result = await get_self_assessment_trend(test_db, limit=3)
        assert len(result["entries"]) == 3

    async def test_entry_fields_present(self, test_db):
        """All expected fields are present in each entry."""
        await self._insert_conv_and_assessment(
            test_db, "shopping", "advanced", 5, 4, 3,
        )
        result = await get_self_assessment_trend(test_db)
        entry = result["entries"][0]
        expected_keys = {
            "id", "conversation_id", "topic", "difficulty",
            "confidence_rating", "fluency_rating", "comprehension_rating",
            "overall_rating", "rolling_confidence", "rolling_fluency",
            "rolling_comprehension", "rolling_overall", "created_at",
        }
        assert set(entry.keys()) == expected_keys
