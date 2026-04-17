"""Integration tests for the CEFR estimate API endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestCEFREstimate:
    async def test_empty_database_returns_a1(self, client: AsyncClient):
        """An empty DB should return A1 Beginner with zero scores."""
        resp = await client.get("/api/dashboard/cefr-estimate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "A1"
        assert data["level_label"] == "Beginner"
        assert data["overall_score"] == 0
        assert data["next_level"] == "A2"

    async def test_response_shape(self, client: AsyncClient):
        """Response should include all expected keys."""
        resp = await client.get("/api/dashboard/cefr-estimate")
        assert resp.status_code == 200
        data = resp.json()
        assert "level" in data
        assert "level_label" in data
        assert "overall_score" in data
        assert "sub_scores" in data
        assert "progress_to_next" in data
        assert "next_level" in data
        assert "focus_tip" in data

        # Validate sub_scores shape
        sub = data["sub_scores"]
        for key in ("grammar", "vocabulary", "pronunciation", "fluency", "listening"):
            assert key in sub
            assert isinstance(sub[key], (int, float))

    async def test_sub_scores_are_bounded(self, client: AsyncClient):
        """All sub-scores should be between 0 and 100."""
        resp = await client.get("/api/dashboard/cefr-estimate")
        assert resp.status_code == 200
        data = resp.json()
        for key, val in data["sub_scores"].items():
            assert 0 <= val <= 100, f"{key} out of range: {val}"
        assert 0 <= data["overall_score"] <= 100
        assert 0 <= data["progress_to_next"] <= 100
