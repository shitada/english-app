"""Integration tests for filler drill prompt API endpoint."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_filler_drill_prompt_default_difficulty(client, mock_copilot):
    """Filler drill prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "question": "Describe a time when you had to explain something complex to someone.",
        "tip": "Pause silently instead of saying 'um' or 'uh'.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/filler-drill-prompt")
    assert res.status_code == 200
    data = res.json()
    assert data["question"] == "Describe a time when you had to explain something complex to someone."
    assert data["tip"] == "Pause silently instead of saying 'um' or 'uh'."
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_filler_drill_prompt_with_beginner_difficulty(client, mock_copilot):
    """Filler drill prompt respects beginner difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "question": "What is your favorite hobby and why?",
        "tip": "Take a breath before each new sentence.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/filler-drill-prompt?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["question"] == "What is your favorite hobby and why?"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_filler_drill_prompt_with_advanced_difficulty(client, mock_copilot):
    """Filler drill prompt works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "question": "How should governments balance economic growth with environmental sustainability?",
        "tip": "Structure your response with clear topic sentences to avoid fillers.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/filler-drill-prompt?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_filler_drill_prompt_invalid_difficulty(client):
    """Invalid difficulty returns 422."""
    res = await client.get("/api/pronunciation/filler-drill-prompt?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_filler_drill_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Missing keys in LLM response use fallback values."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/filler-drill-prompt")
    assert res.status_code == 200
    data = res.json()
    # Falls back to defaults
    assert "question" in data
    assert len(data["question"]) > 0
    assert "tip" in data
    assert len(data["tip"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_filler_drill_prompt_llm_failure(client, mock_copilot):
    """LLM failure returns 502."""
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM unavailable"))
    res = await client.get("/api/pronunciation/filler-drill-prompt")
    assert res.status_code == 502
