"""Integration tests for the Connected Speech Decoder API (/api/connected-speech/*)."""

from __future__ import annotations

import pytest


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_default_returns_items(client):
    res = await client.get("/api/connected-speech/session")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] is None
    assert isinstance(data["items"], list)
    assert 1 <= len(data["items"]) <= 8
    item = data["items"][0]
    for key in ("id", "reduced", "expanded", "category", "difficulty"):
        assert key in item
    assert item["difficulty"] in ("easy", "medium", "hard")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_count_and_difficulty_filter(client):
    res = await client.get(
        "/api/connected-speech/session",
        params={"difficulty": "easy", "count": 5},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "easy"
    assert len(data["items"]) == 5
    for it in data["items"]:
        assert it["difficulty"] == "easy"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_invalid_difficulty_422(client):
    res = await client.get(
        "/api/connected-speech/session",
        params={"difficulty": "impossible"},
    )
    assert res.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_correct_persists(client):
    payload = {
        "reduced": "I'm gonna call her.",
        "expanded": "I am going to call her.",
        "user_answer": "I am going to call her.",
        "category": "gonna",
        "time_ms": 2000,
    }
    r = await client.post("/api/connected-speech/attempt", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] is True
    assert body["id"] > 0
    assert body["normalized_expected"] == body["normalized_user"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_accepts_reduced_form_as_equivalent(client):
    payload = {
        "reduced": "I'm gonna call her.",
        "expanded": "I am going to call her.",
        "user_answer": "I'm gonna call her.",
        "category": "gonna",
    }
    r = await client.post("/api/connected-speech/attempt", json=payload)
    assert r.status_code == 200
    assert r.json()["correct"] is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_incorrect(client):
    payload = {
        "reduced": "I wanna eat.",
        "expanded": "I want to eat.",
        "user_answer": "I want to sleep.",
        "category": "wanna",
    }
    r = await client.post("/api/connected-speech/attempt", json=payload)
    assert r.status_code == 200
    assert r.json()["correct"] is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_stats_returns_per_category(client):
    await client.post("/api/connected-speech/attempt", json={
        "reduced": "I'm gonna go.",
        "expanded": "I am going to go.",
        "user_answer": "I am going to go.",
        "category": "gonna",
    })
    await client.post("/api/connected-speech/attempt", json={
        "reduced": "I'm gonna go.",
        "expanded": "I am going to go.",
        "user_answer": "completely wrong",
        "category": "gonna",
    })
    await client.post("/api/connected-speech/attempt", json={
        "reduced": "I wanna eat.",
        "expanded": "I want to eat.",
        "user_answer": "I want to eat.",
        "category": "wanna",
    })

    res = await client.get("/api/connected-speech/stats")
    assert res.status_code == 200
    data = res.json()
    assert "stats" in data
    assert "recent_streak" in data
    by = {s["category"]: s for s in data["stats"]}
    assert by["gonna"]["attempts"] == 2
    assert by["gonna"]["correct"] == 1
    assert by["wanna"]["attempts"] == 1
    assert by["wanna"]["correct"] == 1
    assert data["recent_streak"] >= 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_categories_endpoint(client):
    r = await client.get("/api/connected-speech/categories")
    assert r.status_code == 200
    cats = r.json()["categories"]
    for expected in ("gonna", "wanna", "gotta", "lemme", "whatcha", "didja", "kinda"):
        assert expected in cats
