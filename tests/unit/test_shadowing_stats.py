"""Unit tests for app.dal.shadowing.get_stats — progress badge stats."""

from __future__ import annotations

import pytest

from app.dal.shadowing import get_stats, record_attempt


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_stats_empty_table(test_db):
    stats = await get_stats(test_db)
    assert stats["total_attempts"] == 0
    assert stats["avg_combined_last_20"] == 0.0
    assert stats["best_combined"] == 0.0
    assert stats["last_attempt_at"] is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_stats_three_attempts(test_db):
    # combined values: 75, 50, 100; avg = 75.0; best = 100.0
    pairs = [(80.0, 70.0), (40.0, 60.0), (100.0, 100.0)]
    for acc, ts in pairs:
        await record_attempt(
            test_db,
            sentence="hello world",
            transcript="hello world",
            accuracy=acc,
            timing_score=ts,
            duration_ms=1000,
        )
    stats = await get_stats(test_db)
    assert stats["total_attempts"] == 3
    assert stats["avg_combined_last_20"] == 75.0
    assert stats["best_combined"] == 100.0
    assert stats["last_attempt_at"] is not None
    assert isinstance(stats["last_attempt_at"], str)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_stats_avg_only_last_20_best_global(test_db):
    # Insert 25 attempts. First 5 (oldest) are high (combined=100);
    # last 20 (most recent) are low (combined=50). The "last 20" avg should
    # be 50.0, but global best should still be 100.0.
    # Insert oldest first so that ORDER BY created_at DESC, id DESC sees the
    # later-inserted (low) rows first.
    for _ in range(5):
        await record_attempt(
            test_db, sentence="s", transcript="s",
            accuracy=100.0, timing_score=100.0, duration_ms=1000,
        )
    for _ in range(20):
        await record_attempt(
            test_db, sentence="s", transcript="s",
            accuracy=50.0, timing_score=50.0, duration_ms=1000,
        )
    stats = await get_stats(test_db)
    assert stats["total_attempts"] == 25
    assert stats["avg_combined_last_20"] == 50.0
    assert stats["best_combined"] == 100.0
    assert stats["last_attempt_at"] is not None
