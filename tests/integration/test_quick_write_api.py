"""Integration tests for Quick Write API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_prompt_default_difficulty(client, mock_copilot):
    """Quick write prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "You stayed at a hotel and want to leave a review.",
        "instruction": "Write a short hotel review mentioning the room and breakfast.",
        "word_limit": 50,
    })
    res = await client.get("/api/pronunciation/quick-write")
    assert res.status_code == 200
    data = res.json()
    assert data["scenario"] == "You stayed at a hotel and want to leave a review."
    assert data["instruction"] == "Write a short hotel review mentioning the room and breakfast."
    assert data["word_limit"] == 50
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_prompt_with_difficulty(client, mock_copilot):
    """Quick write prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "You want to tell your friend about a movie.",
        "instruction": "Write a simple message about the movie you watched.",
        "word_limit": 30,
    })
    res = await client.get("/api/pronunciation/quick-write?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["word_limit"] == 30


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/quick-write?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Quick write prompt returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/quick-write")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["scenario"], str) and len(data["scenario"]) > 0
    assert isinstance(data["instruction"], str) and len(data["instruction"]) > 0
    assert data["word_limit"] == 50
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_prompt_word_limit_clamped(client, mock_copilot):
    """Word limit is clamped to 20-100 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Test scenario",
        "instruction": "Test instruction",
        "word_limit": 500,
    })
    res = await client.get("/api/pronunciation/quick-write")
    assert res.status_code == 200
    assert res.json()["word_limit"] == 100

    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Test scenario",
        "instruction": "Test instruction",
        "word_limit": 5,
    })
    res = await client.get("/api/pronunciation/quick-write")
    assert res.status_code == 200
    assert res.json()["word_limit"] == 20


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_prompt_word_limit_invalid_type(client, mock_copilot):
    """Non-numeric word_limit falls back to 50."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Test scenario",
        "instruction": "Test instruction",
        "word_limit": "not a number",
    })
    res = await client.get("/api/pronunciation/quick-write")
    assert res.status_code == 200
    assert res.json()["word_limit"] == 50


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_success(client, mock_copilot):
    """Quick write evaluation returns scores, corrections, and model response."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "grammar_score": 8,
        "vocabulary_score": 7,
        "naturalness_score": 9,
        "register_score": 8,
        "overall_score": 8,
        "feedback": "Well done! Your review is clear and appropriate.",
        "corrections": [
            {
                "original": "the room was very big",
                "corrected": "the room was spacious",
                "explanation": "'Spacious' is more appropriate in a review.",
            }
        ],
        "model_response": "The hotel room was spacious and clean. The breakfast buffet offered a great variety.",
    })
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "You stayed at a hotel.",
        "instruction": "Write a short review.",
        "user_text": "The room was very big and the breakfast was good.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["grammar_score"] == 8
    assert data["vocabulary_score"] == 7
    assert data["naturalness_score"] == 9
    assert data["register_score"] == 8
    assert data["overall_score"] == 8
    assert data["feedback"] == "Well done! Your review is clear and appropriate."
    assert len(data["corrections"]) == 1
    assert data["corrections"][0]["original"] == "the room was very big"
    assert data["corrections"][0]["corrected"] == "the room was spacious"
    assert "model_response" in data and len(data["model_response"]) > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "grammar_score": 15,
        "vocabulary_score": -3,
        "naturalness_score": 0.5,
        "register_score": 11,
        "overall_score": 0,
        "feedback": "Good try!",
        "corrections": [],
        "model_response": "Example.",
    })
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "Test scenario.",
        "instruction": "Write something.",
        "user_text": "Hello world this is a test.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["grammar_score"] == 10
    assert data["vocabulary_score"] == 1
    assert data["naturalness_score"] == 1
    assert data["register_score"] == 10
    assert data["overall_score"] == 1


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_empty_scenario(client):
    """Empty scenario is rejected."""
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "",
        "instruction": "Write something.",
        "user_text": "Hello.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_empty_instruction(client):
    """Empty instruction is rejected."""
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "Test scenario.",
        "instruction": "",
        "user_text": "Hello.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_empty_user_text(client):
    """Empty user_text is rejected."""
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "Test scenario.",
        "instruction": "Write something.",
        "user_text": "",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_no_corrections(client, mock_copilot):
    """Evaluation with no corrections returns empty corrections array."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "grammar_score": 9,
        "vocabulary_score": 9,
        "naturalness_score": 9,
        "register_score": 9,
        "overall_score": 9,
        "feedback": "Perfect!",
        "corrections": [],
        "model_response": "Great example.",
    })
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "You want to send a message.",
        "instruction": "Write a short message.",
        "user_text": "Hi! I wanted to let you know I will be a bit late today.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["corrections"] == []
    assert data["overall_score"] == 9


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_malformed_corrections(client, mock_copilot):
    """Malformed corrections are handled gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "grammar_score": 7,
        "vocabulary_score": 7,
        "naturalness_score": 7,
        "register_score": 7,
        "overall_score": 7,
        "feedback": "Good!",
        "corrections": "not a list",
        "model_response": "Example.",
    })
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "Test scenario.",
        "instruction": "Write something.",
        "user_text": "This is my test sentence.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["corrections"] == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_write_evaluate_missing_score_keys(client, mock_copilot):
    """Missing score keys fall back to 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "feedback": "Okay.",
        "model_response": "Model answer.",
    })
    res = await client.post("/api/pronunciation/quick-write/evaluate", json={
        "scenario": "Test scenario.",
        "instruction": "Write something.",
        "user_text": "This is a test.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["grammar_score"] == 5
    assert data["vocabulary_score"] == 5
    assert data["naturalness_score"] == 5
    assert data["register_score"] == 5
    assert data["overall_score"] == 5
