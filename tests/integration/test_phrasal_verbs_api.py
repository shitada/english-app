"""Integration tests for the Phrasal Verb Particle Drill API."""

from __future__ import annotations

import logging

import pytest
from httpx import AsyncClient

from app.routers.phrasal_verbs import LEVELS, _BANK, build_drill


@pytest.mark.integration
class TestPhrasalVerbDrillAPI:

    async def test_drill_default_returns_beginner_items(
        self, client: AsyncClient,
    ):
        resp = await client.get("/api/phrasal-verbs/drill")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["level"] == "beginner"
        assert 1 <= len(data["items"]) <= 10
        for it in data["items"]:
            assert it["level"] == "beginner"
            assert "____" in it["example_with_blank"]
            assert it["verb"] and it["particle"]
            assert isinstance(it["accepted"], list)

    async def test_drill_respects_count(self, client: AsyncClient):
        resp = await client.get("/api/phrasal-verbs/drill?count=5&level=intermediate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "intermediate"
        assert len(data["items"]) == 5
        for it in data["items"]:
            assert it["level"] == "intermediate"

    async def test_drill_level_filter_advanced(self, client: AsyncClient):
        resp = await client.get("/api/phrasal-verbs/drill?count=3&level=advanced")
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "advanced"
        for it in data["items"]:
            assert it["level"] == "advanced"

    async def test_drill_invalid_level_falls_back_to_beginner(
        self, client: AsyncClient,
    ):
        resp = await client.get("/api/phrasal-verbs/drill?count=3&level=wizard")
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "beginner"

    async def test_drill_validates_count_bounds(self, client: AsyncClient):
        r0 = await client.get("/api/phrasal-verbs/drill?count=0")
        assert r0.status_code == 422
        rmax = await client.get("/api/phrasal-verbs/drill?count=99")
        assert rmax.status_code == 422

    async def test_drill_shuffles(self, client: AsyncClient):
        """Two consecutive calls should (usually) differ in ordering."""
        seqs = []
        for _ in range(6):
            resp = await client.get(
                "/api/phrasal-verbs/drill?count=10&level=beginner",
            )
            assert resp.status_code == 200
            seqs.append([it["id"] for it in resp.json()["items"]])
        # At least two of the six should differ — shuffling is random.
        unique = {tuple(s) for s in seqs}
        assert len(unique) > 1, f"All orderings identical: {seqs[0]}"

    async def test_attempt_logs_without_persistence(
        self, client: AsyncClient, caplog,
    ):
        caplog.set_level(logging.INFO, logger="app.routers.phrasal_verbs")
        resp = await client.post(
            "/api/phrasal-verbs/attempt",
            json={"id": "b01", "user_answer": "off", "correct": True},
        )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        assert any("phrasal_verbs.attempt" in r.message for r in caplog.records)

    async def test_attempt_accepts_incorrect(self, client: AsyncClient):
        resp = await client.post(
            "/api/phrasal-verbs/attempt",
            json={"id": "b01", "user_answer": "on", "correct": False},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_attempt_rejects_invalid_payload(self, client: AsyncClient):
        resp = await client.post(
            "/api/phrasal-verbs/attempt",
            json={"id": "b01"},  # missing user_answer/correct
        )
        assert resp.status_code == 422


@pytest.mark.unit
class TestPhrasalVerbBank:

    def test_bank_covers_all_levels(self):
        seen_levels = {it["level"] for it in _BANK}
        assert seen_levels == set(LEVELS)

    def test_bank_ids_are_unique(self):
        ids = [it["id"] for it in _BANK]
        assert len(ids) == len(set(ids))

    def test_every_item_has_blank_marker(self):
        for it in _BANK:
            assert "____" in it["example_with_blank"], it["id"]
            assert it["particle"].lower() in it["example_full"].lower(), it["id"]

    def test_bank_size_reasonable(self):
        # Proposal targets ~60 items.
        assert len(_BANK) >= 50

    def test_build_drill_clamps_count(self):
        big = build_drill(count=999, level="beginner")
        assert len(big["items"]) <= 30
        small = build_drill(count=0, level="beginner")
        assert len(small["items"]) >= 1

    def test_build_drill_respects_level(self):
        for lvl in LEVELS:
            data = build_drill(count=5, level=lvl, seed=42)
            for it in data["items"]:
                assert it["level"] == lvl

    def test_build_drill_invalid_level_falls_back(self):
        data = build_drill(count=3, level="mystery", seed=1)
        assert data["level"] == "beginner"

    def test_build_drill_seed_is_deterministic(self):
        a = build_drill(count=5, level="beginner", seed=7)
        b = build_drill(count=5, level="beginner", seed=7)
        assert [it["id"] for it in a["items"]] == [it["id"] for it in b["items"]]
