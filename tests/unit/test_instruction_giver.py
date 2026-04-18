"""Unit tests for Instruction Giver endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_prompt_get_success(client, mock_copilot):
    """GET /instruction-prompt returns a task with hint and expected steps."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to make a cup of tea.",
        "hint": "Think about the order of actions from boiling water to serving.",
        "expected_steps": 5,
    })
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["task"] == "Explain how to make a cup of tea."
    assert data["hint"] == "Think about the order of actions from boiling water to serving."
    assert data["expected_steps"] == 5
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_prompt_get_beginner(client, mock_copilot):
    """GET /instruction-prompt with beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to brush your teeth.",
        "hint": "Start with picking up the toothbrush.",
        "expected_steps": 4,
    })
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["task"] == "Explain how to brush your teeth."


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_prompt_get_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain how to send an email.",
        "hint": "Cover opening, composing, and sending.",
        "expected_steps": 6,
    })
    res = await client.get("/api/pronunciation/instruction-prompt")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_prompt_fallback_on_empty(client, mock_copilot):
    """Falls back to defaults when LLM returns empty data."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["task"] == "Explain how to make a cup of tea."
    assert data["hint"] == "Think about the order of actions from start to finish."
    assert data["expected_steps"] == 5
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_prompt_clamps_expected_steps(client, mock_copilot):
    """expected_steps is clamped to [2, 10]."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain something complex.",
        "hint": "Break it down.",
        "expected_steps": 50,
    })
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["expected_steps"] == 10


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_prompt_invalid_expected_steps(client, mock_copilot):
    """Non-integer expected_steps falls back to 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "task": "Explain something.",
        "hint": "A hint.",
        "expected_steps": "not a number",
    })
    res = await client.get("/api/pronunciation/instruction-prompt?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["expected_steps"] == 5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_evaluate_success(client, mock_copilot):
    """POST /instruction-prompt/evaluate returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sequencing_score": 8,
        "clarity_score": 7,
        "completeness_score": 9,
        "grammar_score": 8,
        "overall_score": 8,
        "model_instructions": "1. Boil water. 2. Put tea bag in cup. 3. Pour water. 4. Wait 3 minutes. 5. Remove tea bag.",
        "feedback": "Great job! Your instructions were clear and well-ordered.",
    })
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to make a cup of tea.",
        "transcript": "First, boil some water. Then put a tea bag in a cup. Pour the hot water over the tea bag. Wait for about three minutes. Finally, remove the tea bag.",
        "duration_seconds": 25.0,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["sequencing_score"] == 8
    assert data["clarity_score"] == 7
    assert data["completeness_score"] == 9
    assert data["grammar_score"] == 8
    assert data["overall_score"] == 8
    assert "Boil water" in data["model_instructions"]
    assert "clear" in data["feedback"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sequencing_score": 15,
        "clarity_score": -3,
        "completeness_score": "invalid",
        "grammar_score": 0,
        "overall_score": 12,
        "model_instructions": "Model text",
        "feedback": "Feedback text",
    })
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to tie a shoe.",
        "transcript": "You tie the laces.",
        "duration_seconds": 10.0,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["sequencing_score"] == 10  # clamped from 15
    assert data["clarity_score"] == 1  # clamped from -3
    assert data["completeness_score"] == 5.0  # fallback for invalid
    assert data["grammar_score"] == 1  # clamped from 0
    assert data["overall_score"] == 10  # clamped from 12


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_evaluate_missing_fields_rejected(client):
    """Missing required fields are rejected."""
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to make tea.",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_evaluate_duration_too_low(client):
    """Duration below minimum is rejected."""
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to make tea.",
        "transcript": "Some transcript.",
        "duration_seconds": 0.5,
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_instruction_evaluate_empty_transcript_rejected(client):
    """Empty transcript is rejected (min_length=1)."""
    res = await client.post("/api/pronunciation/instruction-prompt/evaluate", json={
        "task": "Explain how to make tea.",
        "transcript": "",
        "duration_seconds": 10.0,
    })
    assert res.status_code == 422
