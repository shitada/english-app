"""Integration tests for the Quick Shadowing Drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import aiosqlite
import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestShadowingAPI:

    async def test_generate_returns_copilot_sentence(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "I will pick up some groceries on the way home tonight.",
            "focus_tip": "Link 'pick up' smoothly.",
            "target_seconds": 4.5,
        })
        with patch("app.routers.shadowing.get_copilot_service", return_value=mock_copilot):
            resp = await client.post("/api/shadowing/sentence")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sentence"].startswith("I will pick up")
        assert data["focus_tip"]
        assert isinstance(data["target_seconds"], (int, float))
        assert 2.0 <= data["target_seconds"] <= 12.0

    async def test_generate_falls_back_when_copilot_fails(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.routers.shadowing.get_copilot_service", return_value=mock_copilot):
            resp = await client.post("/api/shadowing/sentence")
        assert resp.status_code == 200
        data = resp.json()
        # word count between 8 and 18
        n_words = len([w for w in data["sentence"].split() if w])
        assert 8 <= n_words <= 18
        assert data["focus_tip"]

    async def test_generate_falls_back_on_invalid_payload(self, client: AsyncClient):
        # Sentence too short -> validator rejects -> fallback used
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "Too short.",
            "focus_tip": "x",
            "target_seconds": 1.0,
        })
        with patch("app.routers.shadowing.get_copilot_service", return_value=mock_copilot):
            resp = await client.post("/api/shadowing/sentence")
        assert resp.status_code == 200
        n_words = len([w for w in resp.json()["sentence"].split() if w])
        assert 8 <= n_words <= 18

    async def test_attempt_persists_row(self, client: AsyncClient, tmp_path):
        payload = {
            "sentence": "I usually grab a coffee on my way to work in the morning.",
            "transcript": "i usually grab a coffee on my way to work in the morning",
            "accuracy": 100.0,
            "timing_score": 90.0,
            "duration_ms": 4200,
        }
        resp = await client.post("/api/shadowing/attempt", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] > 0
        assert data["accuracy"] == 100.0
        assert data["timing_score"] == 90.0
        assert data["combined_score"] == 95.0

        # Verify a row landed in the DB used by the test client
        db_path = tmp_path / "test.db"
        db = await aiosqlite.connect(str(db_path))
        try:
            db.row_factory = aiosqlite.Row
            rows = await db.execute_fetchall(
                "SELECT sentence, accuracy, timing_score, duration_ms FROM shadowing_attempts"
            )
        finally:
            await db.close()
        assert len(rows) == 1
        assert rows[0]["sentence"].startswith("I usually grab")
        assert rows[0]["accuracy"] == 100.0
        assert rows[0]["duration_ms"] == 4200

    async def test_attempt_rejects_invalid_payload(self, client: AsyncClient):
        # accuracy out of [0, 100]
        resp = await client.post("/api/shadowing/attempt", json={
            "sentence": "valid",
            "transcript": "",
            "accuracy": 150.0,
            "timing_score": 50.0,
            "duration_ms": 1000,
        })
        assert resp.status_code == 422
