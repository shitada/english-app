"""Unit tests for Quick Dialogue Gap Fill endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_success(client, mock_copilot):
    """GET /dialogue-gap returns a 4-line dialogue with gap."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "Hey, are you free this weekend?"},
            {"speaker": "B", "line": "I think so. Why do you ask?"},
            {"speaker": "A", "line": "I was wondering if you'd like to go hiking."},
            {"speaker": "B", "line": "That sounds great! Let's do it."},
        ],
        "gap_index": 2,
        "situation": "Two friends making weekend plans.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert len(data["dialogue"]) == 4
    assert data["gap_index"] == 2
    assert data["situation"] == "Two friends making weekend plans."
    assert data["dialogue"][0]["speaker"] == "A"
    assert data["dialogue"][0]["line"] == "Hey, are you free this weekend?"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_beginner(client, mock_copilot):
    """GET /dialogue-gap with beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "Hello!"},
            {"speaker": "B", "line": "Hi! How are you?"},
            {"speaker": "A", "line": "I'm fine, thank you."},
            {"speaker": "B", "line": "That's good!"},
        ],
        "gap_index": 1,
        "situation": "Two classmates greeting each other.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["gap_index"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_advanced(client, mock_copilot):
    """GET /dialogue-gap with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "I've been reconsidering our quarterly projections."},
            {"speaker": "B", "line": "What aspects are you concerned about?"},
            {"speaker": "A", "line": "The market volatility suggests we should hedge our positions."},
            {"speaker": "B", "line": "That's a prudent approach given current conditions."},
        ],
        "gap_index": 3,
        "situation": "Two colleagues discussing financial strategy.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert len(data["dialogue"]) == 4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 0,
        "situation": "A conversation.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/dialogue-gap")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_missing_fields_fallback(client, mock_copilot):
    """Missing fields fall back to defaults."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["dialogue"]) == 4
    assert 0 <= data["gap_index"] <= 3
    assert len(data["situation"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_gap_index_clamped(client, mock_copilot):
    """Gap index out of range is clamped to 0-3."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 99,
        "situation": "Test.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["gap_index"] == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_negative_gap_index_clamped(client, mock_copilot):
    """Negative gap index is clamped to 0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": -5,
        "situation": "Test.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["gap_index"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_non_integer_gap_index_fallback(client, mock_copilot):
    """Non-integer gap_index falls back to 1."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": "not a number",
        "situation": "Test.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["gap_index"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_get_short_dialogue_padded(client, mock_copilot):
    """Dialogue with fewer than 4 lines is padded."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "dialogue": [
            {"speaker": "A", "line": "Hello"},
            {"speaker": "B", "line": "Hi"},
        ],
        "gap_index": 0,
        "situation": "Short conversation.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/dialogue-gap?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["dialogue"]) == 4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_success(client, mock_copilot):
    """POST /dialogue-gap/evaluate returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "contextual_fit": 8,
        "grammar_score": 9,
        "naturalness": 7,
        "overall_score": 8,
        "feedback": "Great response! Your answer fits the conversation well.",
        "model_answer": "I was wondering if you'd like to go hiking.",
    })
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Hey, are you free this weekend?"},
            {"speaker": "B", "line": "I think so. Why do you ask?"},
            {"speaker": "A", "line": "I was wondering if you'd like to go hiking."},
            {"speaker": "B", "line": "That sounds great! Let's do it."},
        ],
        "gap_index": 2,
        "transcript": "Would you like to go hiking with me?",
        "difficulty": "intermediate",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["contextual_fit"] == 8
    assert data["grammar_score"] == 9
    assert data["naturalness"] == 7
    assert data["overall_score"] == 8
    assert len(data["feedback"]) > 0
    assert len(data["model_answer"]) > 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "contextual_fit": 15,
        "grammar_score": -3,
        "naturalness": "invalid",
        "overall_score": 0,
        "feedback": "Feedback.",
        "model_answer": "Model answer.",
    })
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 1,
        "transcript": "Some response",
        "difficulty": "intermediate",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["contextual_fit"] == 10  # clamped from 15
    assert data["grammar_score"] == 1  # clamped from -3
    assert data["naturalness"] == 5.0  # fallback for invalid
    assert data["overall_score"] == 1  # clamped from 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_missing_transcript_rejected(client):
    """Missing transcript is rejected."""
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 1,
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_empty_transcript_rejected(client):
    """Empty transcript is rejected (min_length=1)."""
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 1,
        "transcript": "",
        "difficulty": "intermediate",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_invalid_gap_index(client):
    """Gap index out of valid range is rejected."""
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 5,
        "transcript": "Some response",
        "difficulty": "intermediate",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_wrong_dialogue_length(client):
    """Dialogue with wrong number of lines is rejected."""
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
        ],
        "gap_index": 1,
        "transcript": "Some response",
        "difficulty": "intermediate",
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "contextual_fit": 7,
        "grammar_score": 7,
        "naturalness": 7,
        "overall_score": 7,
        "feedback": "Good.",
        "model_answer": "Model.",
    })
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 0,
        "transcript": "My response here",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 7


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_all_difficulties(client, mock_copilot):
    """All valid difficulties are accepted in evaluate."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "contextual_fit": 6,
        "grammar_score": 6,
        "naturalness": 6,
        "overall_score": 6,
        "feedback": "OK.",
        "model_answer": "Answer.",
    })
    for diff in ["beginner", "intermediate", "advanced"]:
        res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
            "dialogue": [
                {"speaker": "A", "line": "Line 1"},
                {"speaker": "B", "line": "Line 2"},
                {"speaker": "A", "line": "Line 3"},
                {"speaker": "B", "line": "Line 4"},
            ],
            "gap_index": 1,
            "transcript": "Some response",
            "difficulty": diff,
        })
        assert res.status_code == 200, f"Failed for difficulty: {diff}"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dialogue_gap_evaluate_invalid_difficulty(client):
    """Invalid difficulty in evaluate is rejected."""
    res = await client.post("/api/pronunciation/dialogue-gap/evaluate", json={
        "dialogue": [
            {"speaker": "A", "line": "Line 1"},
            {"speaker": "B", "line": "Line 2"},
            {"speaker": "A", "line": "Line 3"},
            {"speaker": "B", "line": "Line 4"},
        ],
        "gap_index": 1,
        "transcript": "Some response",
        "difficulty": "expert",
    })
    assert res.status_code == 422
