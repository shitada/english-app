"""Unit tests for the Tongue Twister endpoint."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tongue_twister_success(client, mock_copilot):
    """Tongue twister endpoint returns expected fields."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "text": "She sells seashells by the seashore.",
        "target_sounds": ["sh", "s"],
        "slow_hint": "She sells — seashells — by the seashore",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/tongue-twister?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["text"] == "She sells seashells by the seashore."
    assert data["target_sounds"] == ["sh", "s"]
    assert data["slow_hint"] == "She sells — seashells — by the seashore"
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tongue_twister_beginner(client, mock_copilot):
    """Tongue twister endpoint accepts beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "text": "Big blue bugs bleed blue blood.",
        "target_sounds": ["b", "bl"],
        "slow_hint": "Big blue bugs — bleed blue blood",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/tongue-twister?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert "text" in data
    assert isinstance(data["target_sounds"], list)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tongue_twister_advanced(client, mock_copilot):
    """Tongue twister endpoint accepts advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "text": "The sixth sick sheikh's sixth sheep's sick.",
        "target_sounds": ["s", "sh", "th"],
        "slow_hint": "The sixth — sick sheikh's — sixth sheep's — sick",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/tongue-twister?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert len(data["target_sounds"]) == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tongue_twister_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/tongue-twister?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tongue_twister_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "text": "Peter Piper picked a peck of pickled peppers.",
        "target_sounds": ["p"],
        "slow_hint": "Peter Piper — picked a peck — of pickled peppers",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/tongue-twister")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tongue_twister_truncates_target_sounds(client, mock_copilot):
    """target_sounds is limited to at most 5 entries."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "text": "A test twister.",
        "target_sounds": ["a", "b", "c", "d", "e", "f", "g"],
        "slow_hint": "A test — twister",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/tongue-twister")
    assert res.status_code == 200
    data = res.json()
    assert len(data["target_sounds"]) == 5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tongue_twister_handles_missing_fields(client, mock_copilot):
    """Endpoint provides defaults when LLM returns incomplete JSON."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/tongue-twister")
    assert res.status_code == 200
    data = res.json()
    assert "text" in data
    assert data["text"] != ""
    assert isinstance(data["target_sounds"], list)
    assert data["difficulty"] == "intermediate"
