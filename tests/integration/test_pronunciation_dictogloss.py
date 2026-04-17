"""Integration tests for dictogloss API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_dictogloss_passage_default_difficulty(client, mock_copilot):
    """GET /api/pronunciation/dictogloss returns passage with default difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "title": "A Morning Walk",
        "passage_text": "The sun rose slowly over the hills. Birds began to sing in the trees. A gentle breeze carried the scent of flowers.",
        "topic": "Nature",
        "difficulty": "intermediate",
        "sentence_count": 3,
    })
    res = await client.get("/api/pronunciation/dictogloss")
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "A Morning Walk"
    assert data["passage_text"] == "The sun rose slowly over the hills. Birds began to sing in the trees. A gentle breeze carried the scent of flowers."
    assert data["topic"] == "Nature"
    assert data["difficulty"] == "intermediate"
    assert data["sentence_count"] == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_dictogloss_passage_beginner(client, mock_copilot):
    """GET /api/pronunciation/dictogloss?difficulty=beginner returns beginner passage."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "title": "My Cat",
        "passage_text": "I have a cat. She likes to sleep. She is very soft.",
        "topic": "Pets",
        "difficulty": "beginner",
        "sentence_count": 3,
    })
    res = await client.get("/api/pronunciation/dictogloss?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["title"] == "My Cat"
    assert data["sentence_count"] == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_dictogloss_passage_advanced(client, mock_copilot):
    """GET /api/pronunciation/dictogloss?difficulty=advanced returns advanced passage."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "title": "Economic Implications",
        "passage_text": "The global economy faces unprecedented challenges in the wake of technological disruption. Traditional industries must adapt or risk obsolescence. Innovation hubs are emerging in unexpected regions. The redistribution of economic power is reshaping geopolitics.",
        "topic": "Economics",
        "difficulty": "advanced",
        "sentence_count": 4,
    })
    res = await client.get("/api/pronunciation/dictogloss?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert data["sentence_count"] == 4


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_dictogloss_passage_invalid_difficulty(client):
    """Invalid difficulty value is rejected with 422."""
    res = await client.get("/api/pronunciation/dictogloss?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_dictogloss_passage_fallback_on_empty_llm(client, mock_copilot):
    """When LLM returns empty/missing keys, fallback values are used."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/dictogloss")
    assert res.status_code == 200
    data = res.json()
    assert len(data["title"]) > 0
    assert len(data["passage_text"]) > 0
    assert len(data["topic"]) > 0
    assert data["difficulty"] == "intermediate"
    assert isinstance(data["sentence_count"], int)
    assert data["sentence_count"] == 3  # fallback for intermediate


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_dictogloss_passage_fallback_sentence_count_non_numeric(client, mock_copilot):
    """Non-numeric sentence_count falls back to default for difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "title": "Test",
        "passage_text": "A test passage.",
        "topic": "Test",
        "difficulty": "beginner",
        "sentence_count": "three",
    })
    res = await client.get("/api/pronunciation/dictogloss?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["sentence_count"] == 3  # fallback for beginner


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_success(client, mock_copilot):
    """POST /api/pronunciation/dictogloss/evaluate returns evaluation scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage_score": 8,
        "grammar_score": 7,
        "vocabulary_score": 6,
        "reconstruction_quality_score": 7,
        "overall_score": 7,
        "feedback": "Good reconstruction! You captured the main ideas well.",
        "model_reconstruction": "The sun rose over the hills while birds sang in the trees. A gentle breeze brought the scent of flowers.",
    })
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "The sun rose slowly over the hills. Birds began to sing in the trees. A gentle breeze carried the scent of flowers.",
        "user_reconstruction": "The sun came up over the hills. Birds were singing. There was a breeze with flower scent.",
        "replay_used": False,
        "duration_seconds": 25,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["content_coverage_score"] == 8
    assert data["grammar_score"] == 7
    assert data["vocabulary_score"] == 6
    assert data["reconstruction_quality_score"] == 7
    assert data["overall_score"] == 7
    assert data["feedback"] == "Good reconstruction! You captured the main ideas well."
    assert "model_reconstruction" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_with_replay(client, mock_copilot):
    """Evaluation works correctly when replay was used."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage_score": 9,
        "grammar_score": 8,
        "vocabulary_score": 8,
        "reconstruction_quality_score": 8,
        "overall_score": 8,
        "feedback": "Excellent reconstruction!",
        "model_reconstruction": "Model text here.",
    })
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "Original passage text here.",
        "user_reconstruction": "My reconstruction of the passage.",
        "replay_used": True,
        "duration_seconds": 30,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 8


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage_score": 15,
        "grammar_score": -2,
        "vocabulary_score": "abc",
        "reconstruction_quality_score": 0,
        "overall_score": 12,
        "feedback": "Some feedback.",
        "model_reconstruction": "Model text.",
    })
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "A short passage.",
        "user_reconstruction": "My attempt at reconstruction.",
        "replay_used": False,
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["content_coverage_score"] == 10  # clamped from 15
    assert data["grammar_score"] == 1            # clamped from -2
    assert data["vocabulary_score"] == 5.0       # fallback for non-numeric
    assert data["reconstruction_quality_score"] == 1  # clamped from 0
    assert data["overall_score"] == 10           # clamped from 12


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_empty_reconstruction(client):
    """Empty user_reconstruction is rejected with 422."""
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "A short passage.",
        "user_reconstruction": "",
        "replay_used": False,
        "duration_seconds": 10,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_empty_passage(client):
    """Empty passage_text is rejected with 422."""
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "",
        "user_reconstruction": "My reconstruction.",
        "replay_used": False,
        "duration_seconds": 10,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_missing_fields(client):
    """Missing required fields are rejected with 422."""
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "A short passage.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_invalid_duration(client):
    """Zero duration is rejected with 422."""
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "A short passage.",
        "user_reconstruction": "My reconstruction.",
        "replay_used": False,
        "duration_seconds": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage_score": "great",
        "grammar_score": None,
        "vocabulary_score": "excellent",
        "reconstruction_quality_score": "good",
        "overall_score": "impressive",
        "feedback": "Nice attempt!",
        "model_reconstruction": "Example reconstruction.",
    })
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "Test passage.",
        "user_reconstruction": "My test reconstruction.",
        "replay_used": False,
        "duration_seconds": 15,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["content_coverage_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["vocabulary_score"] == 5.0
    assert data["reconstruction_quality_score"] == 5.0
    assert data["overall_score"] == 5.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_dictogloss_feedback_and_model(client, mock_copilot):
    """The response includes feedback and model reconstruction."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage_score": 6,
        "grammar_score": 6,
        "vocabulary_score": 6,
        "reconstruction_quality_score": 6,
        "overall_score": 6,
        "feedback": "You captured the main points but missed some details.",
        "model_reconstruction": "A well-crafted reconstruction would be...",
    })
    res = await client.post("/api/pronunciation/dictogloss/evaluate", json={
        "passage_text": "The original passage with important details.",
        "user_reconstruction": "A passage about some details.",
        "replay_used": True,
        "duration_seconds": 20,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["feedback"] == "You captured the main points but missed some details."
    assert data["model_reconstruction"] == "A well-crafted reconstruction would be..."
