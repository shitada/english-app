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


# ---------------------------------------------------------------------------
# aggregate_contrast_accuracy
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.unit
async def test_aggregate_contrast_accuracy_empty_db(test_db):
    out = await mp_dal.aggregate_contrast_accuracy(test_db)
    assert out == []


@pytest.mark.asyncio
@pytest.mark.unit
async def test_aggregate_contrast_accuracy_sums_across_rows(test_db):
    # Two sessions touching the same contrast — counts should be summed.
    await mp_dal.save_session(
        test_db, 1, 3,
        {"/l/-/r/": {"correct": 1, "total": 3}},
    )
    await mp_dal.save_session(
        test_db, 2, 3,
        {"/l/-/r/": {"correct": 2, "total": 3}, "/i/-/iː/": {"correct": 3, "total": 3}},
    )
    out = await mp_dal.aggregate_contrast_accuracy(test_db, min_attempts=1)
    by_contrast = {c["contrast"]: c for c in out}
    assert by_contrast["/l/-/r/"]["correct"] == 3
    assert by_contrast["/l/-/r/"]["total"] == 6
    assert by_contrast["/l/-/r/"]["accuracy"] == 0.5
    assert by_contrast["/i/-/iː/"]["correct"] == 3
    assert by_contrast["/i/-/iː/"]["total"] == 3
    assert by_contrast["/i/-/iː/"]["accuracy"] == 1.0


@pytest.mark.asyncio
@pytest.mark.unit
async def test_aggregate_contrast_accuracy_min_attempts_filter(test_db):
    await mp_dal.save_session(
        test_db, 0, 2,
        {"/v/-/b/": {"correct": 0, "total": 2}, "/θ/-/s/": {"correct": 5, "total": 5}},
    )
    out = await mp_dal.aggregate_contrast_accuracy(test_db, min_attempts=3)
    contrasts = [c["contrast"] for c in out]
    assert "/v/-/b/" not in contrasts  # only 2 attempts → filtered
    assert "/θ/-/s/" in contrasts


@pytest.mark.asyncio
@pytest.mark.unit
async def test_aggregate_contrast_accuracy_sort_order(test_db):
    # Two contrasts with same low accuracy — higher total should come first.
    await mp_dal.save_session(
        test_db, 1, 4,
        {"/l/-/r/": {"correct": 1, "total": 4}},  # 25%
    )
    await mp_dal.save_session(
        test_db, 2, 8,
        {"/v/-/b/": {"correct": 2, "total": 8}},  # 25%, more total
    )
    await mp_dal.save_session(
        test_db, 4, 4,
        {"/θ/-/s/": {"correct": 4, "total": 4}},  # 100%
    )
    out = await mp_dal.aggregate_contrast_accuracy(test_db, min_attempts=3)
    # Weakest first; tied accuracies broken by larger total first.
    assert out[0]["contrast"] == "/v/-/b/"
    assert out[1]["contrast"] == "/l/-/r/"
    assert out[-1]["contrast"] == "/θ/-/s/"
    # Cap at 3
    assert len(out) <= 3


@pytest.mark.asyncio
@pytest.mark.unit
async def test_aggregate_contrast_accuracy_lookback_limit(test_db):
    # First session has the only /l/-/r/ data; subsequent sessions don't touch it.
    await mp_dal.save_session(
        test_db, 0, 5,
        {"/l/-/r/": {"correct": 0, "total": 5}},
    )
    for _ in range(5):
        await mp_dal.save_session(
            test_db, 5, 5,
            {"/i/-/iː/": {"correct": 5, "total": 5}},
        )
    # With lookback=3 the oldest /l/-/r/ session is excluded.
    out = await mp_dal.aggregate_contrast_accuracy(test_db, lookback=3, min_attempts=1)
    assert all(c["contrast"] != "/l/-/r/" for c in out)
    # With a larger lookback it's included.
    out_full = await mp_dal.aggregate_contrast_accuracy(test_db, lookback=50, min_attempts=1)
    assert any(c["contrast"] == "/l/-/r/" for c in out_full)


@pytest.mark.asyncio
@pytest.mark.unit
async def test_aggregate_contrast_accuracy_returns_at_most_three(test_db):
    summary = {
        "/a/-/b/": {"correct": 1, "total": 5},
        "/c/-/d/": {"correct": 2, "total": 5},
        "/e/-/f/": {"correct": 3, "total": 5},
        "/g/-/h/": {"correct": 4, "total": 5},
    }
    await mp_dal.save_session(test_db, 10, 20, summary)
    out = await mp_dal.aggregate_contrast_accuracy(test_db, min_attempts=1)
    assert len(out) == 3
    # Lowest-accuracy contrast must be first.
    assert out[0]["contrast"] == "/a/-/b/"
