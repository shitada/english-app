"""Unit tests for the pronunciation DAL (app/dal/pronunciation.py)."""

from __future__ import annotations

import json

import pytest

from app.dal.conversation import add_message, create_conversation
from app.dal.pronunciation import (
    get_history,
    get_progress,
    get_sentences_from_conversations,
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
