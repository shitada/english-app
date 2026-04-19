"""Integration tests for /api/internal/copilot-metrics endpoint."""

from __future__ import annotations

import pytest

from app.copilot_client import get_latency_tracker


@pytest.mark.integration
@pytest.mark.asyncio
async def test_copilot_metrics_endpoint_schema(client):
    get_latency_tracker().reset()
    resp = await client.get("/api/internal/copilot-metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert "labels" in data
    assert "all" in data
    assert "buffer_cap" in data
    assert data["all"]["count"] == 0
    assert data["all"]["llm"]["count"] == 0
    assert data["labels"] == {}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_copilot_metrics_reflects_recorded_calls(client):
    tracker = get_latency_tracker()
    tracker.reset()
    tracker.record("conversation_start", 0.1, 1.0, 1.1)
    tracker.record("conversation_message", 0.1, 2.0, 2.1)
    tracker.record("conversation_message", 0.1, 4.0, 4.1)

    resp = await client.get("/api/internal/copilot-metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert "conversation_start" in data["labels"]
    assert "conversation_message" in data["labels"]
    assert data["labels"]["conversation_message"]["count"] == 2
    assert data["labels"]["conversation_message"]["llm"]["max_s"] == pytest.approx(4.0)
    assert data["all"]["count"] == 3
    # cleanup so other tests are not affected
    tracker.reset()
