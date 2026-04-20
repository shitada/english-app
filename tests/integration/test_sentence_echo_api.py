"""Integration tests for the Sentence Echo memory-span listening drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestSentenceEchoAPI:

    async def test_generate_returns_sentence_at_requested_span(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "She left her keys at home.",
            "ipa_hint": "",
        })
        with patch("app.routers.listening.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/listening/sentence-echo/generate",
                json={"span": 6, "level": "intermediate"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["span"] == 6
        # 6 words exactly
        assert len(data["sentence"].split()) == 6

    async def test_generate_falls_back_when_word_count_mismatch(self, client: AsyncClient):
        # LLM returns a 4-word sentence when 6 was requested → fallback used.
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "Too short here today.",
            "ipa_hint": "",
        })
        with patch("app.routers.listening.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/listening/sentence-echo/generate",
                json={"span": 6, "level": "beginner"},
            )
        assert resp.status_code == 200
        data = resp.json()
        # Fallback sentence has the correct word count.
        assert data["span"] == 6

    async def test_generate_falls_back_when_copilot_raises(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.routers.listening.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/listening/sentence-echo/generate",
                json={"span": 9, "level": "intermediate"},
            )
        assert resp.status_code == 200
        assert resp.json()["span"] == 9

    async def test_score_perfect_passes_and_advances_span(self, client: AsyncClient):
        target = "She left her keys at home."
        resp = await client.post(
            "/api/listening/sentence-echo/score",
            json={"target": target, "heard": target, "span": 6},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["accuracy"] == 1.0
        assert data["passed"] is True
        assert data["next_span"] == 9
        assert data["best_span"] == 6

    async def test_score_low_accuracy_fails_and_repeats_span(self, client: AsyncClient):
        target = "the cat sat on the mat today"
        heard = "a dog ran"
        resp = await client.post(
            "/api/listening/sentence-echo/score",
            json={"target": target, "heard": heard, "span": 7},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["passed"] is False
        assert data["next_span"] == 7
        assert 0.0 <= data["accuracy"] < 0.9

    async def test_trend_returns_recent_points(self, client: AsyncClient):
        target = "the cat sat on the mat"
        await client.post(
            "/api/listening/sentence-echo/score",
            json={"target": target, "heard": target, "span": 6},
        )
        resp = await client.get("/api/listening/sentence-echo/trend?days=14")
        assert resp.status_code == 200
        data = resp.json()
        assert "points" in data
        assert "best_span" in data
        assert data["best_span"] >= 6
        assert len(data["points"]) >= 1

    async def test_score_validates_input(self, client: AsyncClient):
        resp = await client.post(
            "/api/listening/sentence-echo/score",
            json={"target": "", "heard": "hi", "span": 6},
        )
        assert resp.status_code == 422

    async def test_generate_validates_span_range(self, client: AsyncClient):
        resp = await client.post(
            "/api/listening/sentence-echo/generate",
            json={"span": 100, "level": "intermediate"},
        )
        assert resp.status_code == 422
