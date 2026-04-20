"""Integration tests for the Quick Contrastive Stress API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestContrastiveStressAPI:

    async def test_returns_copilot_payload(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "She gave him the red book yesterday.",
            "options": [
                {"word_index": 0, "meaning": "She gave it, not someone else."},
                {"word_index": 2, "meaning": "She gave it to him, not someone else."},
                {"word_index": 4, "meaning": "The red one, not another color."},
                {"word_index": 6, "meaning": "Yesterday, not another day."},
            ],
        })
        with patch(
            "app.routers.contrastive_stress.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.get("/api/quick/contrastive-stress?difficulty=advanced")
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "advanced"
        assert isinstance(data["sentence"], str) and data["sentence"]
        n = len(data["words"])
        assert 5 <= n <= 12
        assert 3 <= len(data["options"]) <= 4
        # correct_index must point into options
        assert 0 <= data["correct_index"] < len(data["options"])
        # all option word_indices must be in range and reflect the correct word
        for opt in data["options"]:
            assert 0 <= opt["word_index"] < n
            assert opt["word"] == data["words"][opt["word_index"]]
            assert opt["meaning"]

    async def test_falls_back_on_invalid_payload(self, client: AsyncClient):
        # Sentence too short -> validator rejects -> static fallback used
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "sentence": "Too short.",
            "options": [{"word_index": 0, "meaning": "x"}],
        })
        with patch(
            "app.routers.contrastive_stress.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.get("/api/quick/contrastive-stress")
        assert resp.status_code == 200
        data = resp.json()
        # We should still get a well-formed item from the fallback bank.
        assert data["difficulty"] == "intermediate"
        assert 5 <= len(data["words"]) <= 12
        assert 3 <= len(data["options"]) <= 4
        assert 0 <= data["correct_index"] < len(data["options"])

    async def test_falls_back_when_copilot_raises(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("LLM down"))
        with patch(
            "app.routers.contrastive_stress.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.get("/api/quick/contrastive-stress?difficulty=beginner")
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "beginner"
        assert len(data["options"]) >= 3

    async def test_unknown_difficulty_normalized(self, client: AsyncClient):
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("LLM down"))
        with patch(
            "app.routers.contrastive_stress.get_copilot_service",
            return_value=mock_copilot,
        ):
            resp = await client.get("/api/quick/contrastive-stress?difficulty=ultra")
        assert resp.status_code == 200
        assert resp.json()["difficulty"] == "intermediate"
