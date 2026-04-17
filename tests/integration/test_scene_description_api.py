"""Integration tests for scene description practice API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_default_difficulty(client, mock_copilot):
    """Scene description prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scene": "A bustling farmers market on a sunny Saturday morning with colorful stalls and crowds.",
        "key_vocabulary": ["bustling", "stalls", "in front of", "next to", "brightly colored"],
        "suggested_details": ["Describe the people and their actions", "Describe the colors and smells", "Describe the layout of the stalls"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/scene-description")
    assert res.status_code == 200
    data = res.json()
    assert data["scene"] == "A bustling farmers market on a sunny Saturday morning with colorful stalls and crowds."
    assert len(data["key_vocabulary"]) == 5
    assert len(data["suggested_details"]) == 3
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_with_difficulty(client, mock_copilot):
    """Scene description prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scene": "A park with children playing.",
        "key_vocabulary": ["playing", "trees", "near", "big", "green"],
        "suggested_details": ["What are the children doing?", "What colors do you see?", "Where are the trees?"],
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/scene-description?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["scene"] == "A park with children playing."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_advanced_difficulty(client, mock_copilot):
    """Scene description works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scene": "A rain-soaked metropolitan intersection at twilight, neon signs reflecting off wet asphalt as commuters navigate the crosswalk.",
        "key_vocabulary": ["rain-soaked", "twilight", "reflecting", "navigating", "metropolitan"],
        "suggested_details": ["Describe the interplay of light and water", "Describe the movement of people", "Describe the sensory atmosphere"],
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/scene-description?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/scene-description?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_fallback_on_missing_keys(client, mock_copilot):
    """Scene description returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/scene-description")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["scene"], str) and len(data["scene"]) > 0
    assert isinstance(data["key_vocabulary"], list) and len(data["key_vocabulary"]) > 0
    assert isinstance(data["suggested_details"], list) and len(data["suggested_details"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_key_vocabulary_capped(client, mock_copilot):
    """Key vocabulary list is capped at 6 items."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scene": "A scene.",
        "key_vocabulary": ["a", "b", "c", "d", "e", "f", "g", "h"],
        "suggested_details": ["x"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/scene-description")
    assert res.status_code == 200
    data = res.json()
    assert len(data["key_vocabulary"]) <= 6


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_evaluate_success(client, mock_copilot):
    """Scene description evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "descriptive_vocabulary_score": 8,
        "spatial_language_score": 7,
        "grammar_score": 9,
        "fluency_score": 8,
        "overall_score": 8,
        "feedback": "Great use of adjectives and spatial prepositions!",
        "model_description": "In the center of the park, children are playing near a large fountain while elderly couples sit on wooden benches under towering oak trees.",
    })
    res = await client.post("/api/pronunciation/scene-description/evaluate", json={
        "scene": "A busy park on a sunny afternoon with children playing near a fountain.",
        "transcript": "There are many children playing in the park near the fountain. The sun is shining brightly and there are tall trees behind the benches.",
        "duration_seconds": 25,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["descriptive_vocabulary_score"] == 8
    assert data["spatial_language_score"] == 7
    assert data["grammar_score"] == 9
    assert data["fluency_score"] == 8
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great use of adjectives and spatial prepositions!"
    assert "model_description" in data
    assert data["word_count"] > 0
    assert data["wpm"] > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "descriptive_vocabulary_score": 15,
        "spatial_language_score": -2,
        "grammar_score": 0,
        "fluency_score": 100,
        "overall_score": 11,
        "feedback": "Good try!",
        "model_description": "Example description.",
    })
    res = await client.post("/api/pronunciation/scene-description/evaluate", json={
        "scene": "A test scene.",
        "transcript": "This is my description of the scene.",
        "duration_seconds": 15,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["descriptive_vocabulary_score"] == 10
    assert data["spatial_language_score"] == 1
    assert data["grammar_score"] == 1
    assert data["fluency_score"] == 10
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_evaluate_validation_empty_scene(client):
    """Empty scene is rejected."""
    res = await client.post("/api/pronunciation/scene-description/evaluate", json={
        "scene": "",
        "transcript": "My description here.",
        "duration_seconds": 15,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_evaluate_validation_empty_transcript(client):
    """Empty transcript is rejected."""
    res = await client.post("/api/pronunciation/scene-description/evaluate", json={
        "scene": "A test scene.",
        "transcript": "",
        "duration_seconds": 15,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_evaluate_validation_invalid_duration(client):
    """Zero duration is rejected."""
    res = await client.post("/api/pronunciation/scene-description/evaluate", json={
        "scene": "A test scene.",
        "transcript": "My description here.",
        "duration_seconds": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_evaluate_wpm_calculation(client, mock_copilot):
    """WPM is calculated correctly from word count and duration."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "descriptive_vocabulary_score": 7,
        "spatial_language_score": 6,
        "grammar_score": 7,
        "fluency_score": 7,
        "overall_score": 7,
        "feedback": "Nice work!",
        "model_description": "Model description here.",
    })
    # 10 words in 30 seconds = 20 WPM
    res = await client.post("/api/pronunciation/scene-description/evaluate", json={
        "scene": "A scene to describe.",
        "transcript": "one two three four five six seven eight nine ten",
        "duration_seconds": 30,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["word_count"] == 10
    assert data["wpm"] == 20.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_scene_description_evaluate_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "descriptive_vocabulary_score": "great",
        "spatial_language_score": None,
        "grammar_score": "excellent",
        "fluency_score": "good",
        "overall_score": "impressive",
        "feedback": "Nice description!",
        "model_description": "Example description.",
    })
    res = await client.post("/api/pronunciation/scene-description/evaluate", json={
        "scene": "A test scene.",
        "transcript": "My description of the scene.",
        "duration_seconds": 20,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["descriptive_vocabulary_score"] == 5.0
    assert data["spatial_language_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["fluency_score"] == 5.0
    assert data["overall_score"] == 5.0
