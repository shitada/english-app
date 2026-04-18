"""Unit tests for minimal_pair DAL."""

import json

import pytest

from app.dal import minimal_pair as mp_dal


@pytest.mark.asyncio
@pytest.mark.unit
async def test_save_session_returns_id_and_persists(test_db):
    summary = {
        "/i/-/iː/": {"correct": 2, "total": 3},
        "/l/-/r/": {"correct": 1, "total": 2},
    }
    new_id = await mp_dal.save_session(test_db, correct=3, total=5, contrast_summary=summary)
    assert new_id > 0

    rows = await test_db.execute_fetchall(
        "SELECT correct, total, contrast_summary FROM minimal_pair_sessions WHERE id = ?",
        (new_id,),
    )
    assert len(rows) == 1
    assert rows[0]["correct"] == 3
    assert rows[0]["total"] == 5
    persisted = json.loads(rows[0]["contrast_summary"])
    assert persisted == summary


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_recent_sessions_orders_desc(test_db):
    await mp_dal.save_session(test_db, 1, 5, {"/v/-/b/": {"correct": 1, "total": 5}})
    await mp_dal.save_session(test_db, 4, 5, {"/θ/-/s/": {"correct": 4, "total": 5}})
    await mp_dal.save_session(test_db, 5, 5, {"/æ/-/ɛ/": {"correct": 5, "total": 5}})

    sessions = await mp_dal.get_recent_sessions(test_db, limit=10)
    assert len(sessions) == 3
    # Newest (last inserted) first
    assert sessions[0]["correct"] == 5
    assert sessions[-1]["correct"] == 1
    # Summary deserialized
    assert sessions[0]["contrast_summary"]["/æ/-/ɛ/"]["correct"] == 5


@pytest.mark.asyncio
@pytest.mark.unit
async def test_save_session_rejects_invalid_values(test_db):
    with pytest.raises(ValueError):
        await mp_dal.save_session(test_db, correct=10, total=5, contrast_summary={})
    with pytest.raises(ValueError):
        await mp_dal.save_session(test_db, correct=-1, total=5, contrast_summary={})


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_recent_sessions_empty(test_db):
    sessions = await mp_dal.get_recent_sessions(test_db)
    assert sessions == []


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_recent_sessions_handles_bad_json(test_db):
    # Manually insert a row with malformed contrast_summary
    await test_db.execute(
        "INSERT INTO minimal_pair_sessions (correct, total, contrast_summary) VALUES (?, ?, ?)",
        (2, 5, "not-valid-json"),
    )
    await test_db.commit()
    sessions = await mp_dal.get_recent_sessions(test_db)
    assert len(sessions) == 1
    assert sessions[0]["contrast_summary"] == {}
