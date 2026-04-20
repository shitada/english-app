"""Integration tests for the Number & Date Dictation API."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestNumberDictationAPI:

    async def test_start_default_session(self, client: AsyncClient):
        resp = await client.post("/api/number-dictation/start", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"]
        assert data["category"] == "mixed"
        assert data["difficulty"] == "intermediate"
        assert len(data["items"]) == 6
        for it in data["items"]:
            assert it["id"]
            assert it["expected_text"]
            assert it["spoken_form"]
            assert it["audio_url"].startswith("speech:")

    async def test_start_specific_category(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/start",
            json={"category": "prices", "count": 3, "seed": 7},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["category"] == "prices"
        assert len(data["items"]) == 3
        assert {it["category"] for it in data["items"]} == {"prices"}

    async def test_start_unknown_category_400(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/start",
            json={"category": "notreal"},
        )
        assert resp.status_code == 400

    async def test_start_invalid_count(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/start", json={"count": 0}
        )
        assert resp.status_code == 422

    async def test_start_difficulty_falls_back_when_invalid(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/start",
            json={"difficulty": "wizard"},
        )
        assert resp.status_code == 200
        assert resp.json()["difficulty"] == "intermediate"

    async def test_answer_correct_price(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/answer",
            json={
                "item_id": "x1",
                "category": "prices",
                "expected_text": "$3.49",
                "user_answer": "3.49",
                "hint": "tip",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["correct"] is True
        assert body["expected_normalized"] == body["user_normalized"] == "349"
        assert body["hint"] == "tip"

    async def test_answer_wrong_returns_false(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/answer",
            json={
                "item_id": "x1",
                "category": "teens_vs_tens",
                "expected_text": "15",
                "user_answer": "50",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["correct"] is False

    async def test_answer_time_accepts_alt_separators(self, client: AsyncClient):
        for user in ["7:45", "7 45", "745"]:
            resp = await client.post(
                "/api/number-dictation/answer",
                json={
                    "item_id": "x",
                    "category": "times",
                    "expected_text": "7:45",
                    "user_answer": user,
                },
            )
            assert resp.status_code == 200
            assert resp.json()["correct"] is True, f"failed: {user}"

    async def test_answer_unknown_category(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/answer",
            json={
                "item_id": "x",
                "category": "weather",
                "expected_text": "5",
                "user_answer": "5",
            },
        )
        assert resp.status_code == 400

    async def test_complete_persists_summary(self, client: AsyncClient):
        payload = {
            "session_id": "sess-abc",
            "category": "prices",
            "results": [
                {"item_id": "i1", "category": "prices", "correct": True},
                {"item_id": "i2", "category": "prices", "correct": True},
                {"item_id": "i3", "category": "prices", "correct": False},
                {"item_id": "i4", "category": "prices", "correct": True},
            ],
        }
        resp = await client.post("/api/number-dictation/complete", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 4
        assert body["correct"] == 3
        assert abs(body["accuracy"] - 0.75) < 1e-6
        assert body["saved_id"] > 0

        # Verify it shows up in /recent
        recent = await client.get("/api/number-dictation/recent")
        assert recent.status_code == 200
        rdata = recent.json()
        assert rdata["sessions"] == 1
        assert rdata["by_category"]["prices"]["total"] == 4

    async def test_complete_empty_results(self, client: AsyncClient):
        resp = await client.post(
            "/api/number-dictation/complete",
            json={"session_id": "s1", "category": "mixed", "results": []},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 0
        assert body["correct"] == 0
        assert body["accuracy"] == 0.0
