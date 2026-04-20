"""Integration tests for the Preposition Cloze Drill API."""

from __future__ import annotations

import pytest


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_default(client):
    r = await client.get("/api/prepositions/session")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["count"] == len(data["items"])
    assert 1 <= data["count"] <= 8
    it = data["items"][0]
    for key in ("id", "sentence_with_blank", "options", "answer", "explanation", "category", "level"):
        assert key in it
    assert it["answer"] in it["options"]
    assert 4 <= len(it["options"]) <= 6
    assert "___" in it["sentence_with_blank"]
    assert it["category"] in {"time", "place", "collocation", "phrasal"}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_custom_count(client):
    r = await client.get("/api/prepositions/session", params={"count": 12})
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 12
    assert len(data["items"]) == 12


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_invalid_level(client):
    r = await client.get("/api/prepositions/session", params={"level": "bogus"})
    assert r.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_correct_and_incorrect(client):
    session = (await client.get("/api/prepositions/session", params={"count": 1})).json()
    item = session["items"][0]

    # Correct attempt
    r = await client.post("/api/prepositions/attempt", json={
        "item_id": item["id"],
        "chosen": item["answer"],
        "response_ms": 1200,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] is True
    assert body["answer"] == item["answer"]
    assert body["explanation"]

    # Incorrect attempt — pick a different option
    wrong = next(o for o in item["options"] if o != item["answer"])
    r2 = await client.post("/api/prepositions/attempt", json={
        "item_id": item["id"],
        "chosen": wrong,
    })
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["correct"] is False
    assert body2["answer"] == item["answer"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attempt_unknown_item_404(client):
    r = await client.post("/api/prepositions/attempt", json={
        "item_id": "does-not-exist-xyz",
        "chosen": "in",
    })
    assert r.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_stats_after_seeded_attempts(client):
    session = (await client.get("/api/prepositions/session", params={"count": 3})).json()
    items = session["items"]
    assert len(items) >= 2

    # 1 correct
    await client.post("/api/prepositions/attempt", json={
        "item_id": items[0]["id"],
        "chosen": items[0]["answer"],
    })
    # 2 wrong, both on the same item → one confused pair
    wrong1 = next(o for o in items[1]["options"] if o != items[1]["answer"])
    for _ in range(2):
        await client.post("/api/prepositions/attempt", json={
            "item_id": items[1]["id"],
            "chosen": wrong1,
        })

    r = await client.get("/api/prepositions/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["attempts"] == 3
    assert data["correct"] == 1
    assert data["accuracy"] == pytest.approx(1 / 3, abs=1e-4)
    assert isinstance(data["per_category"], list) and len(data["per_category"]) >= 1
    assert isinstance(data["confused_pairs"], list)
    assert any(
        p["correct"] == items[1]["answer"] and p["chosen"] == wrong1 and p["count"] == 2
        for p in data["confused_pairs"]
    )
