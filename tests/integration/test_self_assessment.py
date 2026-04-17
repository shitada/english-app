"""Integration tests for conversation self-assessment endpoints."""

import pytest
from unittest.mock import AsyncMock


async def _create_conversation(client, mock_copilot) -> int:
    """Helper: start a conversation and return its id."""
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's practise.")
    res = await client.post(
        "/api/conversation/start", json={"topic": "hotel_checkin"}
    )
    assert res.status_code == 200
    return res.json()["conversation_id"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_success(client, mock_copilot):
    """POST self-assessment saves ratings and returns them."""
    conv_id = await _create_conversation(client, mock_copilot)
    res = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={
            "confidence_rating": 4,
            "fluency_rating": 3,
            "comprehension_rating": 5,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] == conv_id
    assert data["confidence_rating"] == 4
    assert data["fluency_rating"] == 3
    assert data["comprehension_rating"] == 5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_self_assessment_success(client, mock_copilot):
    """GET self-assessment returns previously saved ratings."""
    conv_id = await _create_conversation(client, mock_copilot)
    # Save first
    await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={
            "confidence_rating": 2,
            "fluency_rating": 4,
            "comprehension_rating": 3,
        },
    )
    # Retrieve
    res = await client.get(f"/api/conversation/{conv_id}/self-assessment")
    assert res.status_code == 200
    data = res.json()
    assert data["confidence_rating"] == 2
    assert data["fluency_rating"] == 4
    assert data["comprehension_rating"] == 3
    assert "created_at" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_self_assessment_not_found(client, mock_copilot):
    """GET self-assessment returns 404 when no assessment exists."""
    conv_id = await _create_conversation(client, mock_copilot)
    res = await client.get(f"/api/conversation/{conv_id}/self-assessment")
    assert res.status_code == 404


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_conversation_not_found(client):
    """POST self-assessment returns 404 for non-existent conversation."""
    res = await client.post(
        "/api/conversation/99999/self-assessment",
        json={
            "confidence_rating": 3,
            "fluency_rating": 3,
            "comprehension_rating": 3,
        },
    )
    assert res.status_code == 404


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_validation_errors(client, mock_copilot):
    """POST self-assessment rejects ratings outside 1-5 range."""
    conv_id = await _create_conversation(client, mock_copilot)
    # Rating too high
    res = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={
            "confidence_rating": 6,
            "fluency_rating": 3,
            "comprehension_rating": 3,
        },
    )
    assert res.status_code == 422

    # Rating too low
    res = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={
            "confidence_rating": 0,
            "fluency_rating": 3,
            "comprehension_rating": 3,
        },
    )
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_self_assessment_update(client, mock_copilot):
    """POST self-assessment overwrites a previous assessment (INSERT OR REPLACE)."""
    conv_id = await _create_conversation(client, mock_copilot)

    # First save
    await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={
            "confidence_rating": 2,
            "fluency_rating": 2,
            "comprehension_rating": 2,
        },
    )

    # Update
    res = await client.post(
        f"/api/conversation/{conv_id}/self-assessment",
        json={
            "confidence_rating": 5,
            "fluency_rating": 4,
            "comprehension_rating": 3,
        },
    )
    assert res.status_code == 200

    # Verify update took effect
    get_res = await client.get(f"/api/conversation/{conv_id}/self-assessment")
    assert get_res.status_code == 200
    data = get_res.json()
    assert data["confidence_rating"] == 5
    assert data["fluency_rating"] == 4
    assert data["comprehension_rating"] == 3
