"""Integration tests for the Sentence Stress Spotlight API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestStressSpotlightAPI:

    async def test_generate_returns_copilot_payload(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "I really need a coffee before the meeting starts today.",
            "words": ["I", "really", "need", "a", "coffee", "before", "the", "meeting", "starts", "today."],
            "stressed_indices": [1, 2, 4, 7, 8],
            "rationale": "Adverbs and content nouns carry stress.",
        })
        with patch(
            "app.routers.stress_spotlight.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.post("/api/stress-spotlight/generate?difficulty=advanced")
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "advanced"
        n = len(data["words"])
        assert 8 <= n <= 16
        # stressed indices subset of valid range
        for i in data["stressed_indices"]:
            assert 0 <= i < n
        assert data["rationale"]

    async def test_generate_falls_back_on_invalid_payload(self, client: AsyncClient):
        # Sentence too short -> validator rejects -> fallback used
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "Too short.",
            "stressed_indices": [0],
            "rationale": "x",
        })
        with patch(
            "app.routers.stress_spotlight.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.post("/api/stress-spotlight/generate")
        assert resp.status_code == 200
        data = resp.json()
        n = len(data["words"])
        assert 8 <= n <= 16
        # fallback indices should be valid subset
        for i in data["stressed_indices"]:
            assert 0 <= i < n
        assert len(data["stressed_indices"]) >= 2

    async def test_generate_falls_back_when_copilot_raises(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch(
            "app.routers.stress_spotlight.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.post("/api/stress-spotlight/generate?difficulty=beginner")
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "beginner"
        assert 8 <= len(data["words"]) <= 16

    async def test_generate_normalizes_unknown_difficulty(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("nope"))
        with patch(
            "app.routers.stress_spotlight.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.post("/api/stress-spotlight/generate?difficulty=expert")
        assert resp.status_code == 200
        assert resp.json()["difficulty"] == "intermediate"

    async def test_audio_returns_ssml_and_fallback(self, client: AsyncClient):
        resp = await client.get(
            "/api/stress-spotlight/audio",
            params={"sentence": "I love coffee in the morning.", "emphasize": "1,2,5"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["emphasized_indices"] == [1, 2, 5]
        assert "LOVE" in data["fallback_text"]
        assert "COFFEE" in data["fallback_text"]
        assert "MORNING." in data["fallback_text"]
        assert '<emphasis level="strong">love</emphasis>' in data["ssml"]
        assert data["ssml"].startswith("<speak>")
        assert data["emphasized_words"] == ["love", "coffee", "morning."]

    async def test_audio_drops_out_of_range_indices(self, client: AsyncClient):
        resp = await client.get(
            "/api/stress-spotlight/audio",
            params={"sentence": "Hello world", "emphasize": "0,99"},
        )
        assert resp.status_code == 200
        assert resp.json()["emphasized_indices"] == [0]

    async def test_audio_rejects_non_int_emphasize(self, client: AsyncClient):
        resp = await client.get(
            "/api/stress-spotlight/audio",
            params={"sentence": "Hello world", "emphasize": "abc"},
        )
        assert resp.status_code == 400

    async def test_attempt_persists_and_returns_scores(self, client: AsyncClient):
        payload = {
            "sentence": "I really need a coffee before the meeting starts today.",
            "words": ["I", "really", "need", "a", "coffee", "before", "the", "meeting", "starts", "today."],
            "expected_indices": [1, 2, 4, 7, 8],
            "user_indices": [1, 4, 7],
            "difficulty": "intermediate",
        }
        resp = await client.post("/api/stress-spotlight/attempt", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] > 0
        assert data["precision"] == 100.0  # all 3 picks correct
        assert data["recall"] == 60.0  # 3 / 5

    async def test_recent_returns_last_attempts(self, client: AsyncClient):
        payload_base = {
            "sentence": "She finally finished her project late last night again.",
            "words": ["She", "finally", "finished", "her", "project", "late", "last", "night", "again."],
            "expected_indices": [1, 2, 4, 5, 7],
            "difficulty": "intermediate",
        }
        # Insert 3 attempts
        for picked in ([1], [1, 2], [1, 2, 4]):
            r = await client.post(
                "/api/stress-spotlight/attempt",
                json={**payload_base, "user_indices": picked},
            )
            assert r.status_code == 200

        resp = await client.get("/api/stress-spotlight/recent?limit=10")
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 3
        # Newest first ordering
        assert items[0]["user_indices"] == [1, 2, 4]
        assert items[-1]["user_indices"] == [1]
        # Round-trip check
        assert items[0]["sentence"].startswith("She finally")
        assert items[0]["expected_indices"] == [1, 2, 4, 5, 7]

    async def test_attempt_rejects_invalid_payload(self, client: AsyncClient):
        # words must be non-empty
        resp = await client.post("/api/stress-spotlight/attempt", json={
            "sentence": "valid",
            "words": [],
            "expected_indices": [0],
            "user_indices": [0],
        })
        assert resp.status_code == 422

    async def test_full_flow_generate_then_attempt_then_recent(
        self, client: AsyncClient
    ):
        # Force fallback so we have a deterministic shape
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.stress_spotlight.get_copilot_service",
            return_value=mock_copilot,
        ):
            gen = await client.post("/api/stress-spotlight/generate")
        assert gen.status_code == 200
        item = gen.json()

        # Submit a perfect attempt
        attempt = await client.post("/api/stress-spotlight/attempt", json={
            "sentence": item["sentence"],
            "words": item["words"],
            "expected_indices": item["stressed_indices"],
            "user_indices": item["stressed_indices"],
            "difficulty": item["difficulty"],
        })
        assert attempt.status_code == 200
        assert attempt.json()["precision"] == 100.0
        assert attempt.json()["recall"] == 100.0
        assert attempt.json()["f1"] == 100.0

        recent = await client.get("/api/stress-spotlight/recent")
        assert recent.status_code == 200
        items = recent.json()["items"]
        assert len(items) == 1
        assert items[0]["sentence"] == item["sentence"]
