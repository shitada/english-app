"""Unit tests for the Listen & Summarize DAL."""

from __future__ import annotations

import pytest

from app.dal import listen_summarize as dal


@pytest.mark.unit
class TestListenSummarizeDAL:

    async def test_record_attempt_clamps_and_returns_id(self, test_db):
        rid = await dal.record_attempt(
            test_db,
            overall=1.5,            # clamped to 1.0
            coverage_ratio=-0.2,    # clamped to 0.0
            conciseness=0.7,
            accuracy=0.9,
            used_voice=True,
            plays_used=10,          # clamped to 5
            level="Intermediate ",
        )
        assert rid > 0
        rows = await test_db.execute_fetchall(
            "SELECT overall, coverage_ratio, conciseness, accuracy, "
            "used_voice, plays_used, level FROM listen_summarize_attempts"
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["overall"] == pytest.approx(1.0)
        assert row["coverage_ratio"] == pytest.approx(0.0)
        assert row["conciseness"] == pytest.approx(0.7)
        assert row["accuracy"] == pytest.approx(0.9)
        assert row["used_voice"] == 1
        assert row["plays_used"] == 5
        assert row["level"] == "intermediate"

    async def test_record_attempt_normalizes_blank_level(self, test_db):
        await dal.record_attempt(
            test_db,
            overall=0.5, coverage_ratio=0.5, conciseness=0.5, accuracy=0.5,
            used_voice=False, plays_used=1, level="",
        )
        rows = await test_db.execute_fetchall(
            "SELECT level FROM listen_summarize_attempts"
        )
        assert rows[0]["level"] == "intermediate"

    async def test_get_recent_stats_empty(self, test_db):
        stats = await dal.get_recent_stats(test_db, days=7)
        assert stats == {
            "total": 0,
            "average": 0.0,
            "best": 0.0,
            "sparkline": [],
        }

    async def test_get_recent_stats_aggregates(self, test_db):
        for o in (0.4, 0.8, 0.6):
            await dal.record_attempt(
                test_db,
                overall=o, coverage_ratio=o, conciseness=o, accuracy=o,
                used_voice=False, plays_used=1, level="intermediate",
            )
        stats = await dal.get_recent_stats(test_db, days=7)
        assert stats["total"] == 3
        assert stats["average"] == pytest.approx((0.4 + 0.8 + 0.6) / 3)
        assert stats["best"] == pytest.approx(0.8)
        # All inserts on "today" so sparkline collapses to 1 point.
        assert len(stats["sparkline"]) == 1
        pt = stats["sparkline"][0]
        assert pt["attempts"] == 3
        assert pt["avg_overall"] == pytest.approx((0.4 + 0.8 + 0.6) / 3)

    async def test_get_streak_counts_recent_consecutive_passes(self, test_db):
        # Insert in order: pass, pass, fail, pass — newest is the last insert.
        for o in (0.9, 0.8, 0.5, 0.95):
            await dal.record_attempt(
                test_db,
                overall=o, coverage_ratio=o, conciseness=o, accuracy=o,
                used_voice=False, plays_used=1, level="intermediate",
            )
        # Most recent passes only (1) before hitting a 0.5 below threshold.
        streak = await dal.get_streak(test_db, threshold=0.7)
        assert streak == 1

    async def test_get_streak_all_passing(self, test_db):
        for o in (0.85, 0.9, 0.95):
            await dal.record_attempt(
                test_db,
                overall=o, coverage_ratio=o, conciseness=o, accuracy=o,
                used_voice=False, plays_used=1, level="intermediate",
            )
        assert await dal.get_streak(test_db, threshold=0.7) == 3

    async def test_get_streak_zero_when_latest_fails(self, test_db):
        await dal.record_attempt(
            test_db,
            overall=0.95, coverage_ratio=0.95, conciseness=0.95, accuracy=0.95,
            used_voice=False, plays_used=1, level="intermediate",
        )
        await dal.record_attempt(
            test_db,
            overall=0.3, coverage_ratio=0.3, conciseness=0.3, accuracy=0.3,
            used_voice=False, plays_used=1, level="intermediate",
        )
        assert await dal.get_streak(test_db, threshold=0.7) == 0
