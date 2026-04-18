"""Integration tests for conversation repair API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_conversation_repair_default_difficulty(client, mock_copilot):
    """GET /api/pronunciation/conversation-repair returns a scenario with default difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "You are chatting with a coworker about the company meeting.",
        "speaker_statement": "We need to get the deliverables squared away by end of play.",
        "confusion_point": "The idioms 'squared away' and 'end of play' are unclear.",
        "repair_type": "clarify",
        "difficulty": "intermediate",
    })

    res = await client.get("/api/pronunciation/conversation-repair")
    assert res.status_code == 200
    data = res.json()
    assert data["situation"] == "You are chatting with a coworker about the company meeting."
    assert data["speaker_statement"] == "We need to get the deliverables squared away by end of play."
    assert data["confusion_point"] == "The idioms 'squared away' and 'end of play' are unclear."
    assert data["repair_type"] == "clarify"
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_conversation_repair_with_difficulty(client, mock_copilot):
    """GET /api/pronunciation/conversation-repair?difficulty=advanced returns correct difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "You are in a lecture about economics.",
        "speaker_statement": "The marginal propensity to consume affects the fiscal multiplier.",
        "confusion_point": "The term 'marginal propensity to consume' is unclear.",
        "repair_type": "define",
        "difficulty": "advanced",
    })

    res = await client.get("/api/pronunciation/conversation-repair?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert data["repair_type"] == "define"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_conversation_repair_invalid_difficulty(client):
    """GET /api/pronunciation/conversation-repair with invalid difficulty returns 422."""
    res = await client.get("/api/pronunciation/conversation-repair?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_conversation_repair_invalid_repair_type_normalized(client, mock_copilot):
    """Invalid repair_type from LLM is normalized to 'clarify'."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "You are at a restaurant.",
        "speaker_statement": "We've got a cracking special on today.",
        "confusion_point": "The word 'cracking' is unclear in this context.",
        "repair_type": "unknown_strategy",
        "difficulty": "intermediate",
    })

    res = await client.get("/api/pronunciation/conversation-repair")
    assert res.status_code == 200
    data = res.json()
    assert data["repair_type"] == "clarify"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_conversation_repair(client, mock_copilot):
    """POST /api/pronunciation/conversation-repair/evaluate returns evaluation scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "strategy_score": 8,
        "politeness_score": 9,
        "grammar_score": 7,
        "overall_score": 8,
        "feedback": "Great use of a polite clarification question. Your phrasing was natural.",
        "model_repair": "Sorry, could you explain what you mean by 'squared away'?",
    })

    res = await client.post("/api/pronunciation/conversation-repair/evaluate", json={
        "situation": "Chatting with a coworker about a project.",
        "speaker_statement": "We need to get the deliverables squared away.",
        "confusion_point": "The idiom 'squared away' is unclear.",
        "repair_type": "clarify",
        "transcript": "Excuse me, what do you mean by squared away?",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["strategy_score"] == 8
    assert data["politeness_score"] == 9
    assert data["grammar_score"] == 7
    assert data["overall_score"] == 8
    assert "feedback" in data
    assert "model_repair" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_conversation_repair_scores_clamped(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "strategy_score": 15,
        "politeness_score": -3,
        "grammar_score": 0,
        "overall_score": 100,
        "feedback": "Good job!",
        "model_repair": "Could you repeat that please?",
    })

    res = await client.post("/api/pronunciation/conversation-repair/evaluate", json={
        "situation": "At a train station.",
        "speaker_statement": "The train is delayed due to a points failure.",
        "confusion_point": "The term 'points failure' is unclear.",
        "repair_type": "repeat",
        "transcript": "Sorry, could you say that again?",
    })
    assert res.status_code == 200
    data = res.json()
    assert 1 <= data["strategy_score"] <= 10
    assert 1 <= data["politeness_score"] <= 10
    assert 1 <= data["grammar_score"] <= 10
    assert 1 <= data["overall_score"] <= 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_evaluate_conversation_repair_missing_fields(client):
    """POST with missing required fields returns 422."""
    res = await client.post("/api/pronunciation/conversation-repair/evaluate", json={
        "situation": "At a restaurant.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_get_conversation_repair_all_repair_types(client, mock_copilot):
    """Each valid repair_type is accepted from LLM."""
    for repair_type in ["clarify", "repeat", "confirm", "define"]:
        mock_copilot.ask_json = AsyncMock(return_value={
            "situation": "A meeting at work.",
            "speaker_statement": "Let's take this offline.",
            "confusion_point": "What does 'take this offline' mean?",
            "repair_type": repair_type,
            "difficulty": "intermediate",
        })

        res = await client.get("/api/pronunciation/conversation-repair")
        assert res.status_code == 200
        data = res.json()
        assert data["repair_type"] == repair_type
