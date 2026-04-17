"""Integration tests for spot-the-error listening drill API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_prompt_default_params(client, mock_copilot):
    """Spot-error prompt returns exercise with default difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "error_sentence": "She go to the store yesterday.",
        "correct_sentence": "She went to the store yesterday.",
        "error_type": "tense",
        "hint": "Look at the verb form.",
    })
    res = await client.get("/api/pronunciation/spot-error")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert data["error_sentence"] == "She go to the store yesterday."
    assert data["correct_sentence"] == "She went to the store yesterday."
    assert data["error_type"] == "tense"
    assert "hint" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_prompt_with_difficulty(client, mock_copilot):
    """Spot-error prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "error_sentence": "I saw a elephant at the zoo.",
        "correct_sentence": "I saw an elephant at the zoo.",
        "error_type": "article",
        "hint": "Check the article before the noun.",
    })
    res = await client.get("/api/pronunciation/spot-error?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["error_sentence"] == "I saw a elephant at the zoo."
    assert data["correct_sentence"] == "I saw an elephant at the zoo."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/spot-error?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_prompt_fallback_on_empty_llm(client, mock_copilot):
    """Empty LLM response returns fallback values."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/spot-error")
    assert res.status_code == 200
    data = res.json()
    assert len(data["error_sentence"]) > 0
    assert len(data["correct_sentence"]) > 0
    assert len(data["error_type"]) > 0
    assert len(data["hint"]) > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_evaluate_success(client, mock_copilot):
    """Evaluate endpoint returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "correction_accuracy_score": 9,
        "grammar_score": 8,
        "naturalness_score": 8,
        "overall_score": 8,
        "feedback": "Excellent! You correctly identified and fixed the tense error.",
        "model_correction": "She went to the store yesterday.",
    })
    res = await client.post("/api/pronunciation/spot-error/evaluate", json={
        "error_sentence": "She go to the store yesterday.",
        "correct_sentence": "She went to the store yesterday.",
        "user_correction": "She went to the store yesterday.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["correction_accuracy_score"] == 9
    assert data["grammar_score"] == 8
    assert data["naturalness_score"] == 8
    assert data["overall_score"] == 8
    assert len(data["feedback"]) > 0
    assert data["model_correction"] == "She went to the store yesterday."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "correction_accuracy_score": 15,
        "grammar_score": -2,
        "naturalness_score": "invalid",
        "overall_score": 0,
        "feedback": "Some feedback.",
        "model_correction": "Corrected sentence.",
    })
    res = await client.post("/api/pronunciation/spot-error/evaluate", json={
        "error_sentence": "She go to the store.",
        "correct_sentence": "She went to the store.",
        "user_correction": "She went to the store.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["correction_accuracy_score"] == 10  # clamped from 15
    assert data["grammar_score"] == 1  # clamped from -2
    assert data["naturalness_score"] == 5.0  # fallback for invalid
    assert data["overall_score"] == 1  # clamped from 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_evaluate_empty_fields_rejected(client):
    """Empty required fields are rejected with 422."""
    res = await client.post("/api/pronunciation/spot-error/evaluate", json={
        "error_sentence": "",
        "correct_sentence": "She went to the store.",
        "user_correction": "She went to the store.",
    })
    assert res.status_code == 422

    res2 = await client.post("/api/pronunciation/spot-error/evaluate", json={
        "error_sentence": "She go to the store.",
        "correct_sentence": "She went to the store.",
        "user_correction": "",
    })
    assert res2.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_spot_error_evaluate_fallback_model_correction(client, mock_copilot):
    """When LLM omits model_correction, the correct_sentence is used as fallback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "correction_accuracy_score": 7,
        "grammar_score": 7,
        "naturalness_score": 7,
        "overall_score": 7,
        "feedback": "Good job!",
    })
    res = await client.post("/api/pronunciation/spot-error/evaluate", json={
        "error_sentence": "There are many child in the park.",
        "correct_sentence": "There are many children in the park.",
        "user_correction": "There are many children in the park.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["model_correction"] == "There are many children in the park."
