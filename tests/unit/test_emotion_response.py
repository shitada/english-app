"""Unit tests for Quick Emotion Response endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_success(client, mock_copilot):
    """GET /emotion-response returns scenario with situation and expected emotion."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Your friend tells you they just got promoted at work.",
        "expected_emotion": "congratulation",
        "hint_phrases": ["Congratulations!", "That's amazing news!", "You really deserve it!"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/emotion-response?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert data["situation"] == "Your friend tells you they just got promoted at work."
    assert data["expected_emotion"] == "congratulation"
    assert len(data["hint_phrases"]) == 3
    assert "Congratulations!" in data["hint_phrases"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_beginner(client, mock_copilot):
    """GET /emotion-response with beginner difficulty returns correct difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Your classmate is sad because they lost their toy.",
        "expected_emotion": "sympathy",
        "hint_phrases": ["I'm sorry", "Don't worry"],
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/emotion-response?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["expected_emotion"] == "sympathy"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_advanced(client, mock_copilot):
    """GET /emotion-response with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Your colleague confides that they're considering resigning due to burnout.",
        "expected_emotion": "encouragement",
        "hint_phrases": ["I completely understand how you feel", "Have you considered talking to HR?", "Your well-being comes first", "I'm here if you need to talk"],
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/emotion-response?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert data["expected_emotion"] == "encouragement"
    assert len(data["hint_phrases"]) == 4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_invalid_emotion_fallback(client, mock_copilot):
    """Invalid expected_emotion falls back to sympathy."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Something happened.",
        "expected_emotion": "invalid_emotion",
        "hint_phrases": ["phrase1"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/emotion-response?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["expected_emotion"] == "sympathy"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_missing_fields_fallback(client, mock_copilot):
    """Missing fields fall back to defaults."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/emotion-response?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["situation"] == "Your colleague tells you their pet just passed away."
    assert data["expected_emotion"] == "sympathy"
    assert len(data["hint_phrases"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/emotion-response?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Your neighbor tells you they're moving away.",
        "expected_emotion": "surprise",
        "hint_phrases": ["Really?", "I had no idea!"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/emotion-response")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_get_hint_phrases_capped(client, mock_copilot):
    """Hint phrases are capped at 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Test situation.",
        "expected_emotion": "excitement",
        "hint_phrases": ["a", "b", "c", "d", "e", "f", "g"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/emotion-response?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["hint_phrases"]) == 5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_evaluate_success(client, mock_copilot):
    """POST /emotion-response/evaluate returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "emotional_appropriateness_score": 8,
        "expression_variety_score": 7,
        "grammar_score": 9,
        "overall_score": 8,
        "feedback": "Great job showing sympathy! You used natural phrases effectively.",
        "model_response": "Oh no, I'm so sorry to hear that. That must be really difficult for you. Please let me know if there's anything I can do to help.",
        "useful_phrases": ["I'm so sorry to hear that", "That must be really tough", "Is there anything I can do?"],
    })
    res = await client.post("/api/pronunciation/emotion-response/evaluate", json={
        "situation": "Your colleague tells you their pet just passed away.",
        "expected_emotion": "sympathy",
        "transcript": "Oh I am so sorry to hear that. That must be really hard for you.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["emotional_appropriateness_score"] == 8
    assert data["expression_variety_score"] == 7
    assert data["grammar_score"] == 9
    assert data["overall_score"] == 8
    assert "sympathy" in data["feedback"].lower() or "Great" in data["feedback"]
    assert len(data["model_response"]) > 0
    assert len(data["useful_phrases"]) == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "emotional_appropriateness_score": 15,
        "expression_variety_score": -3,
        "grammar_score": "invalid",
        "overall_score": 0,
        "feedback": "Some feedback",
        "model_response": "A model response",
        "useful_phrases": ["phrase1"],
    })
    res = await client.post("/api/pronunciation/emotion-response/evaluate", json={
        "situation": "Your friend announces they got into their dream university.",
        "expected_emotion": "excitement",
        "transcript": "Oh wow that is great",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["emotional_appropriateness_score"] == 10  # clamped from 15
    assert data["expression_variety_score"] == 1  # clamped from -3
    assert data["grammar_score"] == 5.0  # fallback for invalid
    assert data["overall_score"] == 1  # clamped from 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_evaluate_missing_fields_rejected(client):
    """Missing required fields are rejected."""
    res = await client.post("/api/pronunciation/emotion-response/evaluate", json={
        "situation": "Something happened.",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_evaluate_empty_transcript_rejected(client):
    """Empty transcript is rejected (min_length=1)."""
    res = await client.post("/api/pronunciation/emotion-response/evaluate", json={
        "situation": "Your friend tells you they got promoted.",
        "expected_emotion": "congratulation",
        "transcript": "",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_evaluate_useful_phrases_capped(client, mock_copilot):
    """Useful phrases in evaluation response are capped at 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "emotional_appropriateness_score": 7,
        "expression_variety_score": 6,
        "grammar_score": 8,
        "overall_score": 7,
        "feedback": "Good response.",
        "model_response": "Model text.",
        "useful_phrases": ["a", "b", "c", "d", "e", "f", "g"],
    })
    res = await client.post("/api/pronunciation/emotion-response/evaluate", json={
        "situation": "Your colleague failed an important exam.",
        "expected_emotion": "encouragement",
        "transcript": "Don't worry, you can try again next time.",
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["useful_phrases"]) == 5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_evaluate_empty_useful_phrases(client, mock_copilot):
    """Empty useful_phrases is returned as empty list."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "emotional_appropriateness_score": 6,
        "expression_variety_score": 5,
        "grammar_score": 7,
        "overall_score": 6,
        "feedback": "Okay response.",
        "model_response": "Model.",
        "useful_phrases": [],
    })
    res = await client.post("/api/pronunciation/emotion-response/evaluate", json={
        "situation": "Your friend tells you surprising news.",
        "expected_emotion": "surprise",
        "transcript": "Oh really? That is surprising.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["useful_phrases"] == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emotion_response_evaluate_all_emotions_accepted(client, mock_copilot):
    """All valid emotion types are accepted in evaluate."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "emotional_appropriateness_score": 7,
        "expression_variety_score": 7,
        "grammar_score": 7,
        "overall_score": 7,
        "feedback": "Good.",
        "model_response": "Model.",
        "useful_phrases": ["phrase"],
    })
    for emotion in ["sympathy", "excitement", "congratulation", "apology", "surprise", "encouragement"]:
        res = await client.post("/api/pronunciation/emotion-response/evaluate", json={
            "situation": f"A situation requiring {emotion}.",
            "expected_emotion": emotion,
            "transcript": "My response to the situation.",
        })
        assert res.status_code == 200, f"Failed for emotion: {emotion}"
