"""Integration tests for the health check endpoint."""

from __future__ import annotations

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
