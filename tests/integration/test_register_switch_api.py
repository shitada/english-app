"""Integration tests for register switch practice API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_default_difficulty(client, mock_copilot):
    """Register switch prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "You are asking your professor for a deadline extension.",
        "target_register": "formal",
        "context_hint": "Use polite, respectful language appropriate for an academic setting.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/register-switch")
    assert res.status_code == 200
    data = res.json()
    assert data["situation"] == "You are asking your professor for a deadline extension."
    assert data["target_register"] == "formal"
    assert data["context_hint"] == "Use polite, respectful language appropriate for an academic setting."
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_with_difficulty(client, mock_copilot):
    """Register switch prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Ask a friend to hang out.",
        "target_register": "casual",
        "context_hint": "Use relaxed, informal language.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/register-switch?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["target_register"] == "casual"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/register-switch?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Register switch prompt returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/register-switch")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["situation"], str) and len(data["situation"]) > 0
    assert data["target_register"] in ("formal", "neutral", "casual")
    assert isinstance(data["context_hint"], str) and len(data["context_hint"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_normalizes_invalid_register(client, mock_copilot):
    """Invalid target_register is normalized to 'neutral'."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Talk to someone.",
        "target_register": "super-formal",
        "context_hint": "Just talk normally.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/register-switch")
    assert res.status_code == 200
    data = res.json()
    assert data["target_register"] == "neutral"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_success(client, mock_copilot):
    """Register switch evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "register_accuracy_score": 8,
        "vocabulary_score": 7,
        "grammar_score": 9,
        "politeness_score": 8,
        "overall_score": 8,
        "feedback": "Great job matching the formal register!",
        "model_response": "Dear Professor, I would like to respectfully request an extension.",
    })
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask your professor for a deadline extension.",
        "target_register": "formal",
        "transcript": "Excuse me professor, may I please have more time for the assignment?",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["register_accuracy_score"] == 8
    assert data["vocabulary_score"] == 7
    assert data["grammar_score"] == 9
    assert data["politeness_score"] == 8
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great job matching the formal register!"
    assert "model_response" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "register_accuracy_score": 15,
        "vocabulary_score": -3,
        "grammar_score": 0.5,
        "politeness_score": 11,
        "overall_score": 100,
        "feedback": "Good try!",
        "model_response": "Example.",
    })
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask a friend to hang out.",
        "target_register": "casual",
        "transcript": "Hey, wanna hang out?",
        "duration_seconds": 5,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["register_accuracy_score"] == 10
    assert data["vocabulary_score"] == 1
    assert data["grammar_score"] == 1
    assert data["politeness_score"] == 10
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_validation_empty_situation(client):
    """Empty situation is rejected."""
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "",
        "target_register": "formal",
        "transcript": "Some sentence.",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_validation_empty_transcript(client):
    """Empty transcript is rejected."""
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask your professor for help.",
        "target_register": "formal",
        "transcript": "",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_validation_invalid_register(client):
    """Invalid target_register is rejected."""
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask your professor for help.",
        "target_register": "super-formal",
        "transcript": "Some sentence.",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_validation_invalid_duration(client):
    """Zero duration is rejected."""
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask your professor for help.",
        "target_register": "formal",
        "transcript": "Some sentence.",
        "duration_seconds": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "register_accuracy_score": "great",
        "vocabulary_score": None,
        "grammar_score": "very good",
        "politeness_score": "excellent",
        "overall_score": "amazing",
        "feedback": "Nice attempt!",
        "model_response": "Well done.",
    })
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Chat with a neighbor.",
        "target_register": "neutral",
        "transcript": "Hi there, how are you doing today?",
        "duration_seconds": 8,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["register_accuracy_score"] == 5.0
    assert data["vocabulary_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["politeness_score"] == 5.0
    assert data["overall_score"] == 5.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_advanced_difficulty(client, mock_copilot):
    """Register switch prompt works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Negotiate a salary raise with your direct manager.",
        "target_register": "formal",
        "context_hint": "Maintain professional composure while advocating for yourself.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/register-switch?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert data["target_register"] == "formal"
