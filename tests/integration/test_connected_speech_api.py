"""Integration tests for connected speech API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_connected_speech_default_difficulty(client, mock_copilot):
    """GET /api/pronunciation/connected-speech returns a phrase with default difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrase": "turn it off",
        "pattern_type": "linking",
        "formal_pronunciation": "turn / it / off",
        "natural_pronunciation": "tur-ni-toff",
        "explanation": "The final consonant links to the next vowel sound.",
    })

    res = await client.get("/api/pronunciation/connected-speech")
    assert res.status_code == 200
    data = res.json()
    assert data["phrase"] == "turn it off"
    assert data["pattern_type"] == "linking"
    assert data["formal_pronunciation"] == "turn / it / off"
    assert data["natural_pronunciation"] == "tur-ni-toff"
    assert "explanation" in data
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_connected_speech_with_difficulty(client, mock_copilot):
    """GET /api/pronunciation/connected-speech?difficulty=advanced returns correct difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrase": "don't you think",
        "pattern_type": "assimilation",
        "formal_pronunciation": "don't / you / think",
        "natural_pronunciation": "donchoo think",
        "explanation": "The /t/ and /j/ merge into /tʃ/.",
    })

    res = await client.get("/api/pronunciation/connected-speech?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert data["pattern_type"] == "assimilation"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_connected_speech_invalid_difficulty(client):
    """GET /api/pronunciation/connected-speech with invalid difficulty returns 422."""
    res = await client.get("/api/pronunciation/connected-speech?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_connected_speech_fallback_on_empty_llm(client, mock_copilot):
    """Fallback data is returned when LLM returns empty/invalid data."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrase": "",
        "pattern_type": "",
        "formal_pronunciation": "",
        "natural_pronunciation": "",
        "explanation": "",
    })

    res = await client.get("/api/pronunciation/connected-speech?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    # Should return fallback data
    assert data["phrase"] != ""
    assert data["pattern_type"] in ("linking", "reduction", "elision", "assimilation")
    assert data["formal_pronunciation"] != ""
    assert data["natural_pronunciation"] != ""
    assert data["difficulty"] == "beginner"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_connected_speech_invalid_pattern_type_normalized(client, mock_copilot):
    """Invalid pattern_type from LLM is normalized to 'linking'."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrase": "give me a hand",
        "pattern_type": "unknown_type",
        "formal_pronunciation": "give / me / a / hand",
        "natural_pronunciation": "gimme a hand",
        "explanation": "Give me is reduced.",
    })

    res = await client.get("/api/pronunciation/connected-speech")
    assert res.status_code == 200
    data = res.json()
    assert data["pattern_type"] == "linking"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_connected_speech(client, mock_copilot):
    """POST /api/pronunciation/connected-speech/evaluate returns evaluation scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "naturalness_score": 8,
        "accuracy_score": 7,
        "rhythm_score": 7,
        "overall_score": 7,
        "feedback": "Good linking between 'turn' and 'it'. Very natural sounding.",
        "pronunciation_tip": "Try to blend the sounds even more smoothly.",
    })

    res = await client.post("/api/pronunciation/connected-speech/evaluate", json={
        "phrase": "turn it off",
        "pattern_type": "linking",
        "transcript": "turn it off",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["naturalness_score"] == 8
    assert data["accuracy_score"] == 7
    assert data["rhythm_score"] == 7
    assert data["overall_score"] == 7
    assert "feedback" in data
    assert "pronunciation_tip" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_connected_speech_scores_clamped(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "naturalness_score": 15,
        "accuracy_score": -2,
        "rhythm_score": 0,
        "overall_score": 100,
        "feedback": "Great job!",
        "pronunciation_tip": "Keep practicing.",
    })

    res = await client.post("/api/pronunciation/connected-speech/evaluate", json={
        "phrase": "want to go",
        "pattern_type": "reduction",
        "transcript": "wanna go",
    })
    assert res.status_code == 200
    data = res.json()
    assert 1 <= data["naturalness_score"] <= 10
    assert 1 <= data["accuracy_score"] <= 10
    assert 1 <= data["rhythm_score"] <= 10
    assert 1 <= data["overall_score"] <= 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_connected_speech_empty_transcript(client, mock_copilot):
    """Evaluation works even with minimal transcript."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "naturalness_score": 3,
        "accuracy_score": 2,
        "rhythm_score": 3,
        "overall_score": 3,
        "feedback": "Try to speak more clearly.",
        "pronunciation_tip": "Focus on linking sounds together.",
    })

    res = await client.post("/api/pronunciation/connected-speech/evaluate", json={
        "phrase": "next day",
        "pattern_type": "elision",
        "transcript": "x",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_connected_speech_missing_fields(client):
    """POST with missing required fields returns 422."""
    res = await client.post("/api/pronunciation/connected-speech/evaluate", json={
        "phrase": "turn it off",
    })
    assert res.status_code == 422
