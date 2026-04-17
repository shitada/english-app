"""Integration tests for predict-next API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_predict_next_setup_default_difficulty(client, mock_copilot):
    """GET /api/pronunciation/predict-next returns setup with default difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "setup_text": "The detective examined the broken window carefully. There were muddy footprints leading away from the house.",
        "continuation": "He followed the trail of footprints into the garden and found the stolen painting hidden behind a bush.",
        "context_hint": "Think about what the detective might do next.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/predict-next")
    assert res.status_code == 200
    data = res.json()
    assert "setup_text" in data
    assert "continuation" in data
    assert "context_hint" in data
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_predict_next_setup_beginner(client, mock_copilot):
    """GET /api/pronunciation/predict-next?difficulty=beginner returns beginner setup."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "setup_text": "Tom was very hungry. He went to the kitchen.",
        "continuation": "He made a big sandwich and ate it.",
        "context_hint": "What will Tom do about his hunger?",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/predict-next?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["setup_text"] == "Tom was very hungry. He went to the kitchen."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_predict_next_setup_advanced(client, mock_copilot):
    """GET /api/pronunciation/predict-next?difficulty=advanced returns advanced setup."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "setup_text": "The CEO's resignation letter had been leaked to the press overnight. Board members were scrambling to contain the fallout as shareholders panicked.",
        "continuation": "An emergency board meeting was called, and the interim CEO was appointed within hours to stabilize the company's plummeting stock price.",
        "context_hint": "Consider the corporate and financial implications.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/predict-next?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_predict_next_setup_invalid_difficulty(client):
    """Invalid difficulty value is rejected with 422."""
    res = await client.get("/api/pronunciation/predict-next?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_predict_next_setup_fallback_on_empty_llm(client, mock_copilot):
    """When LLM returns empty/missing keys, fallback values are used."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/predict-next")
    assert res.status_code == 200
    data = res.json()
    # Fallback values are non-empty strings
    assert len(data["setup_text"]) > 0
    assert len(data["continuation"]) > 0
    assert len(data["context_hint"]) > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_predict_next_success(client, mock_copilot):
    """POST /api/pronunciation/predict-next/evaluate returns evaluation scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "plausibility_score": 8,
        "grammar_score": 7,
        "vocabulary_score": 6,
        "fluency_score": 7,
        "overall_score": 7,
        "feedback": "Your prediction was creative and plausible. Good use of future tense.",
    })
    res = await client.post("/api/pronunciation/predict-next/evaluate", json={
        "setup_text": "The detective examined the broken window carefully.",
        "continuation": "He followed the trail into the garden.",
        "user_prediction": "I think the detective will follow the footprints to find the thief.",
        "duration_seconds": 15,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["plausibility_score"] == 8
    assert data["grammar_score"] == 7
    assert data["vocabulary_score"] == 6
    assert data["fluency_score"] == 7
    assert data["overall_score"] == 7
    assert data["feedback"] == "Your prediction was creative and plausible. Good use of future tense."
    assert data["actual_continuation"] == "He followed the trail into the garden."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_predict_next_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "plausibility_score": 15,
        "grammar_score": -2,
        "vocabulary_score": "abc",
        "fluency_score": 0,
        "overall_score": 12,
        "feedback": "Some feedback.",
    })
    res = await client.post("/api/pronunciation/predict-next/evaluate", json={
        "setup_text": "It was a dark night.",
        "continuation": "A loud noise echoed.",
        "user_prediction": "Something scary happens.",
        "duration_seconds": 5,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["plausibility_score"] == 10  # clamped from 15
    assert data["grammar_score"] == 1        # clamped from -2
    assert data["vocabulary_score"] == 5.0   # fallback for non-numeric
    assert data["fluency_score"] == 1        # clamped from 0
    assert data["overall_score"] == 10       # clamped from 12


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_predict_next_empty_prediction(client):
    """Empty user_prediction is rejected with 422."""
    res = await client.post("/api/pronunciation/predict-next/evaluate", json={
        "setup_text": "The detective examined the window.",
        "continuation": "He found a clue.",
        "user_prediction": "",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_predict_next_missing_fields(client):
    """Missing required fields are rejected with 422."""
    res = await client.post("/api/pronunciation/predict-next/evaluate", json={
        "setup_text": "The detective examined the window.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_predict_next_returns_actual_continuation(client, mock_copilot):
    """The response includes the actual continuation from the request body."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "plausibility_score": 6,
        "grammar_score": 6,
        "vocabulary_score": 6,
        "fluency_score": 6,
        "overall_score": 6,
        "feedback": "Decent prediction.",
    })
    continuation_text = "The cat jumped onto the table and knocked over the vase."
    res = await client.post("/api/pronunciation/predict-next/evaluate", json={
        "setup_text": "The cat was eyeing something on the table.",
        "continuation": continuation_text,
        "user_prediction": "The cat will jump on the table.",
        "duration_seconds": 8,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["actual_continuation"] == continuation_text
