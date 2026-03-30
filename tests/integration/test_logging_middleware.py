"""Integration tests for the request logging middleware."""

from __future__ import annotations

import pytest


@pytest.mark.integration
class TestLoggingMiddleware:
    async def test_response_has_request_id_header(self, client):
        resp = await client.get("/api/conversation/topics")
        assert resp.status_code == 200
        assert "x-request-id" in resp.headers
        assert len(resp.headers["x-request-id"]) == 8

    async def test_request_id_is_unique(self, client):
        resp1 = await client.get("/api/conversation/topics")
        resp2 = await client.get("/api/vocabulary/topics")
        id1 = resp1.headers.get("x-request-id")
        id2 = resp2.headers.get("x-request-id")
        assert id1 != id2

    async def test_error_response_has_request_id(self, client):
        resp = await client.post(
            "/api/conversation/message",
            json={"conversation_id": 99999, "content": "hello"},
        )
        assert resp.status_code == 404
        assert "x-request-id" in resp.headers
