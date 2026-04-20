"""Integration tests for Collocation Chef API."""

from __future__ import annotations

import aiosqlite
import pytest
from httpx import AsyncClient

from app.database import SCHEMA, _apply_migrations


@pytest.mark.integration
class TestCollocationsAPI:

    async def test_session_default_returns_eight_items(self, client: AsyncClient):
        resp = await client.get("/api/collocations/session")
        assert resp.status_code == 200
        data = resp.json()
        items = data["items"]
        assert len(items) == 8
        for it in items:
            assert it["id"]
            assert it["sentence_before"]
            assert it["sentence_after"]
            assert it["noun_phrase"]
            assert it["correct_verb"]
            assert it["hint"]
            assert isinstance(it["related_collocations"], list)
            assert len(it["verb_choices"]) == 4
            assert it["correct_verb"] in it["verb_choices"]
            # verb_choices are unique
            assert len(set(it["verb_choices"])) == 4

    async def test_session_respects_count_and_difficulty(self, client: AsyncClient):
        resp = await client.get("/api/collocations/session?count=5&difficulty=hard")
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 5
        for it in items:
            assert it["difficulty"] == "hard"

    async def test_session_difficulty_medium(self, client: AsyncClient):
        resp = await client.get("/api/collocations/session?count=3&difficulty=medium")
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 3
        assert all(it["difficulty"] == "medium" for it in items)

    async def test_session_invalid_difficulty_returns_422(self, client: AsyncClient):
        resp = await client.get("/api/collocations/session?difficulty=impossible")
        assert resp.status_code == 422

    async def test_session_invalid_count_returns_422(self, client: AsyncClient):
        resp = await client.get("/api/collocations/session?count=0")
        assert resp.status_code == 422
        resp = await client.get("/api/collocations/session?count=999")
        assert resp.status_code == 422

    async def test_attempt_persists_and_stats_computes(self, client: AsyncClient):
        attempts = [
            {
                "item_id": "e01",
                "sentence": "I need to make a decision.",
                "correct_verb": "make",
                "chosen_verb": "make",
                "is_correct": True,
                "response_ms": 1200,
            },
            {
                "item_id": "e02",
                "sentence": "Let's take a break.",
                "correct_verb": "take",
                "chosen_verb": "make",
                "is_correct": False,
                "response_ms": 3100,
            },
            {
                "item_id": "e13",
                "sentence": "Let's take a photo.",
                "correct_verb": "take",
                "chosen_verb": "take",
                "is_correct": True,
                "response_ms": 900,
            },
        ]
        for a in attempts:
            r = await client.post("/api/collocations/attempt", json=a)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["id"] > 0
            assert body["is_correct"] == a["is_correct"]

        stats_resp = await client.get("/api/collocations/stats")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()
        assert stats["total_attempts"] == 3
        assert stats["accuracy"] == pytest.approx(2 / 3)
        assert "make" in stats["per_verb_accuracy"]
        assert stats["per_verb_accuracy"]["make"] == pytest.approx(1.0)
        assert stats["per_verb_accuracy"]["take"] == pytest.approx(0.5)
        assert len(stats["recent_sessions"]) == 3

    async def test_attempt_missing_field_returns_422(self, client: AsyncClient):
        bad = {
            "item_id": "e01",
            # missing sentence
            "correct_verb": "make",
            "chosen_verb": "make",
            "is_correct": True,
        }
        r = await client.post("/api/collocations/attempt", json=bad)
        assert r.status_code == 422

    async def test_attempt_invalid_response_ms_returns_422(self, client: AsyncClient):
        bad = {
            "item_id": "e01",
            "sentence": "x",
            "correct_verb": "make",
            "chosen_verb": "make",
            "is_correct": True,
            "response_ms": -50,
        }
        r = await client.post("/api/collocations/attempt", json=bad)
        assert r.status_code == 422

    async def test_stats_empty_when_no_attempts(self, client: AsyncClient):
        r = await client.get("/api/collocations/stats")
        assert r.status_code == 200
        body = r.json()
        assert body["total_attempts"] == 0
        assert body["accuracy"] == 0.0
        assert body["per_verb_accuracy"] == {}
        assert body["weakest_verbs"] == []
        assert body["recent_sessions"] == []

    async def test_session_shuffles_verb_choices_across_items(self, client: AsyncClient):
        resp = await client.get("/api/collocations/session?count=8&difficulty=easy")
        items = resp.json()["items"]
        # At least two items should not have identical chip order — extremely
        # unlikely to fail with 8 items.
        signatures = {tuple(it["verb_choices"]) for it in items}
        assert len(signatures) >= 2


@pytest.mark.integration
async def test_fresh_db_migration_creates_collocation_table(tmp_path):
    """On a fresh DB, schema + migrations must create collocation_attempts
    with the expected columns and indexes."""
    db_path = tmp_path / "fresh.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await db.executescript(SCHEMA)
    await db.commit()
    await _apply_migrations(db)

    # Table exists
    rows = await db.execute_fetchall(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='collocation_attempts'"
    )
    assert len(rows) == 1

    # Expected columns
    cols = await db.execute_fetchall("PRAGMA table_info(collocation_attempts)")
    col_names = {r["name"] for r in cols}
    expected = {
        "id", "item_id", "sentence", "correct_verb", "chosen_verb",
        "is_correct", "response_ms", "created_at",
    }
    assert expected.issubset(col_names)

    # Indexes exist
    idx_rows = await db.execute_fetchall(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='collocation_attempts'"
    )
    idx_names = {r["name"] for r in idx_rows}
    assert "idx_colloc_created" in idx_names
    assert "idx_colloc_verb" in idx_names

    await db.close()
