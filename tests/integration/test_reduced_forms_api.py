"""Integration tests for the Reduced Forms drill API."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestReducedFormsAPI:

    async def test_get_round_returns_5_well_formed_items(self, client: AsyncClient):
        resp = await client.get("/api/reduced-forms/round")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert len(data["items"]) == 5
        for it in data["items"]:
            assert it["id"]
            assert it["reduction_type"]
            assert it["reduced_text"]
            assert it["full_text"]
            assert isinstance(it["focus_chunks"], list)
        # Items must be unique
        ids = [it["id"] for it in data["items"]]
        assert len(set(ids)) == 5

    async def test_post_attempt_inserts_row_and_returns_weakness(self, client: AsyncClient):
        # Pull a round so we have a real item id.
        round_ = (await client.get("/api/reduced-forms/round")).json()
        item = round_["items"][0]

        payload = {
            "item_id": item["id"],
            "reduction_type": item["reduction_type"],
            "reduced_text": item["reduced_text"],
            "full_text": item["full_text"],
            "user_expand": item["full_text"],  # exact match -> correct
            "shadow_accuracy": 75.0,
        }
        resp = await client.post("/api/reduced-forms/attempt", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] > 0
        assert body["expand_correct"] is True
        assert body["shadow_accuracy"] == 75.0
        assert item["reduction_type"] in body["weakness"]

    async def test_attempt_grades_contractions_as_equivalent(self, client: AsyncClient):
        payload = {
            "item_id": "test-1",
            "reduction_type": "gonna",
            "reduced_text": "I'm gonna go.",
            "full_text": "I am going to go.",
            "user_expand": "I'm going to go.",  # contraction equivalent
            "shadow_accuracy": 0.0,
        }
        resp = await client.post("/api/reduced-forms/attempt", json=payload)
        assert resp.status_code == 200
        assert resp.json()["expand_correct"] is True

    async def test_attempt_marks_wrong_when_text_differs(self, client: AsyncClient):
        payload = {
            "item_id": "test-2",
            "reduction_type": "lemme",
            "reduced_text": "Lemme see.",
            "full_text": "Let me see.",
            "user_expand": "Allow me to look.",
            "shadow_accuracy": 0.0,
        }
        resp = await client.post("/api/reduced-forms/attempt", json=payload)
        assert resp.status_code == 200
        assert resp.json()["expand_correct"] is False
