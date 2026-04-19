"""Unit tests for the dictation DAL."""

from __future__ import annotations

import pytest

from app.dal import dictation as dictation_dal


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_returns_id_and_inserts(test_db):
    new_id = await dictation_dal.record_attempt(
        test_db,
        conversation_id="42",
        message_id="42-3",
        accuracy=87.5,
        word_count=8,
        missed_word_count=1,
    )
    assert isinstance(new_id, int)
    assert new_id > 0

    rows = await test_db.execute_fetchall(
        "SELECT conversation_id, message_id, accuracy, word_count, missed_word_count FROM dictation_attempts"
    )
    assert len(rows) == 1
    assert rows[0]["conversation_id"] == "42"
    assert rows[0]["message_id"] == "42-3"
    assert rows[0]["accuracy"] == pytest.approx(87.5)
    assert rows[0]["word_count"] == 8
    assert rows[0]["missed_word_count"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_accepts_null_ids(test_db):
    new_id = await dictation_dal.record_attempt(
        test_db,
        conversation_id=None,
        message_id=None,
        accuracy=100.0,
        word_count=4,
        missed_word_count=0,
    )
    assert new_id > 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_recent_avg_accuracy_zero_when_empty(test_db):
    avg = await dictation_dal.recent_avg_accuracy(test_db, days=7)
    assert avg == 0.0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_recent_avg_accuracy_aggregates(test_db):
    for acc in (80.0, 100.0, 60.0):
        await dictation_dal.record_attempt(
            test_db, "c1", "m1", acc, 5, 0
        )
    avg = await dictation_dal.recent_avg_accuracy(test_db, days=7)
    assert avg == pytest.approx(80.0)

    total = await dictation_dal.count_attempts(test_db)
    assert total == 3
