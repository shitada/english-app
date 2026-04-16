"""Unit tests for Quick Word Association endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_prompt_success(client, mock_copilot):
    """GET /word-association returns a seed word with category and target count."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "seed_word": "Travel",
        "category": "Words related to traveling and journeys",
        "hint": "Think about things you need when going on a trip.",
        "target_count": 8,
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/word-association?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["seed_word"] == "Travel"
    assert data["category"] == "Words related to traveling and journeys"
    assert data["hint"] == "Think about things you need when going on a trip."
    assert data["target_count"] == 8
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_prompt_beginner_target(client, mock_copilot):
    """Beginner difficulty passes target_count of 5 to the LLM."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "seed_word": "Food",
        "category": "Types of food you eat every day",
        "hint": "Think about breakfast, lunch, and dinner.",
        "target_count": 5,
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/word-association?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["target_count"] == 5
    assert data["difficulty"] == "beginner"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_prompt_clamps_target_count(client, mock_copilot):
    """Target count is clamped between 3 and 20."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "seed_word": "Science",
        "category": "Scientific terms",
        "hint": "Think about labs and experiments.",
        "target_count": 50,
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/word-association?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["target_count"] == 20  # clamped from 50


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_prompt_invalid_target_count(client, mock_copilot):
    """Invalid target_count falls back to difficulty-based default."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "seed_word": "Weather",
        "category": "Words about weather",
        "hint": "Look outside the window.",
        "target_count": "not_a_number",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/word-association?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["target_count"] == 8  # default for intermediate


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/word-association?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_evaluate_success(client, mock_copilot):
    """POST /word-association/evaluate returns evaluation with scores and missed words."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "valid_count": 7,
        "sophistication_score": 6,
        "relevance_score": 8,
        "overall_score": 7,
        "feedback": "Great job! You covered common travel vocabulary well.",
        "missed_words": ["itinerary", "luggage", "boarding pass"],
    })
    res = await client.post("/api/pronunciation/word-association/evaluate", json={
        "seed_word": "Travel",
        "transcript": "airplane hotel passport ticket suitcase train bus",
        "duration_seconds": 25,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["valid_count"] == 7
    assert data["sophistication_score"] == 6
    assert data["relevance_score"] == 8
    assert data["overall_score"] == 7
    assert "Great job" in data["feedback"]
    assert data["missed_words"] == ["itinerary", "luggage", "boarding pass"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "valid_count": 3,
        "sophistication_score": 15,
        "relevance_score": -2,
        "overall_score": "invalid",
        "feedback": "OK",
        "missed_words": ["word1"],
    })
    res = await client.post("/api/pronunciation/word-association/evaluate", json={
        "seed_word": "Emotions",
        "transcript": "happy sad angry",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["sophistication_score"] == 10  # clamped from 15
    assert data["relevance_score"] == 1  # clamped from -2
    assert data["overall_score"] == 5.0  # fallback for invalid


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_evaluate_invalid_valid_count(client, mock_copilot):
    """Invalid valid_count falls back to 0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "valid_count": "not_a_number",
        "sophistication_score": 5,
        "relevance_score": 5,
        "overall_score": 5,
        "feedback": "Try again.",
        "missed_words": [],
    })
    res = await client.post("/api/pronunciation/word-association/evaluate", json={
        "seed_word": "Sports",
        "transcript": "soccer basketball tennis",
        "duration_seconds": 15,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["valid_count"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_evaluate_truncates_missed_words(client, mock_copilot):
    """Missed words are truncated to 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "valid_count": 4,
        "sophistication_score": 5,
        "relevance_score": 6,
        "overall_score": 5,
        "feedback": "Good effort.",
        "missed_words": ["a", "b", "c", "d", "e", "f", "g"],
    })
    res = await client.post("/api/pronunciation/word-association/evaluate", json={
        "seed_word": "Colors",
        "transcript": "red blue green yellow",
        "duration_seconds": 20,
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["missed_words"]) == 5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_evaluate_empty_transcript_rejected(client):
    """Empty transcript is rejected by validation."""
    res = await client.post("/api/pronunciation/word-association/evaluate", json={
        "seed_word": "Animals",
        "transcript": "",
        "duration_seconds": 10,
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_word_association_evaluate_missed_words_not_list(client, mock_copilot):
    """Non-list missed_words from LLM is handled gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "valid_count": 2,
        "sophistication_score": 4,
        "relevance_score": 5,
        "overall_score": 4,
        "feedback": "Keep practicing.",
        "missed_words": "not a list",
    })
    res = await client.post("/api/pronunciation/word-association/evaluate", json={
        "seed_word": "Kitchen",
        "transcript": "spoon fork",
        "duration_seconds": 8,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["missed_words"] == []
