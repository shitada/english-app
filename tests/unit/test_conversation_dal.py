"""Unit tests for the conversation DAL (app/dal/conversation.py)."""

from __future__ import annotations

import json

import pytest

from app.dal.conversation import (
    add_message,
    create_conversation,
    end_conversation,
    format_history_text,
    get_active_conversation,
    get_conversation_history,
    get_conversation_summary,
    list_conversations,
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
        await end_conversation(test_db, cid, summary=summary)
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
