"""Unit tests for Sentence Stress endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_get_success(client, mock_copilot):
    """GET /sentence-stress returns sentence with stressed words."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "The teacher explained the difficult concept clearly.",
        "stressed_words": ["teacher", "explained", "difficult", "concept", "clearly"],
        "explanation": "Content words carry stress in English sentences.",
    })
    res = await client.get("/api/pronunciation/sentence-stress?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert data["sentence"] == "The teacher explained the difficult concept clearly."
    assert "teacher" in data["stressed_words"]
    assert "explained" in data["stressed_words"]
    assert len(data["stressed_words"]) == 5
    assert data["explanation"] == "Content words carry stress in English sentences."


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_get_beginner(client, mock_copilot):
    """GET /sentence-stress with beginner difficulty returns correct difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "I like to eat apples.",
        "stressed_words": ["like", "eat", "apples"],
        "explanation": "Verbs and nouns are stressed.",
    })
    res = await client.get("/api/pronunciation/sentence-stress?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["sentence"] == "I like to eat apples."


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_get_fallback_on_empty(client, mock_copilot):
    """Falls back to default sentence when LLM returns empty data."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "",
        "stressed_words": [],
        "explanation": "",
    })
    res = await client.get("/api/pronunciation/sentence-stress?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["sentence"] == "The big dog runs in the park every morning."
    assert "big" in data["stressed_words"]
    assert "dog" in data["stressed_words"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_get_fallback_on_missing_sentence(client, mock_copilot):
    """Falls back when sentence key is missing."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "stressed_words": ["hello"],
    })
    res = await client.get("/api/pronunciation/sentence-stress?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    # Advanced fallback
    assert "unprecedented" in data["sentence"].lower()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_get_fallback_on_missing_stressed_words(client, mock_copilot):
    """Falls back when stressed_words is empty but sentence is present."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "Hello world",
        "stressed_words": [],
        "explanation": "Something",
    })
    res = await client.get("/api/pronunciation/sentence-stress?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    # Should use fallback because stressed_words is empty
    assert len(data["stressed_words"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_get_non_list_stressed_words(client, mock_copilot):
    """Non-list stressed_words triggers fallback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "Nice day today",
        "stressed_words": "not a list",
        "explanation": "Something",
    })
    res = await client.get("/api/pronunciation/sentence-stress?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    # Should use fallback
    assert len(data["stressed_words"]) > 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/sentence-stress?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_evaluate_success(client, mock_copilot):
    """POST /sentence-stress/evaluate returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "stress_accuracy_score": 8,
        "rhythm_score": 7,
        "pronunciation_score": 9,
        "overall_score": 8,
        "feedback": "Good job emphasizing the content words!",
        "stress_tip": "Try to reduce function words like 'the' and 'in' more.",
    })
    res = await client.post("/api/pronunciation/sentence-stress/evaluate", json={
        "sentence": "The teacher explained the difficult concept clearly.",
        "stressed_words": ["teacher", "explained", "difficult", "concept", "clearly"],
        "transcript": "The teacher explained the difficult concept clearly",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["stress_accuracy_score"] == 8
    assert data["rhythm_score"] == 7
    assert data["pronunciation_score"] == 9
    assert data["overall_score"] == 8
    assert "content words" in data["feedback"]
    assert "reduce" in data["stress_tip"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "stress_accuracy_score": 15,
        "rhythm_score": -2,
        "pronunciation_score": "invalid",
        "overall_score": 0,
        "feedback": "Feedback text",
        "stress_tip": "Tip text",
    })
    res = await client.post("/api/pronunciation/sentence-stress/evaluate", json={
        "sentence": "Hello world.",
        "stressed_words": ["hello", "world"],
        "transcript": "Hello world",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["stress_accuracy_score"] == 10  # clamped from 15
    assert data["rhythm_score"] == 1  # clamped from -2
    assert data["pronunciation_score"] == 5.0  # fallback for invalid
    assert data["overall_score"] == 1  # clamped from 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_evaluate_empty_transcript(client, mock_copilot):
    """Empty transcript is accepted (user spoke nothing recognizable)."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "stress_accuracy_score": 1,
        "rhythm_score": 1,
        "pronunciation_score": 1,
        "overall_score": 1,
        "feedback": "No speech detected.",
        "stress_tip": "Try speaking louder.",
    })
    res = await client.post("/api/pronunciation/sentence-stress/evaluate", json={
        "sentence": "The big dog runs fast.",
        "stressed_words": ["big", "dog", "runs", "fast"],
        "transcript": "  ",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_evaluate_missing_fields_rejected(client):
    """Missing required fields are rejected."""
    res = await client.post("/api/pronunciation/sentence-stress/evaluate", json={
        "sentence": "Hello.",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_evaluate_empty_stressed_words_rejected(client):
    """Empty stressed_words list is rejected."""
    res = await client.post("/api/pronunciation/sentence-stress/evaluate", json={
        "sentence": "Hello world.",
        "stressed_words": [],
        "transcript": "Hello world",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_stress_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "She runs every morning in the park.",
        "stressed_words": ["runs", "morning", "park"],
        "explanation": "Main verbs and nouns are stressed.",
    })
    res = await client.get("/api/pronunciation/sentence-stress")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
