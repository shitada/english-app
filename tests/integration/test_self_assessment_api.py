"""Integration tests for conversation self-assessment API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_success(client, mock_copilot):
    """POST self-assessment returns saved ratings."""
    # Start a conversation first
    mock_copilot.ask = AsyncMock(return_value="Hello! Let's practice.")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    res = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={"confidence_rating": 4, "fluency_rating": 3, "comprehension_rating": 5},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] == conv_id
    assert data["confidence_rating"] == 4
    assert data["fluency_rating"] == 3
    assert data["comprehension_rating"] == 5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_validation_error(client, mock_copilot):
    """POST self-assessment with invalid ratings returns 422."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Rating out of range (0 < min)
    res = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={"confidence_rating": 0, "fluency_rating": 3, "comprehension_rating": 5},
    )
    assert res.status_code == 422

    # Rating out of range (> 5)
    res = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={"confidence_rating": 4, "fluency_rating": 6, "comprehension_rating": 5},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_conversation_not_found(client):
    """POST self-assessment for non-existent conversation returns 404."""
    res = await client.post(
        "/api/conversation/99999/self-assessment",
        json={"confidence_rating": 3, "fluency_rating": 3, "comprehension_rating": 3},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_duplicate_updates(client, mock_copilot):
    """POST self-assessment twice updates the existing record."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # First save
    res1 = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={"confidence_rating": 2, "fluency_rating": 2, "comprehension_rating": 2},
    )
    assert res1.status_code == 200
    assert res1.json()["confidence_rating"] == 2

    # Update with different ratings
    res2 = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={"confidence_rating": 5, "fluency_rating": 4, "comprehension_rating": 3},
    )
    assert res2.status_code == 200
    assert res2.json()["confidence_rating"] == 5
    assert res2.json()["fluency_rating"] == 4
    assert res2.json()["comprehension_rating"] == 3

    # Verify the GET returns the updated values
    res_get = await client.get(f"/api/conversation/{conv_id}/self-assessment")
    assert res_get.status_code == 200
    assert res_get.json()["confidence_rating"] == 5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_self_assessment_success(client, mock_copilot):
    """GET self-assessment returns saved data."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Save first
    await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={"confidence_rating": 3, "fluency_rating": 4, "comprehension_rating": 5},
    )

    # Retrieve
    res = await client.get(f"/api/conversation/{conv_id}/self-assessment")
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] == conv_id
    assert data["confidence_rating"] == 3
    assert data["fluency_rating"] == 4
    assert data["comprehension_rating"] == 5
    assert "created_at" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_self_assessment_not_found(client, mock_copilot):
    """GET self-assessment for conversation without one returns 404."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    res = await client.get(f"/api/conversation/{conv_id}/self-assessment")
    assert res.status_code == 404


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_self_assessment_conversation_not_found(client):
    """GET self-assessment for non-existent conversation returns 404."""
    res = await client.get("/api/conversation/99999/self-assessment")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Dashboard Self-Assessment Trend Endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.integration
async def test_self_assessment_trend_empty(client):
    """GET trend with no assessments returns empty entries and insufficient_data."""
    res = await client.get("/api/dashboard/self-assessment-trend")
    assert res.status_code == 200
    data = res.json()
    assert data["entries"] == []
    assert data["trend"] == "insufficient_data"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_self_assessment_trend_with_data(client, mock_copilot):
    """GET trend returns entries with rolling averages after creating assessments."""
    mock_copilot.ask = AsyncMock(return_value="Hello! Let's practice.")

    # Create 4 conversations with assessments
    for conf, flu, comp in [(2, 2, 2), (3, 3, 3), (4, 4, 4), (5, 5, 5)]:
        start_res = await client.post(
            "/api/conversation/start", json={"topic": "hotel_checkin"}
        )
        conv_id = start_res.json()["conversation_id"]
        await client.post(
            f"/api/conversation/{conv_id}/self-assessment",
            json={
                "confidence_rating": conf,
                "fluency_rating": flu,
                "comprehension_rating": comp,
            },
        )

    res = await client.get("/api/dashboard/self-assessment-trend")
    assert res.status_code == 200
    data = res.json()
    assert len(data["entries"]) == 4
    assert data["trend"] in ("improving", "declining", "stable")

    # Validate entry structure
    entry = data["entries"][0]
    assert "conversation_id" in entry
    assert "topic" in entry
    assert "difficulty" in entry
    assert "confidence_rating" in entry
    assert "fluency_rating" in entry
    assert "comprehension_rating" in entry
    assert "overall_rating" in entry
    assert "rolling_confidence" in entry
    assert "rolling_fluency" in entry
    assert "rolling_comprehension" in entry
    assert "rolling_overall" in entry
    assert "created_at" in entry


@pytest.mark.asyncio
@pytest.mark.integration
async def test_self_assessment_trend_limit_param(client, mock_copilot):
    """GET trend respects the limit query parameter."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")

    for rating in [3, 3, 3, 3, 3]:
        start_res = await client.post(
            "/api/conversation/start", json={"topic": "hotel_checkin"}
        )
        conv_id = start_res.json()["conversation_id"]
        await client.post(
            f"/api/conversation/{conv_id}/self-assessment",
            json={
                "confidence_rating": rating,
                "fluency_rating": rating,
                "comprehension_rating": rating,
            },
        )

    res = await client.get("/api/dashboard/self-assessment-trend?limit=2")
    assert res.status_code == 200
    data = res.json()
    assert len(data["entries"]) == 2
