"""Unit tests for Rapid-Fire Q&A endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_questions_success(client, mock_copilot):
    """GET /rapid-fire returns 5 questions."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"question": "What did you have for breakfast?", "topic_hint": "food"},
            {"question": "Where do you work?", "topic_hint": "work"},
            {"question": "What is your favorite hobby?", "topic_hint": "hobbies"},
            {"question": "Where did you go on your last trip?", "topic_hint": "travel"},
            {"question": "What kind of music do you enjoy?", "topic_hint": "entertainment"},
        ]
    })
    res = await client.get("/api/pronunciation/rapid-fire?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert len(data["questions"]) == 5
    assert data["questions"][0]["question"] == "What did you have for breakfast?"
    assert data["questions"][0]["topic_hint"] == "food"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_questions_pads_to_five(client, mock_copilot):
    """Questions are padded to 5 if LLM returns fewer."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"question": "How are you?", "topic_hint": "greeting"},
            {"question": "What do you do?", "topic_hint": "work"},
        ]
    })
    res = await client.get("/api/pronunciation/rapid-fire?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 5
    assert data["questions"][0]["question"] == "How are you?"
    assert data["questions"][1]["question"] == "What do you do?"
    # Remaining are fallback questions
    assert data["questions"][2]["question"] == "What is your favourite way to relax?"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_questions_handles_empty_llm(client, mock_copilot):
    """All fallback questions if LLM returns empty."""
    mock_copilot.ask_json = AsyncMock(return_value={"questions": []})
    res = await client.get("/api/pronunciation/rapid-fire?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 5
    assert data["difficulty"] == "advanced"
    assert data["questions"][0]["topic_hint"] == "food"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_questions_invalid_difficulty(client):
    """Invalid difficulty is rejected."""
    res = await client.get("/api/pronunciation/rapid-fire?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_evaluate_success(client, mock_copilot):
    """POST /rapid-fire/evaluate returns per-question and overall scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "per_question": [
            {"relevance_score": 8, "grammar_score": 7, "fluency_score": 8, "feedback": "Great answer!", "model_answer": "I had toast and eggs."},
            {"relevance_score": 7, "grammar_score": 6, "fluency_score": 7, "feedback": "Good try.", "model_answer": "I work at a tech company."},
        ],
        "overall_response_speed_score": 8,
        "overall_fluency_score": 7,
        "overall_score": 8,
        "summary_feedback": "Well done! You responded quickly and naturally.",
    })
    res = await client.post("/api/pronunciation/rapid-fire/evaluate", json={
        "questions": ["What did you have for breakfast?", "Where do you work?"],
        "responses": [
            {"question": "What did you have for breakfast?", "transcript": "I had some toast", "duration_seconds": 4.5},
            {"question": "Where do you work?", "transcript": "I work in an office", "duration_seconds": 3.2},
        ],
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["per_question"]) == 2
    assert data["per_question"][0]["relevance_score"] == 8
    assert data["per_question"][0]["feedback"] == "Great answer!"
    assert data["overall_score"] == 8
    assert data["overall_response_speed_score"] == 8
    assert "Well done" in data["summary_feedback"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_evaluate_clamps_scores(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "per_question": [
            {"relevance_score": 15, "grammar_score": -3, "fluency_score": "bad", "feedback": "OK", "model_answer": "Example."},
        ],
        "overall_response_speed_score": 0,
        "overall_fluency_score": 12,
        "overall_score": "invalid",
        "summary_feedback": "Fine.",
    })
    res = await client.post("/api/pronunciation/rapid-fire/evaluate", json={
        "questions": ["How are you?"],
        "responses": [
            {"question": "How are you?", "transcript": "Fine thanks", "duration_seconds": 2.0},
        ],
    })
    assert res.status_code == 200
    data = res.json()
    assert data["per_question"][0]["relevance_score"] == 10
    assert data["per_question"][0]["grammar_score"] == 1
    assert data["per_question"][0]["fluency_score"] == 5.0  # fallback
    assert data["overall_response_speed_score"] == 1
    assert data["overall_fluency_score"] == 10
    assert data["overall_score"] == 5.0  # fallback


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_evaluate_pads_per_question(client, mock_copilot):
    """Per-question results padded if LLM returns fewer than responses."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "per_question": [
            {"relevance_score": 7, "grammar_score": 7, "fluency_score": 7, "feedback": "Good.", "model_answer": "Example."},
        ],
        "overall_response_speed_score": 7,
        "overall_fluency_score": 7,
        "overall_score": 7,
        "summary_feedback": "Nice.",
    })
    res = await client.post("/api/pronunciation/rapid-fire/evaluate", json={
        "questions": ["Q1?", "Q2?"],
        "responses": [
            {"question": "Q1?", "transcript": "Answer 1", "duration_seconds": 3.0},
            {"question": "Q2?", "transcript": "Answer 2", "duration_seconds": 4.0},
        ],
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["per_question"]) == 2
    # First has real scores
    assert data["per_question"][0]["relevance_score"] == 7
    # Second is padded with defaults
    assert data["per_question"][1]["relevance_score"] == 5.0
    assert data["per_question"][1]["feedback"] == ""


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_evaluate_empty_transcript_allowed(client, mock_copilot):
    """Empty transcript (no response) is accepted — duration_seconds=0 is valid."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "per_question": [
            {"relevance_score": 1, "grammar_score": 1, "fluency_score": 1, "feedback": "No response.", "model_answer": "I'm fine."},
        ],
        "overall_response_speed_score": 1,
        "overall_fluency_score": 1,
        "overall_score": 1,
        "summary_feedback": "Try to answer next time.",
    })
    res = await client.post("/api/pronunciation/rapid-fire/evaluate", json={
        "questions": ["How are you?"],
        "responses": [
            {"question": "How are you?", "transcript": "", "duration_seconds": 0},
        ],
    })
    assert res.status_code == 200
    data = res.json()
    assert data["per_question"][0]["relevance_score"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_evaluate_no_responses_rejected(client):
    """Empty responses list is rejected by validation."""
    res = await client.post("/api/pronunciation/rapid-fire/evaluate", json={
        "questions": [],
        "responses": [],
    })
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_rapid_fire_questions_non_list_from_llm(client, mock_copilot):
    """Non-list questions from LLM are replaced with fallbacks."""
    mock_copilot.ask_json = AsyncMock(return_value={"questions": "not a list"})
    res = await client.get("/api/pronunciation/rapid-fire?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 5
    # All should be fallback questions
    assert data["questions"][0]["topic_hint"] == "food"
