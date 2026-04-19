"""Integration tests for the inline dictation API endpoint."""

from __future__ import annotations

import pytest


@pytest.mark.integration
@pytest.mark.asyncio
async def test_record_dictation_attempt_success(client):
    payload = {
        "conversation_id": "12",
        "message_id": "12-2",
        "accuracy": 87.5,
        "word_count": 8,
        "missed_word_count": 1,
    }
    res = await client.post("/api/conversation/dictation_attempt", json=payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] > 0
    assert body["accuracy"] == pytest.approx(87.5)
    assert body["word_count"] == 8
    assert body["missed_word_count"] == 1
    assert "recent_avg_accuracy_7d" in body
    assert body["recent_avg_accuracy_7d"] == pytest.approx(87.5)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_record_dictation_attempt_accepts_null_ids(client):
    payload = {
        "accuracy": 100.0,
        "word_count": 5,
        "missed_word_count": 0,
    }
    res = await client.post("/api/conversation/dictation_attempt", json=payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accuracy"] == 100.0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_record_dictation_attempt_rejects_inconsistent_counts(client):
    payload = {
        "accuracy": 0.0,
        "word_count": 3,
        "missed_word_count": 9,
    }
    res = await client.post("/api/conversation/dictation_attempt", json=payload)
    assert res.status_code == 400


@pytest.mark.integration
@pytest.mark.asyncio
async def test_record_dictation_attempt_rejects_out_of_range_accuracy(client):
    payload = {
        "accuracy": 150.0,
        "word_count": 5,
        "missed_word_count": 0,
    }
    res = await client.post("/api/conversation/dictation_attempt", json=payload)
    assert res.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_recent_avg_accuracy_aggregates_across_attempts(client):
    for acc in (80.0, 100.0, 60.0):
        res = await client.post(
            "/api/conversation/dictation_attempt",
            json={
                "conversation_id": "c",
                "message_id": "m",
                "accuracy": acc,
                "word_count": 5,
                "missed_word_count": 0,
            },
        )
        assert res.status_code == 200
    body = res.json()
    # Last response carries the running 7-day average across all 3 attempts.
    assert body["recent_avg_accuracy_7d"] == pytest.approx(80.0)
