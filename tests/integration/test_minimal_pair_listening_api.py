"""Integration tests for /api/listening/minimal-pair endpoints."""

import pytest


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_minimal_pair_returns_rounds(client):
    res = await client.post("/api/listening/minimal-pair/start?rounds=5")
    assert res.status_code == 200
    data = res.json()
    assert "contrast" in data
    assert isinstance(data["contrast"], str) and data["contrast"]
    assert isinstance(data["rounds"], list)
    assert len(data["rounds"]) == 5
    for r in data["rounds"]:
        assert r["word_a"] and r["word_b"]
        assert r["ipa_a"] and r["ipa_b"]
        assert r["contrast"] == data["contrast"]
        assert r["play"] in ("a", "b")


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_minimal_pair_clamps_rounds(client):
    res = await client.post("/api/listening/minimal-pair/start?rounds=999")
    assert res.status_code == 200
    data = res.json()
    assert len(data["rounds"]) <= 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_result_persists_session(client):
    payload = {
        "correct": 4,
        "total": 5,
        "contrast_summary": [
            {"contrast": "/i/-/iː/", "correct": 2, "total": 3},
            {"contrast": "/l/-/r/", "correct": 2, "total": 2},
        ],
    }
    res = await client.post("/api/listening/minimal-pair/result", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["id"] > 0
    assert data["correct"] == 4
    assert data["total"] == 5

    # Verify it shows up in history
    h = await client.get("/api/listening/minimal-pair/history")
    assert h.status_code == 200
    sessions = h.json()["sessions"]
    assert len(sessions) >= 1
    latest = sessions[0]
    assert latest["correct"] == 4
    assert latest["total"] == 5
    assert "/i/-/iː/" in latest["contrast_summary"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_result_validation_correct_exceeds_total(client):
    res = await client.post(
        "/api/listening/minimal-pair/result",
        json={"correct": 10, "total": 5, "contrast_summary": []},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_result_empty_summary_ok(client):
    res = await client.post(
        "/api/listening/minimal-pair/result",
        json={"correct": 0, "total": 0, "contrast_summary": []},
    )
    assert res.status_code == 200
