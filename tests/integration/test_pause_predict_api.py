"""Integration tests for the Pause & Predict listening drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestPausePredictAPI:

    async def test_session_returns_five_items_with_strict_prefix(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.return_value = {
            "items": [
                {
                    "full_sentence": "I need to go to the grocery store.",
                    "prefix_text": "I need to go to the grocery",
                    "expected_completion": "store",
                    "alternatives": ["shop"],
                    "context_hint": "Everyday errand",
                }
            ]
        }
        resp = await client.get(
            "/api/pause-predict/session",
            params={"difficulty": "beginner", "count": 5},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["difficulty"] == "beginner"
        assert data["count"] == 5
        assert len(data["items"]) == 5
        for it in data["items"]:
            assert it["id"]
            assert it["full_sentence"].startswith(it["prefix_text"])
            assert it["prefix_text"] != it["full_sentence"]
            assert it["expected_completion"]
            assert isinstance(it["alternatives"], list)

    async def test_session_uses_fallback_when_copilot_raises(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.side_effect = RuntimeError("upstream down")
        resp = await client.get(
            "/api/pause-predict/session",
            params={"difficulty": "intermediate", "count": 3},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 3
        for it in data["items"]:
            assert it["full_sentence"].startswith(it["prefix_text"])

    async def test_session_unknown_difficulty_falls_back_to_beginner(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.side_effect = RuntimeError("boom")
        resp = await client.get(
            "/api/pause-predict/session",
            params={"difficulty": "nightmare", "count": 2},
        )
        assert resp.status_code == 200
        assert resp.json()["difficulty"] == "beginner"

    async def test_session_validates_count_bounds(self, client: AsyncClient):
        r = await client.get("/api/pause-predict/session", params={"count": 0})
        assert r.status_code == 422
        r = await client.get("/api/pause-predict/session", params={"count": 99})
        assert r.status_code == 422

    async def test_submit_exact_match(self, client: AsyncClient):
        resp = await client.post(
            "/api/pause-predict/submit",
            json={
                "item_id": "static-beginner-0",
                "user_answer": "Store.",
                "expected": "store",
                "alternatives": [],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_correct"] is True
        assert body["is_close"] is False
        assert body["score"] == 1.0
        assert body["user_answer_normalized"] == "store"

    async def test_submit_alternative_match(self, client: AsyncClient):
        resp = await client.post(
            "/api/pause-predict/submit",
            json={
                "item_id": "x",
                "user_answer": "shop",
                "expected": "store",
                "alternatives": ["shop", "market"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_correct"] is True
        assert body["score"] == 0.9

    async def test_submit_close_match(self, client: AsyncClient):
        # "averages" and "averted" share 4-letter prefix "aver" → close.
        resp = await client.post(
            "/api/pause-predict/submit",
            json={
                "item_id": "x",
                "user_answer": "averages",
                "expected": "averted",
                "alternatives": [],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_correct"] is False
        assert body["is_close"] is True
        assert body["score"] == 0.6

    async def test_submit_wrong_answer(self, client: AsyncClient):
        resp = await client.post(
            "/api/pause-predict/submit",
            json={
                "item_id": "x",
                "user_answer": "banana",
                "expected": "store",
                "alternatives": ["shop"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_correct"] is False
        assert body["is_close"] is False
        assert body["score"] == 0.0

    async def test_complete_persists_session(self, client: AsyncClient):
        resp = await client.post(
            "/api/pause-predict/session/complete",
            json={
                "difficulty": "beginner",
                "total": 5,
                "correct": 3,
                "close": 1,
                "avg_score": 0.78,
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] > 0
        assert body["difficulty"] == "beginner"
        assert body["total"] == 5

        # Confirmed persisted via /recent
        rec = await client.get("/api/pause-predict/recent")
        assert rec.status_code == 200
        sessions = rec.json()["sessions"]
        assert len(sessions) == 1
        assert sessions[0]["correct"] == 3

    async def test_complete_rejects_invalid_aggregates(self, client: AsyncClient):
        resp = await client.post(
            "/api/pause-predict/session/complete",
            json={
                "difficulty": "beginner",
                "total": 3,
                "correct": 4,  # > total
                "close": 0,
                "avg_score": 1.0,
            },
        )
        assert resp.status_code == 422

    async def test_stats_reflects_persisted_sessions(self, client: AsyncClient):
        await client.post(
            "/api/pause-predict/session/complete",
            json={
                "difficulty": "beginner",
                "total": 5, "correct": 4, "close": 1, "avg_score": 0.9,
            },
        )
        await client.post(
            "/api/pause-predict/session/complete",
            json={
                "difficulty": "advanced",
                "total": 5, "correct": 2, "close": 2, "avg_score": 0.5,
            },
        )
        resp = await client.get("/api/pause-predict/stats")
        assert resp.status_code == 200
        s = resp.json()
        assert s["sessions"] == 2
        assert s["total_items"] == 10
        assert s["total_correct"] == 6
        assert s["accuracy"] == 0.6


@pytest.mark.integration
@pytest.mark.asyncio
async def test_migration_creates_pause_predict_table_on_fresh_db(tmp_path):
    """Regression test: running init_db on an empty file creates the table."""
    import aiosqlite
    from app.database import SCHEMA, _apply_migrations

    db_path = tmp_path / "fresh.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    try:
        await db.executescript(SCHEMA)
        await db.commit()
        await _apply_migrations(db)

        rows = await db.execute_fetchall(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='pause_predict_sessions'"
        )
        assert len(rows) == 1

        # Insert + select sanity
        await db.execute(
            """INSERT INTO pause_predict_sessions
                   (difficulty, total, correct, close, avg_score)
               VALUES ('beginner', 5, 3, 1, 0.78)"""
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT difficulty, total, correct, close, avg_score FROM pause_predict_sessions"
        )
        assert len(rows) == 1
        r = rows[0]
        assert r["difficulty"] == "beginner"
        assert r["correct"] == 3
    finally:
        await db.close()
