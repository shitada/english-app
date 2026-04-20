"""Integration tests for the Monologue Drill API."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestMonologueAPI:

    async def test_scenarios_endpoint(self, client: AsyncClient):
        resp = await client.get("/api/monologue/scenarios")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "scenarios" in data
        assert len(data["scenarios"]) >= 5
        s0 = data["scenarios"][0]
        assert set(s0.keys()) >= {
            "id", "title", "prompt", "target_seconds", "content_beats",
        }
        assert isinstance(s0["content_beats"], list) and s0["content_beats"]

    async def test_attempt_end_to_end(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.return_value = {
            "beats_covered": ["Your name", "Your role or field"],
            "fluency_score": 82,
            "structure_score": 75,
            "overall_score": 79,
            "one_line_feedback": "Confident pacing, add a clearer close.",
            "suggested_rewrite_opening": "Hi — I'm Alex and I build product UX.",
        }
        payload = {
            "scenario_id": "networking-intro",
            "transcript": (
                "Hi, I'm Alex. I'm a product designer focused on developer "
                "tools. Um, happy to chat about API ergonomics."
            ),
            "duration_seconds": 42,
        }
        resp = await client.post("/api/monologue/attempt", json=payload)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] > 0
        assert body["scenario_id"] == "networking-intro"
        assert body["overall_score"] == 79
        assert body["word_count"] > 0
        assert body["wpm"] > 0
        # 1 filler word ("Um")
        assert body["filler_count"] >= 1
        assert 0 <= body["coverage_ratio"] <= 1
        assert body["feedback"]["beats_covered"] == [
            "Your name", "Your role or field",
        ]
        assert body["feedback"]["suggested_rewrite_opening"]

    async def test_attempt_unknown_scenario_returns_404(
        self, client: AsyncClient
    ):
        resp = await client.post(
            "/api/monologue/attempt",
            json={
                "scenario_id": "nope",
                "transcript": "hi there",
                "duration_seconds": 10,
            },
        )
        assert resp.status_code == 404

    async def test_attempt_validates_duration(self, client: AsyncClient):
        resp = await client.post(
            "/api/monologue/attempt",
            json={
                "scenario_id": "networking-intro",
                "transcript": "hi",
                "duration_seconds": 0,
            },
        )
        assert resp.status_code == 422

    async def test_attempt_safe_defaults_when_copilot_raises(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.side_effect = RuntimeError("llm down")
        resp = await client.post(
            "/api/monologue/attempt",
            json={
                "scenario_id": "networking-intro",
                "transcript": "Hi, I'm Alex.",
                "duration_seconds": 30,
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # DAL returned safe defaults, but the endpoint still succeeded.
        assert body["overall_score"] == 0
        assert body["feedback"]["beats_covered"] == []
        assert body["feedback"]["suggested_rewrite_opening"]

    async def test_history_empty(self, client: AsyncClient):
        resp = await client.get(
            "/api/monologue/history?scenario_id=networking-intro"
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["attempts"] == []
        assert data["personal_best"] is None

    async def test_history_returns_attempts_and_best(
        self, client: AsyncClient, mock_copilot
    ):
        mock_copilot.ask_json.return_value = {
            "beats_covered": ["Your name"],
            "fluency_score": 70,
            "structure_score": 70,
            "overall_score": 70,
            "one_line_feedback": "ok",
            "suggested_rewrite_opening": "Hello.",
        }
        for dur in (20, 25, 30):
            r = await client.post(
                "/api/monologue/attempt",
                json={
                    "scenario_id": "networking-intro",
                    "transcript": "Hi, I'm Alex.",
                    "duration_seconds": dur,
                },
            )
            assert r.status_code == 200

        resp = await client.get(
            "/api/monologue/history?scenario_id=networking-intro"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["attempts"]) == 3
        assert data["personal_best"] is not None
        assert data["personal_best"]["overall_score"] == 70
