"""Integration tests for instruction giver practice API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_prompt_default_difficulty(client, mock_copilot):
    """Instruction prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to make a cup of tea.",
        "hint": "Use sequencing words like first, next, then, and finally.",
        "expected_steps": 5,
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/instruction-prompt")
    assert res.status_code == 200
    data = res.json()
    assert data["task"] == "Explain how to make a cup of tea."
    assert data["hint"] == "Use sequencing words like first, next, then, and finally."
    assert data["expected_steps"] == 5
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_prompt_with_difficulty(client, mock_copilot):
    """Instruction prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to brush your teeth.",
        "hint": "Keep it simple and use first, then, finally.",
        "expected_steps": 3,
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["task"] == "Explain how to brush your teeth."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_prompt_advanced_difficulty(client, mock_copilot):
    """Instruction prompt works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to set up a virtual private network on a corporate device.",
        "hint": "Use sophisticated sequencing language and technical vocabulary.",
        "expected_steps": 7,
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Instruction prompt returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/instruction-prompt")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["task"], str) and len(data["task"]) > 0
    assert isinstance(data["hint"], str) and len(data["hint"]) > 0
    assert isinstance(data["expected_steps"], int) and data["expected_steps"] >= 2
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_prompt_non_numeric_expected_steps_fallback(client, mock_copilot):
    """Non-numeric expected_steps falls back to 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to cook rice.",
        "hint": "Use first, then, finally.",
        "expected_steps": "many",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/instruction-prompt")
    assert res.status_code == 200
    data = res.json()
    assert data["expected_steps"] == 5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_prompt_expected_steps_clamped(client, mock_copilot):
    """expected_steps is clamped to 2-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to open a door.",
        "hint": "Simple steps.",
        "expected_steps": 0,
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/instruction-prompt")
    assert res.status_code == 200
    data = res.json()
    assert data["expected_steps"] == 2


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_evaluate_success(client, mock_copilot):
    """Instruction evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sequencing_score": 8,
        "clarity_score": 9,
        "completeness_score": 7,
        "grammar_score": 8,
        "overall_score": 8,
        "feedback": "Great use of sequencing language! Your instructions were clear and easy to follow.",
        "model_instructions": "First, boil some water. Next, place a tea bag in a cup. Then, pour the hot water over the tea bag. Finally, let it steep for 3-5 minutes and enjoy.",
    })
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to make a cup of tea.",
        "transcript": "First you need to boil water. Then put a tea bag in the cup. Next pour the water. Finally wait a few minutes.",
        "duration_seconds": 25,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["sequencing_score"] == 8
    assert data["clarity_score"] == 9
    assert data["completeness_score"] == 7
    assert data["grammar_score"] == 8
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great use of sequencing language! Your instructions were clear and easy to follow."
    assert "First, boil some water" in data["model_instructions"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sequencing_score": 15,
        "clarity_score": -2,
        "completeness_score": 0,
        "grammar_score": 100,
        "overall_score": 11,
        "feedback": "Good try!",
        "model_instructions": "Step one: do this.",
    })
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to tie shoes.",
        "transcript": "You take the laces and tie them.",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["sequencing_score"] == 10
    assert data["clarity_score"] == 1
    assert data["completeness_score"] == 1
    assert data["grammar_score"] == 10
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_evaluate_validation_empty_task(client):
    """Empty task is rejected."""
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "",
        "transcript": "First do this then do that.",
        "duration_seconds": 10,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_evaluate_validation_empty_transcript(client):
    """Empty transcript is rejected."""
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to make a sandwich.",
        "transcript": "",
        "duration_seconds": 10,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_evaluate_validation_invalid_duration(client):
    """Zero duration is rejected."""
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to make a sandwich.",
        "transcript": "First get bread then add cheese.",
        "duration_seconds": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_instruction_evaluate_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sequencing_score": "great",
        "clarity_score": None,
        "completeness_score": "excellent",
        "grammar_score": "good",
        "overall_score": "impressive",
        "feedback": "Nice work!",
        "model_instructions": "Example instructions.",
    })
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to wash dishes.",
        "transcript": "First rinse the dishes then use soap then rinse again.",
        "duration_seconds": 15,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["sequencing_score"] == 5.0
    assert data["clarity_score"] == 5.0
    assert data["completeness_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["overall_score"] == 5.0
