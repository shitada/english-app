"""Unit tests for Quick Explain (Circumlocution) endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_explain_word_success(client, mock_copilot):
    """explain-word endpoint returns target word with forbidden words."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "word": "hospital",
        "forbidden_words": ["doctor", "sick", "nurse", "medical"],
        "hint": "A type of building",
        "difficulty": "intermediate",
    })
    resp = await client.get("/api/pronunciation/explain-word?difficulty=intermediate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["word"] == "hospital"
    assert len(data["forbidden_words"]) == 4
    assert "hint" in data
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_explain_word_pads_forbidden(client, mock_copilot):
    """Forbidden words are padded to 4 if LLM returns fewer."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "word": "umbrella",
        "forbidden_words": ["rain", "wet"],
        "hint": "Think about the weather",
    })
    resp = await client.get("/api/pronunciation/explain-word?difficulty=beginner")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["forbidden_words"]) == 4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_explain_word_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    resp = await client.get("/api/pronunciation/explain-word?difficulty=expert")
    assert resp.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_evaluate_explain_word_success(client, mock_copilot):
    """explain-word evaluate endpoint returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "clarity_score": 8,
        "creativity_score": 7,
        "grammar_score": 9,
        "overall_score": 8,
        "used_forbidden": [False, False, False, False],
        "feedback": "Great explanation! You avoided all forbidden words.",
        "model_explanation": "A place where people go when they need help with their health.",
    })
    resp = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "hospital",
        "forbidden_words": ["doctor", "sick", "nurse", "medical"],
        "transcript": "A building where people go when they are not feeling well",
        "duration_seconds": 15,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["overall_score"] == 8
    assert data["clarity_score"] == 8
    assert data["creativity_score"] == 7
    assert data["grammar_score"] == 9
    assert len(data["used_forbidden"]) == 4
    assert all(v is False for v in data["used_forbidden"])
    assert "feedback" in data
    assert "model_explanation" in data


@pytest.mark.unit
@pytest.mark.asyncio
async def test_evaluate_explain_word_detects_forbidden_usage(client, mock_copilot):
    """Evaluate correctly reports when forbidden words were used."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "clarity_score": 6,
        "creativity_score": 4,
        "grammar_score": 8,
        "overall_score": 5,
        "used_forbidden": [True, False, True, False],
        "feedback": "You used some forbidden words. Try to find alternatives.",
        "model_explanation": "A place where people receive treatment when unwell.",
    })
    resp = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "hospital",
        "forbidden_words": ["doctor", "sick", "nurse", "medical"],
        "transcript": "A place where doctor and nurse help people",
        "duration_seconds": 10,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["used_forbidden"][0] is True  # doctor
    assert data["used_forbidden"][1] is False  # sick
    assert data["used_forbidden"][2] is True  # nurse
    assert data["used_forbidden"][3] is False  # medical


@pytest.mark.unit
@pytest.mark.asyncio
async def test_evaluate_explain_word_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "clarity_score": 15,
        "creativity_score": -3,
        "grammar_score": "invalid",
        "overall_score": 0,
        "used_forbidden": [],
        "feedback": "Test feedback",
        "model_explanation": "Test model",
    })
    resp = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "telephone",
        "forbidden_words": ["call", "ring", "phone", "talk"],
        "transcript": "A device you use to communicate with others at a distance",
        "duration_seconds": 8,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["clarity_score"] == 10  # clamped from 15
    assert data["creativity_score"] == 1  # clamped from -3
    assert data["grammar_score"] == 5.0  # fallback for invalid
    assert data["overall_score"] == 1  # clamped from 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_evaluate_explain_word_missing_fields(client):
    """Missing required fields in evaluate request returns 422."""
    resp = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "hospital",
        # missing forbidden_words, transcript, duration_seconds
    })
    assert resp.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_evaluate_explain_word_fallback_forbidden_check(client, mock_copilot):
    """When LLM returns fewer used_forbidden entries, fallback checks transcript."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "clarity_score": 7,
        "creativity_score": 6,
        "grammar_score": 8,
        "overall_score": 7,
        "used_forbidden": [False],  # Only 1 entry for 4 forbidden words
        "feedback": "Nice try.",
        "model_explanation": "A good explanation.",
    })
    resp = await client.post("/api/pronunciation/explain-word/evaluate", json={
        "word": "hospital",
        "forbidden_words": ["doctor", "sick", "nurse", "medical"],
        "transcript": "A place where the nurse helps people who are sick",
        "duration_seconds": 12,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["used_forbidden"]) == 4
    # First entry from LLM (False), rest from fallback transcript check
    assert data["used_forbidden"][0] is False  # "doctor" not in transcript
    assert data["used_forbidden"][1] is True   # "sick" is in transcript (fallback)
    assert data["used_forbidden"][2] is True   # "nurse" is in transcript (fallback)
    assert data["used_forbidden"][3] is False  # "medical" not in transcript (fallback)
