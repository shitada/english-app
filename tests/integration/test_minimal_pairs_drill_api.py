"""Integration tests for the Minimal Pairs drill API (/api/minimal-pairs/*)."""

from __future__ import annotations

import pytest

from app.routers import minimal_pairs as mp_router


@pytest.fixture(autouse=True)
def _reset_streak():
    mp_router._reset_streak_for_tests()
    yield
    mp_router._reset_streak_for_tests()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_default(client):
    res = await client.get("/api/minimal-pairs/session")
    assert res.status_code == 200
    data = res.json()
    assert data["contrast"] is None
    assert isinstance(data["items"], list)
    assert 1 <= len(data["items"]) <= 8
    item = data["items"][0]
    for key in ("item_id", "contrast", "word_a", "word_b", "example_a",
                "example_b", "target", "target_word"):
        assert key in item
    assert item["target"] in ("a", "b")
    expected = item["word_a"] if item["target"] == "a" else item["word_b"]
    assert item["target_word"] == expected


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_filter_by_contrast(client):
    res = await client.get(
        "/api/minimal-pairs/session",
        params={"contrast": "L_vs_R", "count": 3},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["contrast"] == "L_vs_R"
    assert len(data["items"]) == 3
    assert all(it["contrast"] == "L_vs_R" for it in data["items"])


@pytest.mark.integration
@pytest.mark.asyncio
async def test_session_unknown_contrast_returns_400(client):
    res = await client.get("/api/minimal-pairs/session", params={"contrast": "NOPE"})
    assert res.status_code == 400


@pytest.mark.integration
@pytest.mark.asyncio
async def test_answer_correct_increments_streak(client):
    # Pick a known item from the curated bank
    payload = {
        "item_id": "iy-ih-01",
        "contrast": "IY_vs_IH",
        "target": "a",
        "chosen": "a",
    }
    r1 = await client.post("/api/minimal-pairs/answer", json=payload)
    assert r1.status_code == 200, r1.text
    assert r1.json() == {"correct": True, "streak": 1}

    r2 = await client.post("/api/minimal-pairs/answer", json=payload)
    assert r2.json() == {"correct": True, "streak": 2}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_answer_incorrect_resets_streak(client):
    ok_payload = {"item_id": "l-r-01", "contrast": "L_vs_R",
                  "target": "a", "chosen": "a"}
    bad_payload = {"item_id": "l-r-01", "contrast": "L_vs_R",
                   "target": "a", "chosen": "b"}

    await client.post("/api/minimal-pairs/answer", json=ok_payload)
    await client.post("/api/minimal-pairs/answer", json=ok_payload)
    r = await client.post("/api/minimal-pairs/answer", json=bad_payload)
    body = r.json()
    assert body["correct"] is False
    assert body["streak"] == 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_answer_unknown_item(client):
    r = await client.post("/api/minimal-pairs/answer", json={
        "item_id": "nonexistent-xyz",
        "contrast": "IY_vs_IH",
        "target": "a",
        "chosen": "a",
    })
    assert r.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_answer_contrast_mismatch(client):
    r = await client.post("/api/minimal-pairs/answer", json={
        "item_id": "iy-ih-01",
        "contrast": "L_vs_R",  # wrong contrast for this item
        "target": "a",
        "chosen": "a",
    })
    assert r.status_code == 400


@pytest.mark.integration
@pytest.mark.asyncio
async def test_stats_aggregates_recorded_attempts(client):
    # Record a mix of correct and incorrect answers
    await client.post("/api/minimal-pairs/answer", json={
        "item_id": "iy-ih-01", "contrast": "IY_vs_IH",
        "target": "a", "chosen": "a",
    })
    await client.post("/api/minimal-pairs/answer", json={
        "item_id": "iy-ih-01", "contrast": "IY_vs_IH",
        "target": "a", "chosen": "b",
    })
    await client.post("/api/minimal-pairs/answer", json={
        "item_id": "l-r-01", "contrast": "L_vs_R",
        "target": "b", "chosen": "b",
    })

    res = await client.get("/api/minimal-pairs/stats")
    assert res.status_code == 200
    data = res.json()
    assert "stats" in data and "weakest" in data
    stats = {s["contrast"]: s for s in data["stats"]}
    assert stats["IY_vs_IH"]["attempts"] == 2
    assert stats["IY_vs_IH"]["correct"] == 1
    assert stats["IY_vs_IH"]["accuracy"] == pytest.approx(0.5, abs=1e-4)
    assert stats["L_vs_R"]["attempts"] == 1
    assert stats["L_vs_R"]["correct"] == 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_contrasts_endpoint(client):
    r = await client.get("/api/minimal-pairs/contrasts")
    assert r.status_code == 200
    contrasts = r.json()["contrasts"]
    for expected in ("IY_vs_IH", "AE_vs_EH", "L_vs_R", "B_vs_V",
                     "S_vs_SH", "TH_vs_S", "N_vs_NG"):
        assert expected in contrasts
