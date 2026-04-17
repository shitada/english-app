"""Integration tests for debate practice API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_topic_default_difficulty(client, mock_copilot):
    """Debate topic defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "statement": "Social media does more harm than good.",
        "counter_argument": "Social media connects people worldwide and enables important social movements.",
        "context_hint": "Consider the effects on mental health and communication.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/debate-topic")
    assert res.status_code == 200
    data = res.json()
    assert data["statement"] == "Social media does more harm than good."
    assert data["counter_argument"] == "Social media connects people worldwide and enables important social movements."
    assert data["context_hint"] == "Consider the effects on mental health and communication."
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_topic_with_difficulty(client, mock_copilot):
    """Debate topic respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "statement": "Homework should be banned.",
        "counter_argument": "Homework helps students practice and learn.",
        "context_hint": "Think about learning and free time.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/debate-topic?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["statement"] == "Homework should be banned."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_topic_advanced_difficulty(client, mock_copilot):
    """Debate topic works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "statement": "Artificial intelligence will ultimately replace most human jobs.",
        "counter_argument": "AI will create new categories of jobs and augment human capabilities rather than replace them.",
        "context_hint": "Consider both economic disruption and historical technological transitions.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/debate-topic?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_topic_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/debate-topic?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_topic_fallback_on_missing_keys(client, mock_copilot):
    """Debate topic returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/debate-topic")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["statement"], str) and len(data["statement"]) > 0
    assert isinstance(data["counter_argument"], str) and len(data["counter_argument"]) > 0
    assert isinstance(data["context_hint"], str) and len(data["context_hint"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_success(client, mock_copilot):
    """Debate evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "argument_structure_score": 8,
        "rebuttal_quality_score": 7,
        "grammar_score": 9,
        "vocabulary_score": 8,
        "coherence_score": 7,
        "overall_score": 8,
        "feedback": "Strong argument with good rebuttals!",
        "model_argument": "Social media has significantly impacted mental health.",
        "model_rebuttal": "While connectivity is valuable, the evidence shows negative effects.",
    })
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "Social media does more harm than good.",
        "counter_argument": "Social media connects people worldwide.",
        "user_round1_transcript": "I believe social media is harmful because it causes anxiety.",
        "user_round2_transcript": "While connection is important, the mental health effects outweigh the benefits.",
        "total_duration_seconds": 45,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["argument_structure_score"] == 8
    assert data["rebuttal_quality_score"] == 7
    assert data["grammar_score"] == 9
    assert data["vocabulary_score"] == 8
    assert data["coherence_score"] == 7
    assert data["overall_score"] == 8
    assert data["feedback"] == "Strong argument with good rebuttals!"
    assert "model_argument" in data
    assert "model_rebuttal" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "argument_structure_score": 15,
        "rebuttal_quality_score": -2,
        "grammar_score": 0,
        "vocabulary_score": 100,
        "coherence_score": 0.5,
        "overall_score": 11,
        "feedback": "Good try!",
        "model_argument": "Example.",
        "model_rebuttal": "Counter example.",
    })
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "Test statement.",
        "counter_argument": "Test counter.",
        "user_round1_transcript": "My argument here.",
        "user_round2_transcript": "My rebuttal here.",
        "total_duration_seconds": 30,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["argument_structure_score"] == 10
    assert data["rebuttal_quality_score"] == 1
    assert data["grammar_score"] == 1
    assert data["vocabulary_score"] == 10
    assert data["coherence_score"] == 1
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_validation_empty_statement(client):
    """Empty statement is rejected."""
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "",
        "counter_argument": "Some counter.",
        "user_round1_transcript": "My argument.",
        "user_round2_transcript": "My rebuttal.",
        "total_duration_seconds": 30,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_validation_empty_round1(client):
    """Empty round 1 transcript is rejected."""
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "Some statement.",
        "counter_argument": "Some counter.",
        "user_round1_transcript": "",
        "user_round2_transcript": "My rebuttal.",
        "total_duration_seconds": 30,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_validation_empty_round2(client):
    """Empty round 2 transcript is rejected."""
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "Some statement.",
        "counter_argument": "Some counter.",
        "user_round1_transcript": "My argument.",
        "user_round2_transcript": "",
        "total_duration_seconds": 30,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_validation_empty_counter(client):
    """Empty counter_argument is rejected."""
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "Some statement.",
        "counter_argument": "",
        "user_round1_transcript": "My argument.",
        "user_round2_transcript": "My rebuttal.",
        "total_duration_seconds": 30,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_validation_invalid_duration(client):
    """Zero duration is rejected."""
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "Some statement.",
        "counter_argument": "Some counter.",
        "user_round1_transcript": "My argument.",
        "user_round2_transcript": "My rebuttal.",
        "total_duration_seconds": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_debate_evaluate_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "argument_structure_score": "great",
        "rebuttal_quality_score": None,
        "grammar_score": "excellent",
        "vocabulary_score": "good",
        "coherence_score": "strong",
        "overall_score": "impressive",
        "feedback": "Nice debate!",
        "model_argument": "Example argument.",
        "model_rebuttal": "Example rebuttal.",
    })
    res = await client.post("/api/pronunciation/debate/evaluate", json={
        "statement": "Test statement.",
        "counter_argument": "Test counter.",
        "user_round1_transcript": "My argument here.",
        "user_round2_transcript": "My rebuttal here.",
        "total_duration_seconds": 30,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["argument_structure_score"] == 5.0
    assert data["rebuttal_quality_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["vocabulary_score"] == 5.0
    assert data["coherence_score"] == 5.0
    assert data["overall_score"] == 5.0
