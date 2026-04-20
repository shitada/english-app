"""Integration tests for the Paraphrase Practice API."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestParaphraseAPI:

    async def test_session_returns_five_items_at_easy(self, client: AsyncClient):
        resp = await client.get("/api/paraphrase/session?level=easy&count=5")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["level"] == "easy"
        assert len(data["items"]) == 5
        for it in data["items"]:
            assert it["level"] == "easy"
            assert isinstance(it["text"], str) and it["text"]

    async def test_session_default_count_is_five(self, client: AsyncClient):
        resp = await client.get("/api/paraphrase/session?level=hard")
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "hard"
        assert len(data["items"]) == 5
        for it in data["items"]:
            assert it["level"] == "hard"

    async def test_session_invalid_level_falls_back_to_easy(self, client: AsyncClient):
        resp = await client.get("/api/paraphrase/session?level=expert&count=3")
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "easy"
        assert len(data["items"]) == 3

    async def test_session_validates_count_bounds(self, client: AsyncClient):
        r0 = await client.get("/api/paraphrase/session?count=0")
        assert r0.status_code == 422
        rmax = await client.get("/api/paraphrase/session?count=99")
        assert rmax.status_code == 422

    async def test_score_returns_all_four_scores(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.return_value = {
            "meaning_score": 90,
            "grammar_score": 85,
            "naturalness_score": 80,
            "overall": 85,
            "kept_meaning": True,
            "used_different_words": True,
            "feedback": "Nice rewording.",
            "suggested_paraphrase": "I generally take the bus to work because it's cheaper.",
        }
        resp = await client.post(
            "/api/paraphrase/score",
            json={
                "source": "I usually take the bus to work because it is cheaper.",
                "attempt": "I generally take the bus to work since it costs less.",
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["meaning_score"] == 90
        assert body["grammar_score"] == 85
        assert body["naturalness_score"] == 80
        assert body["overall"] == 85
        assert body["kept_meaning"] is True
        assert body["used_different_words"] is True
        assert body["feedback"] == "Nice rewording."
        assert body["suggested_paraphrase"]

    async def test_score_safe_defaults_when_copilot_raises(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.side_effect = RuntimeError("upstream timeout")
        resp = await client.post(
            "/api/paraphrase/score",
            json={
                "source": "She likes apples.",
                "attempt": "Apples are something she enjoys.",
            },
        )
        # Endpoint never 500s — DAL swallows the error and returns defaults.
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["overall"] == 0
        assert body["meaning_score"] == 0
        assert body["used_different_words"] is True

    async def test_score_rejects_empty_inputs(self, client: AsyncClient):
        resp = await client.post(
            "/api/paraphrase/score",
            json={"source": "", "attempt": "something"},
        )
        assert resp.status_code == 422
        resp = await client.post(
            "/api/paraphrase/score",
            json={"source": "anything", "attempt": ""},
        )
        assert resp.status_code == 422
