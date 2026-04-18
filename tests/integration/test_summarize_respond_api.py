"""Integration tests for summarize & respond practice API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_prompt_default_difficulty(client, mock_copilot):
    """Summarize & respond prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "Many experts believe remote work increases productivity. Employees save time on commuting and can focus better in quiet home environments. However, some argue it reduces team collaboration.",
        "topic": "Remote Work",
        "key_argument": "Remote work increases productivity by saving commute time and improving focus.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/summarize-respond")
    assert res.status_code == 200
    data = res.json()
    assert data["passage"] == "Many experts believe remote work increases productivity. Employees save time on commuting and can focus better in quiet home environments. However, some argue it reduces team collaboration."
    assert data["topic"] == "Remote Work"
    assert data["key_argument"] == "Remote work increases productivity by saving commute time and improving focus."
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_prompt_with_difficulty(client, mock_copilot):
    """Summarize & respond prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "Dogs are good pets. They are friendly and loyal. Many families have dogs.",
        "topic": "Pets",
        "key_argument": "Dogs make good pets because they are friendly.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/summarize-respond?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["topic"] == "Pets"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_prompt_advanced_difficulty(client, mock_copilot):
    """Summarize & respond prompt works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "The epistemological implications of artificial intelligence challenge our conventional understanding of knowledge acquisition. Neural networks, while remarkably effective at pattern recognition, operate through fundamentally different mechanisms than human cognition. This raises profound questions about the nature of intelligence itself.",
        "topic": "AI Epistemology",
        "key_argument": "AI challenges our understanding of knowledge because it operates differently from human cognition.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/summarize-respond?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/summarize-respond?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Summarize & respond prompt returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/summarize-respond")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["passage"], str) and len(data["passage"]) > 0
    assert isinstance(data["topic"], str) and len(data["topic"]) > 0
    assert isinstance(data["key_argument"], str) and len(data["key_argument"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_success(client, mock_copilot):
    """Summarize & respond evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary_accuracy_score": 8,
        "response_coherence_score": 7,
        "grammar_score": 9,
        "vocabulary_score": 8,
        "overall_score": 8,
        "feedback": "Great summary that captured the main point! Your response was well-structured.",
        "model_summary": "The author argues that remote work boosts productivity.",
        "model_response": "I agree that remote work can improve focus. However, I think collaboration is also important for innovation.",
    })
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "Many experts believe remote work increases productivity.",
        "key_argument": "Remote work increases productivity.",
        "user_summary": "The author thinks remote work makes people more productive.",
        "user_response": "I agree because I work better at home without distractions.",
        "duration_seconds": 30,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["summary_accuracy_score"] == 8
    assert data["response_coherence_score"] == 7
    assert data["grammar_score"] == 9
    assert data["vocabulary_score"] == 8
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great summary that captured the main point! Your response was well-structured."
    assert "model_summary" in data
    assert "model_response" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary_accuracy_score": 15,
        "response_coherence_score": -2,
        "grammar_score": 0,
        "vocabulary_score": 100,
        "overall_score": 11,
        "feedback": "Good try!",
        "model_summary": "Example.",
        "model_response": "Example response.",
    })
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "Test passage here.",
        "key_argument": "Test argument.",
        "user_summary": "My summary.",
        "user_response": "My response here.",
        "duration_seconds": 20,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["summary_accuracy_score"] == 10
    assert data["response_coherence_score"] == 1
    assert data["grammar_score"] == 1
    assert data["vocabulary_score"] == 10
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_validation_empty_passage(client):
    """Empty passage is rejected."""
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "",
        "key_argument": "Some argument.",
        "user_summary": "My summary.",
        "user_response": "My response.",
        "duration_seconds": 20,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_validation_empty_key_argument(client):
    """Empty key_argument is rejected."""
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "Some passage.",
        "key_argument": "",
        "user_summary": "My summary.",
        "user_response": "My response.",
        "duration_seconds": 20,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_validation_empty_summary(client):
    """Empty user summary is rejected."""
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "Some passage.",
        "key_argument": "Some argument.",
        "user_summary": "",
        "user_response": "My response.",
        "duration_seconds": 20,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_validation_empty_response(client):
    """Empty user response is rejected."""
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "Some passage.",
        "key_argument": "Some argument.",
        "user_summary": "My summary.",
        "user_response": "",
        "duration_seconds": 20,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_validation_invalid_duration(client):
    """Zero duration is rejected."""
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "Some passage.",
        "key_argument": "Some argument.",
        "user_summary": "My summary.",
        "user_response": "My response.",
        "duration_seconds": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_summarize_respond_evaluate_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary_accuracy_score": "great",
        "response_coherence_score": None,
        "grammar_score": "excellent",
        "vocabulary_score": "good",
        "overall_score": "impressive",
        "feedback": "Nice work!",
        "model_summary": "Example summary.",
        "model_response": "Example response.",
    })
    res = await client.post("/api/pronunciation/summarize-respond/evaluate", json={
        "passage": "Test passage about learning.",
        "key_argument": "Learning is important.",
        "user_summary": "The author says learning matters.",
        "user_response": "I think learning is very important for everyone.",
        "duration_seconds": 25,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["summary_accuracy_score"] == 5.0
    assert data["response_coherence_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["vocabulary_score"] == 5.0
    assert data["overall_score"] == 5.0
