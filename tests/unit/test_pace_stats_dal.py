"""Unit tests for conversation pace stats DAL."""

import pytest

from app.dal import conversation as conv_dal


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_pace_stats_empty(test_db):
    conv_id = await conv_dal.create_conversation(test_db, topic="hotel_checkin")
    stats = await conv_dal.get_pace_stats(test_db, conv_id)
    assert stats == {"avg_wpm": 0.0, "min_wpm": 0.0, "max_wpm": 0.0, "count": 0}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_pace_stats_with_samples(test_db):
    conv_id = await conv_dal.create_conversation(test_db, topic="hotel_checkin")
    # User mic turns with pace_wpm
    await conv_dal.add_message(test_db, conv_id, "user", "Hello there friend",
                               speaking_seconds=2.0, pace_wpm=90.0)
    await conv_dal.add_message(test_db, conv_id, "user", "I would like a room please",
                               speaking_seconds=3.0, pace_wpm=120.0)
    await conv_dal.add_message(test_db, conv_id, "user", "Quickly please",
                               speaking_seconds=0.6, pace_wpm=180.0)
    # Typed turn (no pace_wpm) — should be excluded
    await conv_dal.add_message(test_db, conv_id, "user", "typed message")
    # Assistant turn — should be excluded even if it had a pace
    await conv_dal.add_message(test_db, conv_id, "assistant", "How can I help?")

    stats = await conv_dal.get_pace_stats(test_db, conv_id)
    assert stats["count"] == 3
    assert stats["min_wpm"] == 90.0
    assert stats["max_wpm"] == 180.0
    assert stats["avg_wpm"] == pytest.approx(130.0, abs=0.1)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_add_message_persists_pace_columns(test_db):
    conv_id = await conv_dal.create_conversation(test_db, topic="hotel_checkin")
    msg_id = await conv_dal.add_message(
        test_db, conv_id, "user", "Hello world",
        speaking_seconds=1.5, pace_wpm=80.0,
    )
    rows = await test_db.execute_fetchall(
        "SELECT speaking_seconds, pace_wpm FROM messages WHERE id = ?", (msg_id,)
    )
    assert rows[0]["speaking_seconds"] == pytest.approx(1.5)
    assert rows[0]["pace_wpm"] == pytest.approx(80.0)
