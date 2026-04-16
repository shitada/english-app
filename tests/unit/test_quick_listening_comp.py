"""Unit tests for Quick Listening Comprehension endpoint."""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.unit
@pytest.mark.asyncio
async def test_quick_listening_comp_success(client, mock_copilot):
    """Quick listening comp generates passage with question and options."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "Sarah woke up early to catch the 7 AM train. She grabbed her coffee and rushed to the station.",
        "question": "Why did Sarah wake up early?",
        "options": [
            "To go for a run",
            "To catch the 7 AM train",
            "To make breakfast",
            "To walk the dog",
        ],
        "correct_index": 1,
        "explanation": "The passage states Sarah woke up early to catch the 7 AM train.",
    })
    res = await client.get("/api/pronunciation/quick-listening-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert "passage" in data
    assert "question" in data
    assert "options" in data
    assert len(data["options"]) == 4
    assert "correct_index" in data
    assert 0 <= data["correct_index"] <= 3
    assert "explanation" in data
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_quick_listening_comp_pads_options(client, mock_copilot):
    """Options are padded to 4 if LLM returns fewer."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "It rained all day.",
        "question": "What was the weather?",
        "options": ["Rainy", "Sunny"],
        "correct_index": 0,
        "explanation": "It rained.",
    })
    res = await client.get("/api/pronunciation/quick-listening-comp")
    assert res.status_code == 200
    data = res.json()
    assert len(data["options"]) == 4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_quick_listening_comp_clamps_correct_index(client, mock_copilot):
    """correct_index is clamped to 0-3 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "Test passage.",
        "question": "Test?",
        "options": ["A", "B", "C", "D"],
        "correct_index": 99,
        "explanation": "Test.",
    })
    res = await client.get("/api/pronunciation/quick-listening-comp")
    assert res.status_code == 200
    data = res.json()
    assert data["correct_index"] == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_quick_listening_comp_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/quick-listening-comp?difficulty=expert")
    assert res.status_code == 422
