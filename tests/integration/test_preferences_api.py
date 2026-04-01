"""Integration tests for the preferences API endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.integration
async def test_get_preferences_empty(client):
    res = await client.get("/api/preferences")
    assert res.status_code == 200
    assert res.json()["preferences"] == {}


@pytest.mark.integration
async def test_set_and_get_preference(client):
    res = await client.put("/api/preferences/theme", json={"value": "dark"})
    assert res.status_code == 200
    assert res.json() == {"key": "theme", "value": "dark"}
    res = await client.get("/api/preferences")
    assert res.json()["preferences"]["theme"] == "dark"


@pytest.mark.integration
async def test_upsert_preference(client):
    await client.put("/api/preferences/theme", json={"value": "light"})
    res = await client.put("/api/preferences/theme", json={"value": "dark"})
    assert res.status_code == 200
    assert res.json()["value"] == "dark"


@pytest.mark.integration
async def test_batch_set_preferences(client):
    res = await client.put(
        "/api/preferences",
        json={"preferences": {"difficulty": "advanced", "quiz_count": "10"}},
    )
    assert res.status_code == 200
    assert res.json()["preferences"]["difficulty"] == "advanced"


@pytest.mark.integration
async def test_delete_preference(client):
    await client.put("/api/preferences/theme", json={"value": "dark"})
    res = await client.delete("/api/preferences/theme")
    assert res.status_code == 200
    assert res.json()["deleted"] is True


@pytest.mark.integration
async def test_delete_nonexistent_preference(client):
    res = await client.delete("/api/preferences/nonexistent")
    assert res.status_code == 404


@pytest.mark.integration
async def test_invalid_key_format(client):
    res = await client.put("/api/preferences/A", json={"value": "x"})
    assert res.status_code == 422


@pytest.mark.integration
async def test_empty_value_rejected(client):
    res = await client.put("/api/preferences/theme", json={"value": ""})
    assert res.status_code == 422
