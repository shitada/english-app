"""Integration tests for the Quick Thought-Group Phrasing endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestThoughtGroupAPI:

    async def test_returns_valid_llm_payload(self, client: AsyncClient):
        sentence = (
            "When the meeting finally ended everyone stood up gathered their "
            "belongings and quietly left the conference room today."
        )
        words = sentence.split()
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={
            "sentence": sentence,
            "words": words,
            "pause_indices": [5, 9, 13],
            "rules": ["after subordinate clause", "between coordinated verbs", "between coordinated verbs"],
        })
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.get("/api/listening/thought-group?difficulty=intermediate")
        assert res.status_code == 200
        data = res.json()
        assert data["difficulty"] == "intermediate"
        assert data["sentence"]
        assert 15 <= len(data["words"]) <= 25
        assert data["pause_indices"] == [5, 9, 13]
        for i in data["pause_indices"]:
            assert 1 <= i <= len(data["words"]) - 1
        assert len(data["rules"]) == len(data["pause_indices"])

    async def test_falls_back_on_malformed_llm(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={"foo": "bar"})  # invalid shape
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.get("/api/listening/thought-group?difficulty=advanced")
        assert res.status_code == 200
        data = res.json()
        assert data["difficulty"] == "advanced"
        # Fallback bank entry
        assert 15 <= len(data["words"]) <= 25
        assert 2 <= len(data["pause_indices"]) <= 4
        assert len(data["rules"]) == len(data["pause_indices"])

    async def test_falls_back_on_llm_exception(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.get("/api/listening/thought-group")
        assert res.status_code == 200
        data = res.json()
        assert data["sentence"]
        assert data["words"]
        assert data["pause_indices"]

    async def test_invalid_difficulty_normalized(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.get("/api/listening/thought-group?difficulty=expert")
        assert res.status_code == 200
        assert res.json()["difficulty"] == "intermediate"

    async def test_indices_deduped_from_llm(self, client: AsyncClient):
        sentence = " ".join(["word"] * 18)
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={
            "sentence": sentence,
            "pause_indices": [9, 5, 5, 13, 9],
            "rules": ["a", "b", "c"],
        })
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.get("/api/listening/thought-group")
        assert res.status_code == 200
        assert res.json()["pause_indices"] == [5, 9, 13]
