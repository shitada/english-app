"""Integration tests for the grammar pattern drill API endpoint."""

from __future__ import annotations

from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestGrammarPatternDrill:

    async def test_valid_request_returns_exercises(self, client: AsyncClient):
        """POST with valid category and difficulty returns exercises."""
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "exercises": [
                {
                    "incorrect": "She go to school every day.",
                    "correct": "She goes to school every day.",
                    "explanation": "Third person singular requires 'goes'."
                },
                {
                    "incorrect": "He don't like pizza.",
                    "correct": "He doesn't like pizza.",
                    "explanation": "Third person singular uses 'doesn't'."
                },
                {
                    "incorrect": "The team are playing well.",
                    "correct": "The team is playing well.",
                    "explanation": "Collective nouns take singular verbs."
                },
                {
                    "incorrect": "There is many people here.",
                    "correct": "There are many people here.",
                    "explanation": "'People' is plural, so use 'are'."
                },
                {
                    "incorrect": "Neither the cat nor the dogs is here.",
                    "correct": "Neither the cat nor the dogs are here.",
                    "explanation": "Verb agrees with the nearest subject 'dogs'."
                },
            ]
        })

        with patch("app.routers.dashboard.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/dashboard/grammar-pattern-drill",
                json={"category": "Subject-Verb Agreement", "difficulty": "intermediate"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["category"] == "Subject-Verb Agreement"
        assert data["difficulty"] == "intermediate"
        assert len(data["exercises"]) == 5
        for ex in data["exercises"]:
            assert "incorrect" in ex
            assert "correct" in ex
            assert "explanation" in ex

    async def test_default_difficulty_is_intermediate(self, client: AsyncClient):
        """When difficulty is not provided, it defaults to 'intermediate'."""
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "exercises": [
                {"incorrect": "Bad sentence.", "correct": "Good sentence.", "explanation": "Fix."}
                for _ in range(5)
            ]
        })

        with patch("app.routers.dashboard.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/dashboard/grammar-pattern-drill",
                json={"category": "Article Usage"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "intermediate"

    async def test_invalid_difficulty_returns_422(self, client: AsyncClient):
        """Invalid difficulty value should return 422 validation error."""
        resp = await client.post(
            "/api/dashboard/grammar-pattern-drill",
            json={"category": "Subject-Verb Agreement", "difficulty": "expert"},
        )
        assert resp.status_code == 422

    async def test_empty_category_returns_422(self, client: AsyncClient):
        """Empty category string should return 422 validation error."""
        resp = await client.post(
            "/api/dashboard/grammar-pattern-drill",
            json={"category": "", "difficulty": "beginner"},
        )
        assert resp.status_code == 422

    async def test_missing_category_returns_422(self, client: AsyncClient):
        """Missing category field should return 422 validation error."""
        resp = await client.post(
            "/api/dashboard/grammar-pattern-drill",
            json={"difficulty": "beginner"},
        )
        assert resp.status_code == 422

    async def test_copilot_failure_returns_502(self, client: AsyncClient):
        """When the LLM call fails, endpoint should return 502."""
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("LLM unavailable"))

        with patch("app.routers.dashboard.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/dashboard/grammar-pattern-drill",
                json={"category": "Subject-Verb Agreement", "difficulty": "beginner"},
            )

        assert resp.status_code == 502
        assert "Failed to generate" in resp.json()["detail"]

    async def test_copilot_returns_empty_exercises(self, client: AsyncClient):
        """When LLM returns no exercises, endpoint should return 502."""
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={"exercises": []})

        with patch("app.routers.dashboard.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/dashboard/grammar-pattern-drill",
                json={"category": "Tense Usage", "difficulty": "advanced"},
            )

        assert resp.status_code == 502
        assert "No exercises generated" in resp.json()["detail"]

    async def test_exercises_capped_at_five(self, client: AsyncClient):
        """Even if LLM returns more than 5 exercises, response should have max 5."""
        mock_copilot = MagicMock()
        mock_copilot.ask_json = AsyncMock(return_value={
            "exercises": [
                {"incorrect": f"Bad {i}.", "correct": f"Good {i}.", "explanation": f"Fix {i}."}
                for i in range(10)
            ]
        })

        with patch("app.routers.dashboard.get_copilot_service", return_value=mock_copilot):
            resp = await client.post(
                "/api/dashboard/grammar-pattern-drill",
                json={"category": "Pronoun Reference", "difficulty": "beginner"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["exercises"]) == 5
