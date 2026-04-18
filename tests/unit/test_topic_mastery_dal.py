"""Unit tests for get_topic_mastery DAL function."""

from __future__ import annotations

import json

import pytest

from app.dal.conversation import (
    create_conversation,
    end_conversation,
    get_topic_mastery,
)


@pytest.mark.unit
class TestGetTopicMastery:
    async def test_empty_returns_empty(self, test_db):
        result = await get_topic_mastery(test_db)
        assert result == {}

    async def test_active_conversations_not_included(self, test_db):
        await create_conversation(test_db, "hotel_checkin")
        result = await get_topic_mastery(test_db)
        assert result == {}

    async def test_single_ended_session_is_bronze(self, test_db):
        cid = await create_conversation(test_db, "hotel_checkin")
        summary = {"performance": {"grammar_accuracy_rate": 50.0}}
        await end_conversation(test_db, cid, summary=summary)

        result = await get_topic_mastery(test_db)
        assert "hotel_checkin" in result
        m = result["hotel_checkin"]
        assert m["tier"] == "bronze"
        assert m["sessions"] == 1
        assert m["avg_grammar"] == 50.0

    async def test_silver_tier_requires_3_sessions_and_60_grammar(self, test_db):
        for _ in range(3):
            cid = await create_conversation(test_db, "restaurant_order")
            summary = {"performance": {"grammar_accuracy_rate": 65.0}}
            await end_conversation(test_db, cid, summary=summary)

        result = await get_topic_mastery(test_db)
        assert result["restaurant_order"]["tier"] == "silver"
        assert result["restaurant_order"]["sessions"] == 3
        assert result["restaurant_order"]["avg_grammar"] == 65.0

    async def test_silver_not_reached_with_low_grammar(self, test_db):
        for _ in range(3):
            cid = await create_conversation(test_db, "restaurant_order")
            summary = {"performance": {"grammar_accuracy_rate": 50.0}}
            await end_conversation(test_db, cid, summary=summary)

        result = await get_topic_mastery(test_db)
        # 3 sessions but grammar < 60% → stays bronze
        assert result["restaurant_order"]["tier"] == "bronze"

    async def test_gold_tier(self, test_db):
        for _ in range(5):
            cid = await create_conversation(test_db, "job_interview", difficulty="intermediate")
            summary = {"performance": {"grammar_accuracy_rate": 85.0}}
            await end_conversation(test_db, cid, summary=summary)

        result = await get_topic_mastery(test_db)
        assert result["job_interview"]["tier"] == "gold"
        assert result["job_interview"]["highest_difficulty"] == "intermediate"

    async def test_diamond_tier(self, test_db):
        for _ in range(8):
            cid = await create_conversation(test_db, "shopping", difficulty="advanced")
            summary = {"performance": {"grammar_accuracy_rate": 95.0}}
            await end_conversation(test_db, cid, summary=summary)

        result = await get_topic_mastery(test_db)
        assert result["shopping"]["tier"] == "diamond"
        assert result["shopping"]["avg_grammar"] == 95.0
        assert result["shopping"]["highest_difficulty"] == "advanced"

    async def test_diamond_not_reached_without_advanced(self, test_db):
        for _ in range(8):
            cid = await create_conversation(test_db, "shopping", difficulty="intermediate")
            summary = {"performance": {"grammar_accuracy_rate": 95.0}}
            await end_conversation(test_db, cid, summary=summary)

        result = await get_topic_mastery(test_db)
        # 8 sessions, 95% grammar, but no advanced → gold
        assert result["shopping"]["tier"] == "gold"

    async def test_multiple_topics(self, test_db):
        # 1 session for hotel → bronze
        cid = await create_conversation(test_db, "hotel_checkin")
        await end_conversation(test_db, cid, summary={"performance": {"grammar_accuracy_rate": 70.0}})

        # 4 sessions for restaurant → silver
        for _ in range(4):
            cid = await create_conversation(test_db, "restaurant_order")
            await end_conversation(test_db, cid, summary={"performance": {"grammar_accuracy_rate": 75.0}})

        result = await get_topic_mastery(test_db)
        assert result["hotel_checkin"]["tier"] == "bronze"
        assert result["restaurant_order"]["tier"] == "silver"

    async def test_no_summary_json_still_counted(self, test_db):
        cid = await create_conversation(test_db, "airport")
        await end_conversation(test_db, cid, summary=None)

        result = await get_topic_mastery(test_db)
        assert result["airport"]["tier"] == "bronze"
        assert result["airport"]["sessions"] == 1
        assert result["airport"]["avg_grammar"] == 0.0

    async def test_avg_grammar_computed_across_sessions(self, test_db):
        for rate in [60.0, 80.0, 100.0]:
            cid = await create_conversation(test_db, "hotel_checkin")
            await end_conversation(test_db, cid, summary={"performance": {"grammar_accuracy_rate": rate}})

        result = await get_topic_mastery(test_db)
        assert result["hotel_checkin"]["avg_grammar"] == 80.0  # (60+80+100)/3

    async def test_highest_difficulty_tracked(self, test_db):
        cid1 = await create_conversation(test_db, "hotel_checkin", difficulty="beginner")
        await end_conversation(test_db, cid1, summary={"performance": {"grammar_accuracy_rate": 90.0}})
        cid2 = await create_conversation(test_db, "hotel_checkin", difficulty="intermediate")
        await end_conversation(test_db, cid2, summary={"performance": {"grammar_accuracy_rate": 90.0}})

        result = await get_topic_mastery(test_db)
        assert result["hotel_checkin"]["highest_difficulty"] == "intermediate"
