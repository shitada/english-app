"""Unit tests for the dashboard DAL (app/dal/dashboard.py)."""

from __future__ import annotations

import pytest

from app.dal.conversation import add_message, create_conversation
from app.dal.dashboard import get_stats
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
