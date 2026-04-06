"""Integration tests for the health check endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.integration
class TestHealthCheck:
    async def test_healthy_response(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["database"] == "ok"
        assert "uptime_seconds" in data

    async def test_response_has_required_fields(self, client):
        resp = await client.get("/api/health")
        data = resp.json()
        assert set(data.keys()) == {"status", "database", "uptime_seconds", "api_version"}

    async def test_degraded_when_db_unavailable(self, client):
        """Health check returns 503 with degraded status when DB is unreachable."""
        with patch("app.main.get_db", new_callable=AsyncMock, side_effect=Exception("DB down")):
            resp = await client.get("/api/health")
        assert resp.status_code == 503
        data = resp.json()
        assert data["status"] == "degraded"
        assert data["database"] == "error"
