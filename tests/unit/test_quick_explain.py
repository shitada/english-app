"""Unit tests for Quick Explain (Circumlocution) endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_prompt_success(client, mock_copilot):
    """GET /explain-word returns a target word with forbidden words."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "word": "refrigerator",
        "forbidden_words": ["cold", "food", "kitchen", "appliance"],
        "hint": "Think about temperature and storage.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/explain-word?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["word"] == "refrigerator"
    assert len(data["forbidden_words"]) == 4
    assert data["forbidden_words"] == ["cold", "food", "kitchen", "appliance"]
    assert data["hint"] == "Think about temperature and storage."
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_prompt_pads_forbidden_words(client, mock_copilot):
    """Forbidden words are padded to 4 if LLM returns fewer."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "word": "sun",
        "forbidden_words": ["bright", "sky"],
        "hint": "It gives us warmth.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/explain-word?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert len(data["forbidden_words"]) == 4
    assert data["forbidden_words"][0] == "bright"
    assert data["forbidden_words"][1] == "sky"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_prompt_truncates_forbidden_words(client, mock_copilot):
    """Forbidden words are truncated to 4 if LLM returns more."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "word": "library",
        "forbidden_words": ["book", "read", "quiet", "shelf", "borrow", "pages"],
        "hint": "Think about where you study.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/explain-word?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert len(data["forbidden_words"]) == 4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/explain-word?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_evaluate_success(client, mock_copilot):
    """POST /explain-word/evaluate returns evaluation scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "clarity_score": 8,
        "creativity_score": 7,
        "grammar_score": 9,
        "overall_score": 8,
        "used_forbidden": [False, False, True, False],
        "feedback": "Great job explaining! You used a forbidden word once.",
        "model_explanation": "It's a large device that keeps things at low temperature.",
    })
    res = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "refrigerator",
        "forbidden_words": ["cold", "food", "kitchen", "appliance"],
        "transcript": "It is a big box in the kitchen that keeps things fresh",
        "duration_seconds": 15,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["clarity_score"] == 8
    assert data["creativity_score"] == 7
    assert data["grammar_score"] == 9
    assert data["overall_score"] == 8
    assert data["used_forbidden"] == [False, False, True, False]
    assert "Great job" in data["feedback"]
    assert data["model_explanation"] != ""


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "clarity_score": 15,
        "creativity_score": -2,
        "grammar_score": "invalid",
        "overall_score": 0,
        "used_forbidden": [False, False],
        "feedback": "OK",
        "model_explanation": "Example.",
    })
    res = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "car",
        "forbidden_words": ["drive", "road"],
        "transcript": "a vehicle with wheels",
        "duration_seconds": 5,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["clarity_score"] == 10  # clamped from 15
    assert data["creativity_score"] == 1  # clamped from -2
    assert data["grammar_score"] == 5.0  # fallback for invalid
    assert data["overall_score"] == 1  # clamped from 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_evaluate_fallback_forbidden_detection(client, mock_copilot):
    """When LLM returns fewer used_forbidden items, fallback detects words in transcript."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "clarity_score": 7,
        "creativity_score": 6,
        "grammar_score": 8,
        "overall_score": 7,
        "used_forbidden": [False],  # Only 1 item for 3 forbidden words
        "feedback": "Nice try.",
        "model_explanation": "Example.",
    })
    res = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "teacher",
        "forbidden_words": ["school", "class", "student"],
        "transcript": "a person who helps student learn in school",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["used_forbidden"]) == 3
    assert data["used_forbidden"][0] is False  # from LLM
    assert data["used_forbidden"][1] is False  # "class" not in transcript
    assert data["used_forbidden"][2] is True   # "student" IS in transcript


@pytest.mark.unit
@pytest.mark.asyncio
async def test_explain_word_evaluate_empty_transcript_rejected(client):
    """Empty transcript is rejected by validation."""
    res = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "car",
        "forbidden_words": ["drive"],
        "transcript": "",
        "duration_seconds": 5,
    })
    assert res.status_code == 422
