"""Integration tests for connector drill API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_default_params(client, mock_copilot):
    """Connector drill returns exercises with default parameters."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "exercises": [
            {
                "sentence_a": "It was raining heavily.",
                "sentence_b": "We decided to go for a walk.",
                "connector": "however",
                "connector_type": "contrast",
                "hint": "Use 'however' to show contrast between two ideas.",
            },
            {
                "sentence_a": "She studied very hard.",
                "sentence_b": "She passed the exam with flying colors.",
                "connector": "as a result",
                "connector_type": "cause_effect",
                "hint": "Use 'as a result' to show a consequence.",
            },
        ],
    })
    res = await client.get("/api/pronunciation/connector-drill")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert len(data["exercises"]) == 2
    ex = data["exercises"][0]
    assert ex["sentence_a"] == "It was raining heavily."
    assert ex["sentence_b"] == "We decided to go for a walk."
    assert ex["connector"] == "however"
    assert ex["connector_type"] == "contrast"
    assert "hint" in ex


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_with_difficulty_and_count(client, mock_copilot):
    """Connector drill respects difficulty and count parameters."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "exercises": [
            {
                "sentence_a": "The cat sat on the mat.",
                "sentence_b": "The dog lay on the rug.",
                "connector": "and",
                "connector_type": "addition",
                "hint": "Use 'and' to add information.",
            },
        ],
    })
    res = await client.get("/api/pronunciation/connector-drill?difficulty=beginner&count=1")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert len(data["exercises"]) == 1
    assert data["exercises"][0]["connector"] == "and"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/connector-drill?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_empty_llm_response(client, mock_copilot):
    """Empty LLM response returns empty exercises list."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/connector-drill")
    assert res.status_code == 200
    data = res.json()
    assert data["exercises"] == []
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_evaluate_success(client, mock_copilot):
    """Evaluate endpoint returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "connector_usage_score": 9,
        "grammar_score": 8,
        "naturalness_score": 8,
        "overall_score": 8,
        "model_answer": "It was raining heavily; however, we decided to go for a walk.",
        "feedback": "Great use of 'however' to show contrast.",
    })
    res = await client.post("/api/pronunciation/connector-drill/evaluate", json={
        "sentence_a": "It was raining heavily.",
        "sentence_b": "We decided to go for a walk.",
        "connector": "however",
        "user_response": "It was raining heavily however we decided to go for a walk.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["connector_usage_score"] == 9
    assert data["grammar_score"] == 8
    assert data["naturalness_score"] == 8
    assert data["overall_score"] == 8
    assert "however" in data["model_answer"]
    assert len(data["feedback"]) > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "connector_usage_score": 15,
        "grammar_score": -2,
        "naturalness_score": "invalid",
        "overall_score": 0,
        "model_answer": "Combined sentence.",
        "feedback": "Some feedback.",
    })
    res = await client.post("/api/pronunciation/connector-drill/evaluate", json={
        "sentence_a": "She is smart.",
        "sentence_b": "She failed the test.",
        "connector": "although",
        "user_response": "Although she is smart she failed the test.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["connector_usage_score"] == 10  # clamped from 15
    assert data["grammar_score"] == 1  # clamped from -2
    assert data["naturalness_score"] == 5.0  # fallback for invalid
    assert data["overall_score"] == 1  # clamped from 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_evaluate_empty_fields_rejected(client):
    """Empty required fields are rejected with 422."""
    res = await client.post("/api/pronunciation/connector-drill/evaluate", json={
        "sentence_a": "",
        "sentence_b": "We went home.",
        "connector": "because",
        "user_response": "Because it rained we went home.",
    })
    assert res.status_code == 422

    res2 = await client.post("/api/pronunciation/connector-drill/evaluate", json={
        "sentence_a": "It rained.",
        "sentence_b": "We went home.",
        "connector": "because",
        "user_response": "",
    })
    assert res2.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connector_drill_evaluate_fallback_model_answer(client, mock_copilot):
    """When LLM omits model_answer, a fallback is generated."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "connector_usage_score": 7,
        "grammar_score": 7,
        "naturalness_score": 7,
        "overall_score": 7,
    })
    res = await client.post("/api/pronunciation/connector-drill/evaluate", json={
        "sentence_a": "He was tired.",
        "sentence_b": "He kept working.",
        "connector": "but",
        "user_response": "He was tired but he kept working.",
    })
    assert res.status_code == 200
    data = res.json()
    # Fallback model_answer should contain sentence_a and connector
    assert "He was tired" in data["model_answer"]
    assert "but" in data["model_answer"]
