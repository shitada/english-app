"""Integration tests for the Best Time of Day dashboard endpoint."""

from __future__ import annotations

from pathlib import Path

import aiosqlite
import pytest
from httpx import AsyncClient


async def _open_db(tmp_path: Path) -> aiosqlite.Connection:
    db = await aiosqlite.connect(str(tmp_path / "test.db"))
    db.row_factory = aiosqlite.Row
    return db


async def _insert_message(
    db: aiosqlite.Connection, conv_id: int, role: str, created_at: str
) -> None:
    await db.execute(
        "INSERT INTO messages (conversation_id, role, content, created_at) "
        "VALUES (?, ?, ?, ?)",
        (conv_id, role, "hi", created_at),
    )


async def _insert_conversation(db: aiosqlite.Connection) -> int:
    cur = await db.execute(
        "INSERT INTO conversations (topic, difficulty) VALUES (?, ?)",
        ("hotel_checkin", "beginner"),
    )
    await db.commit()
    return cur.lastrowid  # type: ignore[return-value]


async def _insert_pronunciation(
    db: aiosqlite.Connection, score: float, created_at: str
) -> None:
    await db.execute(
        "INSERT INTO pronunciation_attempts "
        "(reference_text, user_transcription, score, created_at) "
        "VALUES (?, ?, ?, ?)",
        ("hello", "hello", score, created_at),
    )


@pytest.mark.integration
class TestTimeOfDayEndpoint:
    async def test_empty_db_returns_zero_buckets(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/time-of-day")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buckets"]) == 24
        assert [b["hour"] for b in data["buckets"]] == list(range(24))
        for b in data["buckets"]:
            assert b["activity_count"] == 0
            assert b["pronunciation_attempts"] == 0
            assert b["avg_pronunciation_score"] is None
        assert data["peak_practice_hour"] is None
        assert data["best_score_hour"] is None
        assert data["total_samples"] == 0

    async def test_peak_practice_hour_from_messages(
        self, client: AsyncClient, tmp_path: Path
    ):
        # Touch the endpoint first to ensure schema is initialized via client fixture.
        await client.get("/api/dashboard/time-of-day")

        db = await _open_db(tmp_path)
        try:
            conv_id = await _insert_conversation(db)
            # Two messages at hour 3 (UTC), one at hour 9, three at hour 14.
            # Use UTC timestamps; SQLite strftime('%H', .., 'localtime') will
            # convert them; we read whichever hour ends up with the most.
            samples = [
                ("2024-06-15 03:10:00", 1),
                ("2024-06-15 09:20:00", 1),
                ("2024-06-15 14:00:00", 3),
            ]
            for ts, count in samples:
                for _ in range(count):
                    await _insert_message(db, conv_id, "user", ts)
            await db.commit()
        finally:
            await db.close()

        resp = await client.get("/api/dashboard/time-of-day")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_samples"] == 5

        # Peak is whichever local hour has 3 events.
        peak_hour = data["peak_practice_hour"]
        assert peak_hour is not None
        peak_bucket = next(b for b in data["buckets"] if b["hour"] == peak_hour)
        assert peak_bucket["activity_count"] == 3

        # No pronunciation attempts -> best_score_hour remains None.
        assert data["best_score_hour"] is None

    async def test_best_score_hour_requires_three_attempts(
        self, client: AsyncClient, tmp_path: Path
    ):
        await client.get("/api/dashboard/time-of-day")

        db = await _open_db(tmp_path)
        try:
            # Hour A (10:00 UTC): 2 attempts averaging 9.5 (below threshold).
            await _insert_pronunciation(db, 9.5, "2024-06-15 10:00:00")
            await _insert_pronunciation(db, 9.5, "2024-06-15 10:30:00")
            # Hour B (15:00 UTC): 3 attempts averaging 8.0 (eligible).
            await _insert_pronunciation(db, 8.0, "2024-06-15 15:00:00")
            await _insert_pronunciation(db, 8.0, "2024-06-15 15:10:00")
            await _insert_pronunciation(db, 8.0, "2024-06-15 15:20:00")
            # Hour C (20:00 UTC): 4 attempts averaging 6.0 (eligible but lower).
            for _ in range(4):
                await _insert_pronunciation(db, 6.0, "2024-06-15 20:00:00")
            await db.commit()
        finally:
            await db.close()

        resp = await client.get("/api/dashboard/time-of-day")
        assert resp.status_code == 200
        data = resp.json()

        assert data["total_samples"] == 9
        # best_score_hour must come from hour B (avg 8.0, >=3 attempts), not
        # hour A (only 2 attempts despite higher avg).
        best_hour = data["best_score_hour"]
        assert best_hour is not None
        best_bucket = next(b for b in data["buckets"] if b["hour"] == best_hour)
        assert best_bucket["pronunciation_attempts"] == 3
        assert best_bucket["avg_pronunciation_score"] == pytest.approx(8.0)

    async def test_response_shape_validates_pydantic(self, client: AsyncClient):
        resp = await client.get("/api/dashboard/time-of-day")
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {
            "buckets",
            "peak_practice_hour",
            "best_score_hour",
            "total_samples",
        }
        assert isinstance(data["buckets"], list)
        for b in data["buckets"]:
            assert set(b.keys()) == {
                "hour",
                "activity_count",
                "pronunciation_attempts",
                "avg_pronunciation_score",
            }
            assert 0 <= b["hour"] <= 23
            assert isinstance(b["activity_count"], int)
            assert isinstance(b["pronunciation_attempts"], int)
            assert b["avg_pronunciation_score"] is None or isinstance(
                b["avg_pronunciation_score"], (int, float)
            )
