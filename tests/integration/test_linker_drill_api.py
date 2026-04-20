"""Integration tests for the Linker Speak Drill API."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestLinkerDrillAPI:

    async def test_round_returns_balanced_items(self, client: AsyncClient):
        resp = await client.get("/api/linker-drill/round?count=5")
        assert resp.status_code == 200
        data = resp.json()
        items = data["items"]
        assert len(items) == 5
        # Each item has the expected shape
        for it in items:
            assert "id" in it
            assert "sentence_a" in it and it["sentence_a"]
            assert "sentence_b" in it and it["sentence_b"]
            assert "combined_sentence" in it
            assert "explanation" in it
            assert it["category"] in {"contrast", "cause", "addition", "time", "result"}
            assert len(it["options"]) == 4
            assert it["correct_linker"] in it["options"]
        # Balanced: 5 items across 5 categories should hit all five
        cats = {it["category"] for it in items}
        assert cats == {"contrast", "cause", "addition", "time", "result"}

    async def test_round_default_count_is_five(self, client: AsyncClient):
        resp = await client.get("/api/linker-drill/round")
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 5

    async def test_round_validates_count_bounds(self, client: AsyncClient):
        resp = await client.get("/api/linker-drill/round?count=0")
        assert resp.status_code == 422
        resp = await client.get("/api/linker-drill/round?count=999")
        assert resp.status_code == 422

    async def test_attempt_persists_and_stats_aggregates(
        self, client: AsyncClient
    ):
        # Submit a couple of attempts
        attempts = [
            {
                "item_id": "c01",
                "chosen_linker": "however",
                "correct_linker": "however",
                "is_correct": True,
                "category": "contrast",
                "spoken_similarity": 90.0,
            },
            {
                "item_id": "c02",
                "chosen_linker": "so",
                "correct_linker": "although",
                "is_correct": False,
                "category": "contrast",
                "spoken_similarity": 30.0,
            },
            {
                "item_id": "r01",
                "chosen_linker": "so",
                "correct_linker": "so",
                "is_correct": True,
                "category": "result",
                "spoken_similarity": None,
            },
        ]
        for a in attempts:
            r = await client.post("/api/linker-drill/attempt", json=a)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["id"] > 0
            assert body["is_correct"] == a["is_correct"]

        stats_resp = await client.get("/api/linker-drill/stats")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()
        assert stats["total"] == 3
        assert stats["overall_accuracy"] == pytest.approx(2 / 3)
        assert stats["avg_similarity"] == pytest.approx(60.0)
        assert "contrast" in stats["by_category"]
        assert stats["by_category"]["contrast"]["total"] == 2
        # Weakest with min_attempts=3 default → contrast (2 attempts) doesn't qualify;
        # only result has 1, also under threshold → None.
        assert stats["weakest_category"] is None

    async def test_attempt_invalid_similarity_rejected(
        self, client: AsyncClient
    ):
        bad = {
            "item_id": "c01",
            "chosen_linker": "however",
            "correct_linker": "however",
            "is_correct": True,
            "category": "contrast",
            "spoken_similarity": 250.0,  # > 100 not allowed
        }
        r = await client.post("/api/linker-drill/attempt", json=bad)
        assert r.status_code == 422

    async def test_stats_empty_when_no_attempts(self, client: AsyncClient):
        r = await client.get("/api/linker-drill/stats")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 0
        assert body["overall_accuracy"] == 0.0
        assert body["by_category"] == {}
        assert body["weakest_category"] is None
