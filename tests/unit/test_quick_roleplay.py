"""Unit tests for Quick Role-Play endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_roleplay_scenario_success(client, mock_copilot):
    """GET /roleplay-scenario returns a 2-exchange scenario."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Ordering coffee at a café",
        "your_role": "customer",
        "partner_role": "barista",
        "exchanges": [
            {"partner_says": "Hi, welcome! What can I get for you?"},
            {"partner_says": "Great choice! Would you like anything else?"},
        ],
        "key_phrases": ["I'd like to order", "Could I have", "That's all, thanks"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/roleplay-scenario?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["scenario"] == "Ordering coffee at a café"
    assert data["your_role"] == "customer"
    assert data["partner_role"] == "barista"
    assert len(data["exchanges"]) == 2
    assert data["exchanges"][0]["partner_says"] == "Hi, welcome! What can I get for you?"
    assert len(data["key_phrases"]) == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_roleplay_scenario_pads_exchanges(client, mock_copilot):
    """Exchanges are padded to 2 if LLM returns fewer."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "At a hotel",
        "your_role": "guest",
        "partner_role": "receptionist",
        "exchanges": [{"partner_says": "Welcome!"}],
        "key_phrases": ["I have a reservation"],
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/roleplay-scenario?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert len(data["exchanges"]) == 2
    assert data["exchanges"][0]["partner_says"] == "Welcome!"
    assert data["exchanges"][1]["partner_says"] == "Could you repeat that?"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_roleplay_scenario_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/roleplay-scenario?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_roleplay_evaluate_success(client, mock_copilot):
    """POST /roleplay/evaluate returns evaluation scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "appropriateness_score": 8,
        "grammar_score": 7,
        "fluency_score": 8,
        "vocabulary_score": 7,
        "overall_score": 8,
        "feedback": "Great conversation! You responded naturally.",
        "model_responses": ["I'd like a large latte, please.", "No, that's all. Thank you!"],
    })
    res = await client.post("/api/pronunciation/roleplay/evaluate", json={
        "scenario": "Ordering coffee",
        "your_role": "customer",
        "partner_role": "barista",
        "exchanges": [
            {"partner_says": "What can I get for you?", "user_says": "Can I have a coffee please"},
            {"partner_says": "Anything else?", "user_says": "No thanks that is all"},
        ],
        "duration_seconds": 25,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["appropriateness_score"] == 8
    assert data["overall_score"] == 8
    assert len(data["model_responses"]) == 2
    assert "Great conversation" in data["feedback"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_roleplay_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "appropriateness_score": 15,
        "grammar_score": -3,
        "fluency_score": "bad",
        "vocabulary_score": 0,
        "overall_score": 11,
        "feedback": "OK",
        "model_responses": ["Example."],
    })
    res = await client.post("/api/pronunciation/roleplay/evaluate", json={
        "scenario": "Test",
        "your_role": "user",
        "partner_role": "bot",
        "exchanges": [
            {"partner_says": "Hello", "user_says": "Hi there"},
            {"partner_says": "Bye", "user_says": "See you"},
        ],
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["appropriateness_score"] == 10
    assert data["grammar_score"] == 1
    assert data["fluency_score"] == 5.0  # fallback
    assert data["vocabulary_score"] == 1
    assert data["overall_score"] == 10


@pytest.mark.unit
@pytest.mark.asyncio
async def test_roleplay_evaluate_pads_model_responses(client, mock_copilot):
    """Model responses padded to 2 if LLM returns fewer."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "appropriateness_score": 7,
        "grammar_score": 7,
        "fluency_score": 7,
        "vocabulary_score": 7,
        "overall_score": 7,
        "feedback": "Good.",
        "model_responses": [],
    })
    res = await client.post("/api/pronunciation/roleplay/evaluate", json={
        "scenario": "Test",
        "your_role": "user",
        "partner_role": "bot",
        "exchanges": [
            {"partner_says": "Hi", "user_says": "Hello"},
            {"partner_says": "Bye", "user_says": "Goodbye"},
        ],
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["model_responses"]) == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_roleplay_evaluate_empty_user_says_rejected(client):
    """Empty user_says is rejected by validation."""
    res = await client.post("/api/pronunciation/roleplay/evaluate", json={
        "scenario": "Test",
        "your_role": "user",
        "partner_role": "bot",
        "exchanges": [
            {"partner_says": "Hello", "user_says": ""},
            {"partner_says": "Bye", "user_says": "See you"},
        ],
        "duration_seconds": 10,
    })
    assert res.status_code == 422
