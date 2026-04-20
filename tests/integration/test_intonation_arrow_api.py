"""Integration tests for the Intonation Arrow Drill API."""

from __future__ import annotations

import pytest


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_default_returns_8_items(client):
    r = await client.post("/api/intonation-arrow/session", json={})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["count"] == 8
    assert len(data["items"]) == 8
    for it in data["items"]:
        for key in ("id", "text", "pattern", "explanation", "category"):
            assert key in it
        assert it["pattern"] in {"rising", "falling", "rise_fall"}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_no_body_defaults_to_8(client):
    r = await client.post("/api/intonation-arrow/session")
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 8


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_custom_count(client):
    r = await client.post("/api/intonation-arrow/session", json={"count": 4})
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 4
    assert len(data["items"]) == 4


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_invalid_count_422(client):
    r = await client.post("/api/intonation-arrow/session", json={"count": 0})
    assert r.status_code == 422
    r2 = await client.post("/api/intonation-arrow/session", json={"count": 999})
    assert r2.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_items_are_balanced(client):
    r = await client.post("/api/intonation-arrow/session", json={"count": 9})
    data = r.json()
    counts = {"rising": 0, "falling": 0, "rise_fall": 0}
    for it in data["items"]:
        counts[it["pattern"]] += 1
    # With count=9 and ≥5 items per pattern, each bucket should get 3.
    for p, n in counts.items():
        assert n >= 2, f"pattern {p} under-represented: {counts}"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_correct_and_incorrect(client):
    session = (await client.post("/api/intonation-arrow/session", json={"count": 3})).json()
    item = session["items"][0]

    # Correct
    r = await client.post("/api/intonation-arrow/attempt", json={
        "item_id": item["id"],
        "chosen": item["pattern"],
        "correct": True,
        "latency_ms": 900,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["correct"] is True
    assert body["pattern"] == item["pattern"]
    assert body["explanation"]

    # Incorrect — use a different pattern
    wrong = next(p for p in ("rising", "falling", "rise_fall") if p != item["pattern"])
    r2 = await client.post("/api/intonation-arrow/attempt", json={
        "item_id": item["id"],
        "chosen": wrong,
        "correct": False,
    })
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["correct"] is False
    assert body2["pattern"] == item["pattern"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_unknown_item_404(client):
    r = await client.post("/api/intonation-arrow/attempt", json={
        "item_id": "does-not-exist-xyz",
        "chosen": "rising",
        "correct": False,
    })
    assert r.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_invalid_chosen_422(client):
    session = (await client.post("/api/intonation-arrow/session", json={"count": 1})).json()
    item = session["items"][0]
    r = await client.post("/api/intonation-arrow/attempt", json={
        "item_id": item["id"],
        "chosen": "sideways",
        "correct": False,
    })
    assert r.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_validation_missing_field(client):
    r = await client.post("/api/intonation-arrow/attempt", json={
        "item_id": "ia-001",
        # missing chosen + correct
    })
    assert r.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_stats_empty(client):
    r = await client.get("/api/intonation-arrow/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["attempts"] == 0
    assert data["correct"] == 0
    assert data["accuracy"] == 0.0
    assert len(data["per_pattern"]) == 3


@pytest.mark.integration
@pytest.mark.asyncio
async def test_stats_after_seeded_attempts(client):
    session = (await client.post("/api/intonation-arrow/session", json={"count": 6})).json()
    items = session["items"]

    # seed: 1 correct + 1 wrong
    await client.post("/api/intonation-arrow/attempt", json={
        "item_id": items[0]["id"],
        "chosen": items[0]["pattern"],
        "correct": True,
    })
    other = next(p for p in ("rising", "falling", "rise_fall") if p != items[1]["pattern"])
    await client.post("/api/intonation-arrow/attempt", json={
        "item_id": items[1]["id"],
        "chosen": other,
        "correct": False,
    })

    r = await client.get("/api/intonation-arrow/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["attempts"] == 2
    assert data["correct"] == 1
    assert data["accuracy"] == pytest.approx(0.5, abs=1e-4)
    patterns = {p["pattern"] for p in data["per_pattern"]}
    assert patterns == {"rising", "falling", "rise_fall"}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_fresh_db_has_intonation_arrow_table(client):
    """Migration/schema creates the intonation_arrow_attempts table on a fresh DB."""
    # Hitting stats on a fresh DB should not 500 — table must exist.
    r = await client.get("/api/intonation-arrow/stats")
    assert r.status_code == 200
