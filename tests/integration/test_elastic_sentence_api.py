"""Integration tests for Elastic Sentence API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import aiosqlite
import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestElasticSentenceAPI:

    async def test_generate_uses_copilot_chain(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "target": "I would like some coffee with milk please",
            "chain": [
                "coffee",
                "some coffee",
                "like some coffee",
                "I would like some coffee",
                "I would like some coffee with milk",
                "I would like some coffee with milk please",
            ],
        })
        with patch("app.routers.elastic_sentence.get_copilot_service", return_value=mock_copilot):
            resp = await client.post("/api/elastic-sentence/generate", json={"difficulty": "medium"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "medium"
        assert data["target"].startswith("I would like")
        assert len(data["chain"]) == 6
        assert data["chain"][-1].endswith("please")

    async def test_generate_falls_back_when_copilot_fails(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.routers.elastic_sentence.get_copilot_service", return_value=mock_copilot):
            resp = await client.post("/api/elastic-sentence/generate", json={"difficulty": "short"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "short"
        assert len(data["chain"]) >= 4
        # strictly increasing word counts
        counts = [len(s.split()) for s in data["chain"]]
        assert all(a < b for a, b in zip(counts, counts[1:]))

    async def test_generate_falls_back_on_invalid_payload(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "target": "Too short",
            "chain": ["too"],  # too few steps
        })
        with patch("app.routers.elastic_sentence.get_copilot_service", return_value=mock_copilot):
            resp = await client.post("/api/elastic-sentence/generate", json={"difficulty": "medium"})
        assert resp.status_code == 200
        assert len(resp.json()["chain"]) >= 4

    async def test_generate_default_difficulty_is_medium(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("force-fallback"))
        with patch("app.routers.elastic_sentence.get_copilot_service", return_value=mock_copilot):
            resp = await client.post("/api/elastic-sentence/generate", json={})
        assert resp.status_code == 200
        assert resp.json()["difficulty"] == "medium"

    async def test_generate_rejects_invalid_difficulty(self, client: AsyncClient):
        resp = await client.post("/api/elastic-sentence/generate", json={"difficulty": "extreme"})
        assert resp.status_code == 422

    async def test_submit_persists_row(self, client: AsyncClient, tmp_path):
        payload = {
            "difficulty": "medium",
            "target": "I usually grab a coffee on the way to work",
            "chain": [
                "coffee",
                "a coffee",
                "grab a coffee",
                "I usually grab a coffee",
                "I usually grab a coffee on the way to work",
            ],
            "max_reached": 5,
            "accuracy": 90.0,
            "transcript": "i usually grab a coffee on the way to work",
        }
        resp = await client.post("/api/elastic-sentence/submit", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] > 0
        assert data["chain_len"] == 5
        assert data["max_reached"] == 5
        assert data["accuracy"] == 90.0
        assert data["longest_words"] == 10

        db_path = tmp_path / "test.db"
        db = await aiosqlite.connect(str(db_path))
        try:
            db.row_factory = aiosqlite.Row
            rows = await db.execute_fetchall(
                "SELECT difficulty, target_sentence, accuracy, max_reached, longest_words "
                "FROM elastic_sentence_sessions"
            )
        finally:
            await db.close()
        assert len(rows) == 1
        assert rows[0]["difficulty"] == "medium"
        assert rows[0]["accuracy"] == 90.0
        assert rows[0]["longest_words"] == 10

    async def test_submit_low_accuracy_records_partial_longest(self, client: AsyncClient):
        payload = {
            "difficulty": "medium",
            "target": "I usually grab a coffee on the way to work",
            "chain": [
                "coffee",              # 1 word
                "a coffee",            # 2
                "grab a coffee",       # 3
                "I usually grab a coffee",  # 5
                "I usually grab a coffee on the way to work",  # 10
            ],
            "max_reached": 3,
            "accuracy": 30.0,
            "transcript": "grab a coffee",
        }
        resp = await client.post("/api/elastic-sentence/submit", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        # accuracy<60 -> longest is derived from reached step word count (3)
        assert data["longest_words"] == 3
        assert data["max_reached"] == 3

    async def test_submit_rejects_invalid_accuracy(self, client: AsyncClient):
        resp = await client.post("/api/elastic-sentence/submit", json={
            "difficulty": "medium",
            "target": "hello world",
            "chain": ["hello", "hello world"],
            "max_reached": 2,
            "accuracy": 150.0,
        })
        assert resp.status_code == 422

    async def test_recent_returns_submitted_sessions(self, client: AsyncClient):
        for i in range(3):
            await client.post("/api/elastic-sentence/submit", json={
                "difficulty": "short",
                "target": f"Can you open the window {i}",
                "chain": ["the window", "open the window", f"Can you open the window {i}"],
                "max_reached": 3,
                "accuracy": 80.0 + i,
                "transcript": "",
            })
        resp = await client.get("/api/elastic-sentence/recent?limit=5")
        assert resp.status_code == 200
        sessions = resp.json()
        assert len(sessions) == 3
        # newest first
        assert sessions[0]["target_sentence"].endswith("2")
        assert isinstance(sessions[0]["chain"], list)

    async def test_stats_empty_and_aggregated(self, client: AsyncClient):
        # empty
        resp = await client.get("/api/elastic-sentence/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_sessions"] == 0
        assert data["longest_words"] == 0

        # submit one
        await client.post("/api/elastic-sentence/submit", json={
            "difficulty": "long",
            "target": "If you have some time this weekend we should try that new ramen place",
            "chain": [
                "ramen",
                "the ramen",
                "new ramen place",
                "try that new ramen place",
                "we should try that new ramen place",
                "If you have some time this weekend we should try that new ramen place",
            ],
            "max_reached": 6,
            "accuracy": 100.0,
            "transcript": "",
        })
        resp = await client.get("/api/elastic-sentence/stats")
        data = resp.json()
        assert data["total_sessions"] == 1
        assert data["avg_accuracy_last_20"] == 100.0
        assert data["longest_words"] >= 14
