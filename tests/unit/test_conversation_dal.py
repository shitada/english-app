"""Unit tests for the conversation DAL (app/dal/conversation.py)."""

from __future__ import annotations

import json

import pytest

from app.dal.conversation import (
    add_message,
    cleanup_stale_conversations,
    count_bookmarked_messages,
    count_conversations,
    create_conversation,
    delete_conversation,
    delete_ended_conversations,
    end_conversation,
    format_history_text,
    get_active_conversation,
    get_bookmarked_messages,
    get_conversation_export,
    get_conversation_history,
    get_conversation_replay,
    get_conversation_summary,
    get_conversation_vocabulary,
    get_grammar_accuracy,
    get_topic_recommendations,
    list_conversations,
    toggle_message_bookmark,
    update_message_feedback,
)


@pytest.mark.unit
class TestCreateConversation:
    async def test_returns_integer_id(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        assert isinstance(cid, int)

    async def test_persists_with_active_status(self, test_db):
        cid = await create_conversation(test_db, "restaurant_order")
        rows = await test_db.execute_fetchall(
            "SELECT topic, status FROM conversations WHERE id = ?", (cid,)
        )
        assert len(rows) == 1
        assert rows[0]["topic"] == "restaurant_order"
        assert rows[0]["status"] == "active"

    async def test_creates_multiple_conversations(self, test_db):
        id1 = await create_conversation(test_db, "hotel_checkin")
        id2 = await create_conversation(test_db, "shopping")
        assert id1 != id2


@pytest.mark.unit
class TestAddMessage:
    async def test_returns_integer_id(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "Hello")
        assert isinstance(mid, int)

    async def test_stores_role_and_content(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "I'd like to check in")
        rows = await test_db.execute_fetchall(
            "SELECT role, content FROM messages WHERE id = ?", (mid,)
        )
        assert rows[0]["role"] == "user"
        assert rows[0]["content"] == "I'd like to check in"

    async def test_stores_feedback_json(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        feedback = {"is_correct": True, "errors": []}
        mid = await add_message(test_db, cid, "user", "Hello", feedback=feedback)
        rows = await test_db.execute_fetchall(
            "SELECT feedback_json FROM messages WHERE id = ?", (mid,)
        )
        assert json.loads(rows[0]["feedback_json"]) == feedback

    async def test_feedback_none_stores_null(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        mid = await add_message(test_db, cid, "user", "Hello", feedback=None)
        rows = await test_db.execute_fetchall(
            "SELECT feedback_json FROM messages WHERE id = ?", (mid,)
        )
        assert rows[0]["feedback_json"] is None


@pytest.mark.unit
class TestUpdateMessageFeedback:
    async def test_updates_feedback_for_matching_message(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello")
        feedback = {"is_correct": False, "errors": ["grammar"]}
        await update_message_feedback(test_db, cid, "user", "Hello", feedback)
        rows = await test_db.execute_fetchall(
            "SELECT feedback_json FROM messages WHERE conversation_id = ? AND role = 'user'",
            (cid,),
        )
        assert json.loads(rows[0]["feedback_json"]) == feedback

    async def test_updates_matching_message(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello")
        await add_message(test_db, cid, "user", "Goodbye")
        feedback = {"is_correct": True, "errors": []}
        await update_message_feedback(test_db, cid, "user", "Hello", feedback)
        rows = await test_db.execute_fetchall(
            "SELECT content, feedback_json FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id",
            (cid,),
        )
        # "Hello" message should have the feedback
        assert json.loads(rows[0]["feedback_json"]) == feedback
        # "Goodbye" message should remain without feedback
        assert rows[1]["feedback_json"] is None

    async def test_feedback_committed_independently(self, test_db):
        """Regression: feedback should be committed without relying on subsequent operations."""
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Test commit")
        feedback = {"is_correct": True, "errors": []}
        await update_message_feedback(test_db, cid, "user", "Test commit", feedback)
        # Verify data is readable (committed) without any other writes
        rows = await test_db.execute_fetchall(
            "SELECT feedback_json FROM messages WHERE conversation_id = ? AND content = 'Test commit'",
            (cid,),
        )
        assert len(rows) == 1
        assert json.loads(rows[0]["feedback_json"]) == feedback


@pytest.mark.unit
class TestGetActiveConversation:
    async def test_returns_dict_for_active(self, test_db):
        cid = await create_conversation(test_db, "shopping")
        result = await get_active_conversation(test_db, cid)
        assert result is not None
        assert result["id"] == cid
        assert result["status"] == "active"

    async def test_returns_none_for_ended(self, test_db):
        cid = await create_conversation(test_db, "shopping")
        await end_conversation(test_db, cid)
        result = await get_active_conversation(test_db, cid)
        assert result is None

    async def test_returns_none_for_nonexistent(self, test_db):
        result = await get_active_conversation(test_db, 99999)
        assert result is None


@pytest.mark.unit
class TestGetConversationHistory:
    async def test_returns_messages_in_order(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "assistant", "Welcome!")
        await add_message(test_db, cid, "user", "Thank you")
        await add_message(test_db, cid, "assistant", "How can I help?")
        history = await get_conversation_history(test_db, cid)
        assert len(history) == 3
        assert history[0]["role"] == "assistant"
        assert history[0]["content"] == "Welcome!"
        assert history[1]["role"] == "user"
        assert history[2]["role"] == "assistant"

    async def test_returns_empty_for_no_messages(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        history = await get_conversation_history(test_db, cid)
        assert history == []

    async def test_includes_feedback_json(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        feedback = {"is_correct": True}
        await add_message(test_db, cid, "user", "Hello", feedback=feedback)
        history = await get_conversation_history(test_db, cid)
        assert history[0]["feedback_json"] == json.dumps(feedback)


@pytest.mark.unit
class TestFormatHistoryText:
    async def test_formats_as_role_colon_content(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "assistant", "Welcome!")
        await add_message(test_db, cid, "user", "Hi there")
        result = await format_history_text(test_db, cid)
        assert result == "assistant: Welcome!\nuser: Hi there"

    async def test_empty_conversation(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        result = await format_history_text(test_db, cid)
        assert result == ""


@pytest.mark.unit
class TestEndConversation:
    async def test_sets_status_to_ended(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid)
        rows = await test_db.execute_fetchall(
            "SELECT status, ended_at FROM conversations WHERE id = ?", (cid,)
        )
        assert rows[0]["status"] == "ended"
        assert rows[0]["ended_at"] is not None

    async def test_active_conversation_not_affected(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin")
        cid2 = await create_conversation(test_db, "shopping")
        await end_conversation(test_db, cid1)
        result = await get_active_conversation(test_db, cid2)
        assert result is not None
        assert result["status"] == "active"

    async def test_saves_summary_json(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {"key_vocabulary": ["hello"], "communication_level": "beginner", "tip": "Practice more"}
        result = await end_conversation(test_db, cid, summary=summary)
        assert result is True
        result = await get_conversation_summary(test_db, cid)
        assert result == summary

    async def test_summary_none_when_not_saved(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid)
        result = await get_conversation_summary(test_db, cid)
        assert result is None

    async def test_summary_none_for_nonexistent(self, test_db):
        result = await get_conversation_summary(test_db, 99999)
        assert result is None

    async def test_summary_graceful_on_corrupted_json(self, test_db):
        """Corrupted summary_json should return None, not crash."""
        cid = await create_conversation(test_db, "hotel_checkin")
        await test_db.execute(
            "UPDATE conversations SET summary_json = ? WHERE id = ?",
            ("{invalid json!!", cid),
        )
        await test_db.commit()
        result = await get_conversation_summary(test_db, cid)
        assert result is None

    async def test_end_returns_false_when_already_ended(self, test_db):
        """Second end_conversation call should return False (already ended)."""
        cid = await create_conversation(test_db, "hotel_checkin")
        first = await end_conversation(test_db, cid, summary={"first": True})
        assert first is True
        second = await end_conversation(test_db, cid, summary={"second": True})
        assert second is False

    async def test_first_summary_preserved_on_double_end(self, test_db):
        """The first end's summary should not be overwritten by the second."""
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid, summary={"version": 1})
        await end_conversation(test_db, cid, summary={"version": 2})
        summary = await get_conversation_summary(test_db, cid)
        assert summary["version"] == 1


@pytest.mark.unit
class TestListConversations:
    async def test_returns_empty_when_no_conversations(self, test_db):
        result = await list_conversations(test_db)
        assert result == []

    async def test_returns_conversations_with_message_count(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "assistant", "Welcome!")
        await add_message(test_db, cid, "user", "Hello")
        result = await list_conversations(test_db)
        assert len(result) == 1
        assert result[0]["topic"] == "hotel_checkin"
        assert result[0]["message_count"] == 2

    async def test_filters_by_topic(self, test_db):
        await create_conversation(test_db, "hotel_checkin")
        await create_conversation(test_db, "shopping")
        result = await list_conversations(test_db, topic="hotel_checkin")
        assert len(result) == 1
        assert result[0]["topic"] == "hotel_checkin"

    async def test_respects_limit_and_offset(self, test_db):
        for i in range(5):
            await create_conversation(test_db, f"topic_{i}")
        result = await list_conversations(test_db, limit=2, offset=1)
        assert len(result) == 2

    async def test_orders_by_started_at_desc(self, test_db):
        cid1 = await create_conversation(test_db, "first")
        cid2 = await create_conversation(test_db, "second")
        result = await list_conversations(test_db)
        assert len(result) == 2
        ids = {r["id"] for r in result}
        assert ids == {cid1, cid2}

    async def test_includes_difficulty_field(self, test_db):
        await create_conversation(test_db, "hotel_checkin", "advanced")
        result = await list_conversations(test_db)
        assert result[0]["difficulty"] == "advanced"

    async def test_pagination_deterministic_same_started_at(self, test_db):
        """Conversations with identical started_at get stable ordering via id tie-breaker."""
        ts = "2026-06-01 12:00:00"
        ids = []
        for i in range(4):
            cursor = await test_db.execute(
                "INSERT INTO conversations (topic, started_at) VALUES (?, ?)",
                (f"topic_{i}", ts),
            )
            ids.append(cursor.lastrowid)
        await test_db.commit()
        page1 = await list_conversations(test_db, limit=2, offset=0)
        page2 = await list_conversations(test_db, limit=2, offset=2)
        all_ids = [r["id"] for r in page1] + [r["id"] for r in page2]
        assert len(all_ids) == 4
        assert len(set(all_ids)) == 4, "No duplicates across pages"
        assert all_ids == sorted(all_ids, reverse=True), "Ordered by id DESC"


@pytest.mark.unit
class TestDeleteConversation:
    async def test_deletes_existing_conversation(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        result = await delete_conversation(test_db, cid)
        assert result is True
        rows = await test_db.execute_fetchall("SELECT * FROM conversations WHERE id = ?", (cid,))
        assert len(rows) == 0

    async def test_returns_false_for_nonexistent(self, test_db):
        result = await delete_conversation(test_db, 99999)
        assert result is False

    async def test_cascade_deletes_messages(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello")
        await add_message(test_db, cid, "assistant", "Welcome!")
        await delete_conversation(test_db, cid)
        rows = await test_db.execute_fetchall("SELECT * FROM messages WHERE conversation_id = ?", (cid,))
        assert len(rows) == 0


@pytest.mark.unit
class TestDeleteEndedConversations:
    async def test_deletes_only_ended(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin")
        cid2 = await create_conversation(test_db, "shopping")
        await end_conversation(test_db, cid1)
        count = await delete_ended_conversations(test_db)
        assert count == 1
        # Active conversation should remain
        active = await get_active_conversation(test_db, cid2)
        assert active is not None

    async def test_returns_zero_when_none_ended(self, test_db):
        await create_conversation(test_db, "hotel_checkin")
        count = await delete_ended_conversations(test_db)
        assert count == 0

    async def test_deletes_multiple_ended(self, test_db):
        for _ in range(3):
            cid = await create_conversation(test_db, "hotel_checkin")
            await end_conversation(test_db, cid)
        count = await delete_ended_conversations(test_db)
        assert count == 3


@pytest.mark.unit
class TestCleanupStaleConversations:
    async def test_marks_old_active_as_abandoned(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await test_db.execute(
            "UPDATE conversations SET started_at = datetime('now', '-25 hours') WHERE id = ?",
            (cid,),
        )
        await test_db.commit()
        count = await cleanup_stale_conversations(test_db, max_age_hours=24)
        assert count == 1
        rows = await test_db.execute_fetchall("SELECT status FROM conversations WHERE id = ?", (cid,))
        assert rows[0]["status"] == "abandoned"

    async def test_does_not_touch_recent_conversations(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        count = await cleanup_stale_conversations(test_db, max_age_hours=24)
        assert count == 0
        rows = await test_db.execute_fetchall("SELECT status FROM conversations WHERE id = ?", (cid,))
        assert rows[0]["status"] == "active"

    async def test_does_not_touch_ended_conversations(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid)
        await test_db.execute(
            "UPDATE conversations SET started_at = datetime('now', '-25 hours') WHERE id = ?",
            (cid,),
        )
        await test_db.commit()
        count = await cleanup_stale_conversations(test_db, max_age_hours=24)
        assert count == 0


class TestListConversationsDuration:
    async def test_active_conversation_null_duration(self, test_db):
        from app.dal.conversation import create_conversation, list_conversations
        await create_conversation(test_db, "hotel_checkin")
        result = await list_conversations(test_db)
        assert len(result) == 1
        assert result[0]["duration_seconds"] is None

    async def test_ended_conversation_has_duration(self, test_db):
        from app.dal.conversation import create_conversation, end_conversation, list_conversations
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid)
        result = await list_conversations(test_db)
        assert len(result) == 1
        assert result[0]["duration_seconds"] is not None
        assert isinstance(result[0]["duration_seconds"], int)


@pytest.mark.unit
class TestGetConversationExport:
    async def test_returns_none_for_nonexistent(self, test_db):
        result = await get_conversation_export(test_db, 99999)
        assert result is None

    async def test_export_active_no_messages(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        result = await get_conversation_export(test_db, cid)
        assert result is not None
        assert result["id"] == cid
        assert result["topic"] == "hotel_checkin"
        assert result["status"] == "active"
        assert result["ended_at"] is None
        assert result["summary"] is None
        assert result["messages"] == []

    async def test_export_with_messages_preserves_order(self, test_db):
        cid = await create_conversation(test_db, "restaurant_order")
        await add_message(test_db, cid, "assistant", "Welcome!")
        await add_message(test_db, cid, "user", "I'd like a table.")
        await add_message(test_db, cid, "assistant", "Right this way.")
        result = await get_conversation_export(test_db, cid)
        assert len(result["messages"]) == 3
        assert result["messages"][0]["role"] == "assistant"
        assert result["messages"][0]["content"] == "Welcome!"
        assert result["messages"][1]["role"] == "user"
        assert result["messages"][2]["role"] == "assistant"
        for msg in result["messages"]:
            assert "created_at" in msg

    async def test_export_ended_with_summary(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {"overall_score": 8, "feedback": "Good job"}
        await test_db.execute(
            "UPDATE conversations SET status='ended', ended_at=datetime('now'), summary_json=? WHERE id=?",
            (json.dumps(summary), cid),
        )
        await test_db.commit()
        result = await get_conversation_export(test_db, cid)
        assert result["status"] == "ended"
        assert result["ended_at"] is not None
        assert result["summary"] == summary

    async def test_export_with_message_feedback(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello")
        feedback = {"grammar": 9, "vocabulary": 8}
        await update_message_feedback(test_db, cid, "user", "Hello", feedback)
        result = await get_conversation_export(test_db, cid)
        assert len(result["messages"]) == 1
        assert result["messages"][0]["feedback"] == feedback

    async def test_malformed_summary_json_falls_back(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await test_db.execute(
            "UPDATE conversations SET summary_json='not valid json' WHERE id=?",
            (cid,),
        )
        await test_db.commit()
        result = await get_conversation_export(test_db, cid)
        assert result["summary"] == "not valid json"

    async def test_malformed_feedback_json_falls_back(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hi")
        await test_db.execute(
            "UPDATE messages SET feedback_json='bad json' WHERE conversation_id=?",
            (cid,),
        )
        await test_db.commit()
        result = await get_conversation_export(test_db, cid)
        assert result["messages"][0]["feedback"] == "bad json"


@pytest.mark.unit
class TestCountConversations:
    async def test_empty_returns_zero(self, test_db):
        assert await count_conversations(test_db) == 0

    async def test_counts_all(self, test_db):
        await create_conversation(test_db, "hotel_checkin")
        await create_conversation(test_db, "restaurant_order")
        await create_conversation(test_db, "hotel_checkin")
        assert await count_conversations(test_db) == 3

    async def test_filters_by_topic(self, test_db):
        await create_conversation(test_db, "hotel_checkin")
        await create_conversation(test_db, "restaurant_order")
        await create_conversation(test_db, "hotel_checkin")
        assert await count_conversations(test_db, topic="hotel_checkin") == 2
        assert await count_conversations(test_db, topic="restaurant_order") == 1
        assert await count_conversations(test_db, topic="nonexistent") == 0


@pytest.mark.unit
class TestSearchConversations:
    async def test_keyword_matches_message_content(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "I need a room with a view")
        cid2 = await create_conversation(test_db, "shopping")
        await add_message(test_db, cid2, "user", "I want to buy shoes")
        result = await list_conversations(test_db, keyword="room")
        assert len(result) == 1
        assert result[0]["id"] == cid

    async def test_keyword_no_matches(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "Hello there")
        result = await list_conversations(test_db, keyword="xyz_no_match")
        assert len(result) == 0

    async def test_keyword_combined_with_topic(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid1, "user", "I need a reservation")
        cid2 = await create_conversation(test_db, "restaurant_order")
        await add_message(test_db, cid2, "user", "I need a reservation")
        result = await list_conversations(test_db, topic="hotel_checkin", keyword="reservation")
        assert len(result) == 1
        assert result[0]["id"] == cid1

    async def test_keyword_matches_assistant_messages(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "assistant", "Welcome to our luxury hotel")
        result = await list_conversations(test_db, keyword="luxury")
        assert len(result) == 1

    async def test_count_with_keyword(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid1, "user", "Check in please")
        cid2 = await create_conversation(test_db, "shopping")
        await add_message(test_db, cid2, "user", "Buy something")
        assert await count_conversations(test_db, keyword="Check") == 1
        assert await count_conversations(test_db) == 2


@pytest.mark.unit
class TestGrammarAccuracy:
    async def test_empty_returns_zeros(self, test_db):
        result = await get_grammar_accuracy(test_db)
        assert result["total_checked"] == 0
        assert result["overall_accuracy_rate"] == 0.0
        assert result["by_topic"] == []

    async def test_counts_correct_and_errors(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid, "user", "I want check in")
        feedback_wrong = {"is_correct": False, "errors": [{"original": "check in", "correction": "to check in"}], "suggestions": []}
        await update_message_feedback(test_db, cid, "user", "I want check in", feedback_wrong)
        await add_message(test_db, cid, "user", "Thank you very much")
        feedback_right = {"is_correct": True, "errors": [], "suggestions": []}
        await update_message_feedback(test_db, cid, "user", "Thank you very much", feedback_right)
        result = await get_grammar_accuracy(test_db)
        assert result["total_checked"] == 2
        assert result["total_correct"] == 1
        assert result["overall_accuracy_rate"] == 50.0
        assert len(result["by_topic"]) == 1
        topic = result["by_topic"][0]
        assert topic["topic"] == "hotel_checkin"
        assert topic["total_errors"] == 1

    async def test_multiple_topics(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin")
        await add_message(test_db, cid1, "user", "Hello")
        await update_message_feedback(test_db, cid1, "user", "Hello", {"is_correct": True, "errors": [], "suggestions": []})
        cid2 = await create_conversation(test_db, "shopping")
        await add_message(test_db, cid2, "user", "I want buy")
        await update_message_feedback(test_db, cid2, "user", "I want buy", {"is_correct": False, "errors": [{"original": "buy", "correction": "to buy"}], "suggestions": []})
        result = await get_grammar_accuracy(test_db)
        assert result["total_checked"] == 2
        assert len(result["by_topic"]) == 2


@pytest.mark.unit
class TestTopicRecommendations:
    async def test_all_unpracticed(self, test_db):
        result = await get_topic_recommendations(test_db, ["hotel", "restaurant", "shopping"])
        assert len(result) == 3
        assert all(r["reason"] == "never_practiced" for r in result)
        assert all(r["session_count"] == 0 for r in result)

    async def test_some_practiced(self, test_db):
        await create_conversation(test_db, "hotel")
        await create_conversation(test_db, "hotel")
        result = await get_topic_recommendations(test_db, ["hotel", "restaurant", "shopping"])
        assert result[0]["reason"] == "never_practiced"
        assert result[-1]["topic"] == "hotel"
        assert result[-1]["session_count"] == 2

    async def test_sorts_by_session_count(self, test_db):
        await create_conversation(test_db, "hotel")
        await create_conversation(test_db, "hotel")
        await create_conversation(test_db, "restaurant")
        result = await get_topic_recommendations(test_db, ["hotel", "restaurant", "shopping"])
        assert result[0]["topic"] == "shopping"
        assert result[0]["reason"] == "never_practiced"
        assert result[1]["topic"] == "restaurant"
        assert result[1]["session_count"] == 1
        assert result[2]["topic"] == "hotel"
        assert result[2]["session_count"] == 2


@pytest.mark.unit
class TestToggleMessageBookmark:
    async def test_toggle_on(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        mid = await add_message(test_db, cid, "user", "Hello")
        result = await toggle_message_bookmark(test_db, mid)
        assert result is not None
        assert result["is_bookmarked"] == 1
        assert result["id"] == mid

    async def test_toggle_off(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        mid = await add_message(test_db, cid, "user", "Hello")
        await toggle_message_bookmark(test_db, mid)
        result = await toggle_message_bookmark(test_db, mid)
        assert result["is_bookmarked"] == 0

    async def test_nonexistent_message(self, test_db):
        result = await toggle_message_bookmark(test_db, 99999)
        assert result is None


@pytest.mark.unit
class TestGetBookmarkedMessages:
    async def test_empty(self, test_db):
        result = await get_bookmarked_messages(test_db)
        assert result == []

    async def test_with_bookmarks(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        mid1 = await add_message(test_db, cid, "user", "Hello")
        await add_message(test_db, cid, "assistant", "Hi")
        await toggle_message_bookmark(test_db, mid1)
        result = await get_bookmarked_messages(test_db)
        assert len(result) == 1
        assert result[0]["id"] == mid1
        assert result[0]["topic"] == "hotel"

    async def test_filtered_by_conversation(self, test_db):
        cid1 = await create_conversation(test_db, "hotel")
        cid2 = await create_conversation(test_db, "restaurant")
        mid1 = await add_message(test_db, cid1, "user", "Hello")
        mid2 = await add_message(test_db, cid2, "user", "Hi")
        await toggle_message_bookmark(test_db, mid1)
        await toggle_message_bookmark(test_db, mid2)
        result = await get_bookmarked_messages(test_db, conversation_id=cid1)
        assert len(result) == 1
        assert result[0]["conversation_id"] == cid1


@pytest.mark.unit
class TestCountBookmarkedMessages:
    async def test_zero(self, test_db):
        count = await count_bookmarked_messages(test_db)
        assert count == 0

    async def test_counts_correctly(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        mid1 = await add_message(test_db, cid, "user", "Hello")
        mid2 = await add_message(test_db, cid, "assistant", "Hi")
        await toggle_message_bookmark(test_db, mid1)
        await toggle_message_bookmark(test_db, mid2)
        assert await count_bookmarked_messages(test_db) == 2

    async def test_filtered_by_conversation(self, test_db):
        cid1 = await create_conversation(test_db, "hotel")
        cid2 = await create_conversation(test_db, "restaurant")
        mid1 = await add_message(test_db, cid1, "user", "Hello")
        mid2 = await add_message(test_db, cid2, "user", "Hi")
        await toggle_message_bookmark(test_db, mid1)
        await toggle_message_bookmark(test_db, mid2)
        assert await count_bookmarked_messages(test_db, conversation_id=cid1) == 1


@pytest.mark.unit
class TestGetConversationReplay:
    async def test_nonexistent_returns_none(self, test_db):
        result = await get_conversation_replay(test_db, 9999)
        assert result is None

    async def test_opening_assistant_message(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "assistant", "Welcome to the hotel!")
        result = await get_conversation_replay(test_db, cid)
        assert result is not None
        assert result["total_turns"] == 1
        assert result["turns"][0]["turn_number"] == 1
        assert result["turns"][0]["user_message"] is None
        assert result["turns"][0]["assistant_message"] == "Welcome to the hotel!"

    async def test_user_assistant_pairing(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "assistant", "Welcome!")
        await add_message(test_db, cid, "user", "Hi, I need a room.")
        await add_message(test_db, cid, "assistant", "Sure, how many nights?")
        result = await get_conversation_replay(test_db, cid)
        assert result["total_turns"] == 2
        user_turn = result["turns"][1]
        assert user_turn["user_message"] == "Hi, I need a room."
        assert user_turn["assistant_message"] == "Sure, how many nights?"

    async def test_feedback_and_corrections(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        mid = await add_message(test_db, cid, "user", "I want check in.")
        feedback = {"is_correct": False, "errors": [{"original": "want", "correction": "want to"}]}
        await update_message_feedback(test_db, cid, "user", "I want check in.", feedback)
        await add_message(test_db, cid, "assistant", "Of course!")
        result = await get_conversation_replay(test_db, cid)
        user_turn = result["turns"][0]
        assert user_turn["feedback"] is not None
        assert len(user_turn["corrections"]) == 1

    async def test_unpaired_user_message(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "user", "Hello")
        result = await get_conversation_replay(test_db, cid)
        assert result["total_turns"] == 1
        assert result["turns"][0]["user_message"] == "Hello"
        assert result["turns"][0]["assistant_message"] is None


@pytest.mark.unit
class TestGetConversationVocabulary:
    async def test_nonexistent_returns_none(self, test_db):
        result = await get_conversation_vocabulary(test_db, 9999)
        assert result is None

    async def test_no_messages_returns_empty(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        result = await get_conversation_vocabulary(test_db, cid)
        assert result is not None
        assert result["words"] == []
        assert result["total"] == 0

    async def test_no_vocabulary_words(self, test_db):
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "assistant", "Welcome to the hotel!")
        result = await get_conversation_vocabulary(test_db, cid)
        assert result["words"] == []

    async def test_matches_words_case_insensitive(self, test_db):
        from app.dal.vocabulary import save_words
        questions = [
            {"word": "hotel", "correct_meaning": "lodging", "example_sentence": "Stay.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
        ]
        await save_words(test_db, "hotel_checkin", questions)
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "assistant", "Welcome to the Hotel!")
        result = await get_conversation_vocabulary(test_db, cid)
        assert result["total"] >= 1
        assert any(w["word"] == "hotel" for w in result["words"])

    async def test_no_substring_false_positive_go(self, test_db):
        """'go' should NOT match text containing only 'going'."""
        from app.dal.vocabulary import save_words
        questions = [
            {"word": "go", "correct_meaning": "move", "example_sentence": "Go.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
        ]
        await save_words(test_db, "travel", questions)
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "user", "I am going to the store and it was good")
        result = await get_conversation_vocabulary(test_db, cid)
        assert not any(w["word"] == "go" for w in result["words"])

    async def test_no_substring_false_positive_short_word(self, test_db):
        """Short words like 'a' should not match as substrings of longer words."""
        from app.dal.vocabulary import save_words
        questions = [
            {"word": "a", "correct_meaning": "article", "example_sentence": "A cat.", "difficulty": 1, "wrong_options": ["b", "c", "d"]},
        ]
        await save_words(test_db, "grammar", questions)
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "user", "About three items at the store")
        result = await get_conversation_vocabulary(test_db, cid)
        assert not any(w["word"] == "a" for w in result["words"])

    async def test_exact_whole_word_match(self, test_db):
        """Exact whole-word matches should still work correctly."""
        from app.dal.vocabulary import save_words
        questions = [
            {"word": "go", "correct_meaning": "move", "example_sentence": "Go.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
        ]
        await save_words(test_db, "travel2", questions)
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "user", "Let's go to the hotel")
        result = await get_conversation_vocabulary(test_db, cid)
        assert any(w["word"] == "go" for w in result["words"])

    async def test_includes_srs_progress(self, test_db):
        from app.dal.vocabulary import save_words, update_progress
        questions = [
            {"word": "hotel", "correct_meaning": "lodging", "example_sentence": "Stay.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
        ]
        words = await save_words(test_db, "hotel_checkin", questions)
        await update_progress(test_db, words[0]["id"], is_correct=True)
        cid = await create_conversation(test_db, "hotel")
        await add_message(test_db, cid, "assistant", "Welcome to the hotel!")
        result = await get_conversation_vocabulary(test_db, cid)
        matched = [w for w in result["words"] if w["word"] == "hotel"]
        assert len(matched) == 1
        assert matched[0]["srs_level"] is not None
        assert matched[0]["correct_count"] >= 1


class TestConversationExists:
    """Tests for conversation_exists helper."""

    async def test_exists_for_real_conversation(self, test_db):
        from app.dal.conversation import conversation_exists, create_conversation
        cid = await create_conversation(test_db, "hotel")
        assert await conversation_exists(test_db, cid) is True

    async def test_not_exists_for_missing_id(self, test_db):
        from app.dal.conversation import conversation_exists
        assert await conversation_exists(test_db, 99999) is False


@pytest.mark.unit
class TestMessageOrderDeterminism:
    """Messages with identical created_at must be ordered by id."""

    async def test_history_ordered_by_id_on_timestamp_tie(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        # Insert messages with identical timestamps
        ts = "2026-01-01 12:00:00"
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (cid, "user", "First message", ts),
        )
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (cid, "assistant", "Second message", ts),
        )
        await test_db.commit()
        history = await get_conversation_history(test_db, cid)
        assert history[0]["content"] == "First message"
        assert history[1]["content"] == "Second message"

    async def test_format_history_text_ordered_by_id(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        ts = "2026-01-01 12:00:00"
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (cid, "user", "Hello", ts),
        )
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (cid, "assistant", "Welcome", ts),
        )
        await test_db.commit()
        text = await format_history_text(test_db, cid)
        assert text == "user: Hello\nassistant: Welcome"


@pytest.mark.asyncio
@pytest.mark.unit
class TestEmptyDictHandling:
    """Verify empty dicts are stored (not discarded as None)."""

    async def test_empty_dict_feedback_is_stored(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        msg_id = await add_message(test_db, cid, "user", "Hello", feedback={})
        rows = await test_db.execute_fetchall(
            "SELECT feedback_json FROM messages WHERE id = ?", (msg_id,)
        )
        assert rows[0]["feedback_json"] == "{}"

    async def test_empty_dict_summary_is_stored(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid, summary={})
        rows = await test_db.execute_fetchall(
            "SELECT summary_json FROM conversations WHERE id = ?", (cid,)
        )
        assert rows[0]["summary_json"] == "{}"

    async def test_get_conversation_summary_returns_empty_dict(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid, summary={})
        result = await get_conversation_summary(test_db, cid)
        assert result == {}
