"""Integration tests for the WOTD sentence practice endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestWotdPractice:
    async def test_evaluate_valid_sentence(self, client: AsyncClient, mock_copilot):
        """A valid request should return evaluation with all required fields."""
        mock_copilot.ask_json.return_value = {
            "word_used_correctly": True,
            "grammar_score": 8,
            "naturalness_score": 7,
            "feedback": "Great sentence! Very natural use of the word.",
            "model_sentence": "The hotel provides excellent accommodation for guests.",
        }

        resp = await client.post(
            "/api/dashboard/wotd-practice",
            json={
                "word": "accommodation",
                "meaning": "a place to stay, especially a hotel room",
                "user_sentence": "I need accommodation for two nights.",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["word_used_correctly"] is True
        assert 1 <= data["grammar_score"] <= 10
        assert 1 <= data["naturalness_score"] <= 10
        assert isinstance(data["feedback"], str)
        assert len(data["feedback"]) > 0
        assert isinstance(data["model_sentence"], str)
        assert len(data["model_sentence"]) > 0

    async def test_evaluate_incorrect_usage(self, client: AsyncClient, mock_copilot):
        """Word used incorrectly should return word_used_correctly=False."""
        mock_copilot.ask_json.return_value = {
            "word_used_correctly": False,
            "grammar_score": 6,
            "naturalness_score": 4,
            "feedback": "The word 'accommodation' was not used with the correct meaning here.",
            "model_sentence": "We booked accommodation near the beach.",
        }

        resp = await client.post(
            "/api/dashboard/wotd-practice",
            json={
                "word": "accommodation",
                "meaning": "a place to stay, especially a hotel room",
                "user_sentence": "I accommodation the food yesterday.",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["word_used_correctly"] is False

    async def test_empty_sentence_rejected(self, client: AsyncClient):
        """An empty user_sentence should be rejected with 422."""
        resp = await client.post(
            "/api/dashboard/wotd-practice",
            json={
                "word": "accommodation",
                "meaning": "a place to stay",
                "user_sentence": "",
            },
        )
        assert resp.status_code == 422

    async def test_missing_word_rejected(self, client: AsyncClient):
        """A missing word field should be rejected with 422."""
        resp = await client.post(
            "/api/dashboard/wotd-practice",
            json={
                "meaning": "a place to stay",
                "user_sentence": "I need accommodation.",
            },
        )
        assert resp.status_code == 422

    async def test_missing_meaning_rejected(self, client: AsyncClient):
        """A missing meaning field should be rejected with 422."""
        resp = await client.post(
            "/api/dashboard/wotd-practice",
            json={
                "word": "accommodation",
                "user_sentence": "I need accommodation.",
            },
        )
        assert resp.status_code == 422

    async def test_copilot_failure_returns_502(self, client: AsyncClient, mock_copilot):
        """If LLM call fails, endpoint should return 502."""
        mock_copilot.ask_json.side_effect = Exception("LLM timeout")

        resp = await client.post(
            "/api/dashboard/wotd-practice",
            json={
                "word": "accommodation",
                "meaning": "a place to stay",
                "user_sentence": "I need accommodation for my trip.",
            },
        )
        assert resp.status_code == 502

    async def test_response_scores_clamped(self, client: AsyncClient, mock_copilot):
        """Scores should be clamped to 1-10 range even if LLM returns outliers."""
        mock_copilot.ask_json.return_value = {
            "word_used_correctly": True,
            "grammar_score": 15,
            "naturalness_score": -3,
            "feedback": "Good job!",
            "model_sentence": "A model sentence.",
        }

        resp = await client.post(
            "/api/dashboard/wotd-practice",
            json={
                "word": "test",
                "meaning": "an examination",
                "user_sentence": "I took a test today.",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["grammar_score"] == 10
        assert data["naturalness_score"] == 1
