"""Integration tests for idiom prompt API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_prompt_default_difficulty(client, mock_copilot):
    """Idiom prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "idiom": "break the ice",
        "meaning": "To initiate conversation in a social setting.",
        "example_sentence": "She told a joke to break the ice at the meeting.",
        "situation_prompt": "Imagine you are at a party. Use this idiom.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/idiom-prompt")
    assert res.status_code == 200
    data = res.json()
    assert data["idiom"] == "break the ice"
    assert data["meaning"] == "To initiate conversation in a social setting."
    assert data["example_sentence"] == "She told a joke to break the ice at the meeting."
    assert data["situation_prompt"] == "Imagine you are at a party. Use this idiom."
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_prompt_with_difficulty(client, mock_copilot):
    """Idiom prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "idiom": "a piece of cake",
        "meaning": "Something very easy.",
        "example_sentence": "The test was a piece of cake.",
        "situation_prompt": "Describe something easy you did recently.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/idiom-prompt?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["idiom"] == "a piece of cake"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/idiom-prompt?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Idiom prompt returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/idiom-prompt")
    assert res.status_code == 200
    data = res.json()
    # Should have fallback values
    assert isinstance(data["idiom"], str) and len(data["idiom"]) > 0
    assert isinstance(data["meaning"], str) and len(data["meaning"]) > 0
    assert isinstance(data["example_sentence"], str)
    assert isinstance(data["situation_prompt"], str)
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_evaluate_success(client, mock_copilot):
    """Idiom evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "idiom_usage_score": 8,
        "grammar_score": 7,
        "naturalness_score": 9,
        "overall_score": 8,
        "feedback": "Great job using the idiom naturally!",
        "model_sentence": "I decided to break the ice by introducing myself first.",
    })
    res = await client.post("/api/pronunciation/idiom-prompt/evaluate", json={
        "idiom": "break the ice",
        "transcript": "I tried to break the ice by telling everyone a funny story.",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["idiom_usage_score"] == 8
    assert data["grammar_score"] == 7
    assert data["naturalness_score"] == 9
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great job using the idiom naturally!"
    assert "model_sentence" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "idiom_usage_score": 15,
        "grammar_score": -3,
        "naturalness_score": 0.5,
        "overall_score": 11,
        "feedback": "Good try!",
        "model_sentence": "Example sentence.",
    })
    res = await client.post("/api/pronunciation/idiom-prompt/evaluate", json={
        "idiom": "break the ice",
        "transcript": "I tried to break the ice.",
        "duration_seconds": 5,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["idiom_usage_score"] == 10
    assert data["grammar_score"] == 1
    assert data["naturalness_score"] == 1
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_evaluate_validation_empty_idiom(client):
    """Empty idiom is rejected."""
    res = await client.post("/api/pronunciation/idiom-prompt/evaluate", json={
        "idiom": "",
        "transcript": "Some sentence.",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_evaluate_validation_empty_transcript(client):
    """Empty transcript is rejected."""
    res = await client.post("/api/pronunciation/idiom-prompt/evaluate", json={
        "idiom": "break the ice",
        "transcript": "",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_evaluate_validation_invalid_duration(client):
    """Zero duration is rejected."""
    res = await client.post("/api/pronunciation/idiom-prompt/evaluate", json={
        "idiom": "break the ice",
        "transcript": "I broke the ice.",
        "duration_seconds": 0,
    })
    assert res.status_code == 422
