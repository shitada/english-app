"""Integration tests for phrasal verb practice API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_prompt_default_difficulty(client, mock_copilot):
    """Phrasal verb prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrasal_verb": "put off",
        "meaning": "To postpone or delay something.",
        "example_sentence": "I decided to put off the meeting until next week.",
        "situation_prompt": "Describe a time when you had to delay doing something.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/phrasal-verb")
    assert res.status_code == 200
    data = res.json()
    assert data["phrasal_verb"] == "put off"
    assert data["meaning"] == "To postpone or delay something."
    assert data["example_sentence"] == "I decided to put off the meeting until next week."
    assert data["situation_prompt"] == "Describe a time when you had to delay doing something."
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_prompt_with_difficulty(client, mock_copilot):
    """Phrasal verb prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrasal_verb": "give up",
        "meaning": "To stop trying.",
        "example_sentence": "Don't give up on your dreams.",
        "situation_prompt": "Talk about something you almost gave up on.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/phrasal-verb?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["phrasal_verb"] == "give up"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/phrasal-verb?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Phrasal verb prompt returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/phrasal-verb")
    assert res.status_code == 200
    data = res.json()
    # Should have fallback values
    assert isinstance(data["phrasal_verb"], str) and len(data["phrasal_verb"]) > 0
    assert isinstance(data["meaning"], str) and len(data["meaning"]) > 0
    assert isinstance(data["example_sentence"], str)
    assert isinstance(data["situation_prompt"], str)
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_evaluate_success(client, mock_copilot):
    """Phrasal verb evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrasal_verb_accuracy_score": 8,
        "grammar_score": 7,
        "naturalness_score": 9,
        "overall_score": 8,
        "feedback": "Great job using the phrasal verb naturally!",
        "model_sentence": "I decided to put off the meeting until next week.",
    })
    res = await client.post("/api/pronunciation/phrasal-verb/evaluate", json={
        "phrasal_verb": "put off",
        "transcript": "I had to put off my dentist appointment because I was busy.",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["phrasal_verb_accuracy_score"] == 8
    assert data["grammar_score"] == 7
    assert data["naturalness_score"] == 9
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great job using the phrasal verb naturally!"
    assert "model_sentence" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrasal_verb_accuracy_score": 15,
        "grammar_score": -3,
        "naturalness_score": 0.5,
        "overall_score": 11,
        "feedback": "Good try!",
        "model_sentence": "Example sentence.",
    })
    res = await client.post("/api/pronunciation/phrasal-verb/evaluate", json={
        "phrasal_verb": "put off",
        "transcript": "I put off my work.",
        "duration_seconds": 5,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["phrasal_verb_accuracy_score"] == 10
    assert data["grammar_score"] == 1
    assert data["naturalness_score"] == 1
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_evaluate_validation_empty_phrasal_verb(client):
    """Empty phrasal verb is rejected."""
    res = await client.post("/api/pronunciation/phrasal-verb/evaluate", json={
        "phrasal_verb": "",
        "transcript": "Some sentence.",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_evaluate_validation_empty_transcript(client):
    """Empty transcript is rejected."""
    res = await client.post("/api/pronunciation/phrasal-verb/evaluate", json={
        "phrasal_verb": "put off",
        "transcript": "",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_evaluate_validation_invalid_duration(client):
    """Zero duration is rejected."""
    res = await client.post("/api/pronunciation/phrasal-verb/evaluate", json={
        "phrasal_verb": "put off",
        "transcript": "I put off my work.",
        "duration_seconds": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_prompt_advanced_difficulty(client, mock_copilot):
    """Phrasal verb prompt works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrasal_verb": "get around to",
        "meaning": "To finally do something after a delay.",
        "example_sentence": "I never got around to reading that book.",
        "situation_prompt": "Describe something you've been meaning to do but haven't done yet.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/phrasal-verb?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert data["phrasal_verb"] == "get around to"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_phrasal_verb_evaluate_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrasal_verb_accuracy_score": "great",
        "grammar_score": None,
        "naturalness_score": "very good",
        "overall_score": "excellent",
        "feedback": "Nice attempt!",
        "model_sentence": "She looked into the issue carefully.",
    })
    res = await client.post("/api/pronunciation/phrasal-verb/evaluate", json={
        "phrasal_verb": "look into",
        "transcript": "I will look into it tomorrow.",
        "duration_seconds": 8,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["phrasal_verb_accuracy_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["naturalness_score"] == 5.0
    assert data["overall_score"] == 5.0
