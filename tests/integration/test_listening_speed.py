"""Integration tests for the Listening Speed Ladder API."""

import pytest


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_default_speed_when_no_progress(client):
    resp = await client.get("/api/listening/speed/business")
    assert resp.status_code == 200
    data = resp.json()
    assert data["topic"] == "business"
    assert data["max_speed"] == 1.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_then_retrieve(client):
    save = await client.post("/api/listening/speed", json={"topic": "travel", "speed": 1.3})
    assert save.status_code == 200
    body = save.json()
    assert body["ok"] is True
    assert body["topic"] == "travel"
    assert body["max_speed"] == 1.3

    get = await client.get("/api/listening/speed/travel")
    assert get.status_code == 200
    assert get.json()["max_speed"] == 1.3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_only_writes_when_greater(client):
    await client.post("/api/listening/speed", json={"topic": "food", "speed": 1.5})
    resp = await client.post("/api/listening/speed", json={"topic": "food", "speed": 1.15})
    assert resp.status_code == 200
    assert resp.json()["max_speed"] == 1.5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_speed_validation_rejects_out_of_range(client):
    too_high = await client.post("/api/listening/speed", json={"topic": "x", "speed": 2.5})
    assert too_high.status_code == 422
    too_low = await client.post("/api/listening/speed", json={"topic": "x", "speed": 0.4})
    assert too_low.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_topics_isolated(client):
    await client.post("/api/listening/speed", json={"topic": "alpha", "speed": 1.5})
    await client.post("/api/listening/speed", json={"topic": "beta", "speed": 1.15})
    a = await client.get("/api/listening/speed/alpha")
    b = await client.get("/api/listening/speed/beta")
    g = await client.get("/api/listening/speed/gamma")
    assert a.json()["max_speed"] == 1.5
    assert b.json()["max_speed"] == 1.15
    assert g.json()["max_speed"] == 1.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_global_topic_alias(client):
    """Reserved topic names like 'all' are normalized to the global ('') bucket."""
    await client.post("/api/listening/speed", json={"topic": "", "speed": 1.3})
    resp = await client.get("/api/listening/speed/all")
    assert resp.status_code == 200
    assert resp.json()["max_speed"] == 1.3
    assert resp.json()["topic"] == ""
