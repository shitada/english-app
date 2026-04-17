"""Integration tests for 4-3-2 Fluency Sprint API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_topic_default(client, mock_copilot):
    """Fluency sprint topic returns a topic with default intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "topic": "Describe your favorite way to spend a rainy day",
        "guiding_questions": [
            "What activities do you enjoy?",
            "Why does this make you feel relaxed?",
            "Do you prefer being alone or with others?",
        ],
    })
    res = await client.get("/api/pronunciation/fluency-sprint/topic")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert data["topic"] == "Describe your favorite way to spend a rainy day"
    assert len(data["guiding_questions"]) == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_topic_with_difficulty(client, mock_copilot):
    """Fluency sprint topic respects the difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "topic": "Talk about your morning routine",
        "guiding_questions": [
            "What time do you wake up?",
            "What do you eat for breakfast?",
            "How do you get to school or work?",
        ],
    })
    res = await client.get("/api/pronunciation/fluency-sprint/topic?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["topic"] == "Talk about your morning routine"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_topic_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/fluency-sprint/topic?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_topic_fallback_on_empty_llm(client, mock_copilot):
    """Empty LLM response returns fallback topic and guiding questions."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/fluency-sprint/topic")
    assert res.status_code == 200
    data = res.json()
    assert len(data["topic"]) > 0
    assert len(data["guiding_questions"]) == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_evaluate_success(client, mock_copilot):
    """Successful evaluation returns rounds, improvement score, and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "feedback": "Great improvement! You spoke more fluently in each round.",
        "strengths": ["Good use of linking words", "Clear pronunciation"],
        "tips": ["Try to use more varied vocabulary", "Pause less between sentences"],
    })
    res = await client.post("/api/pronunciation/fluency-sprint/evaluate", json={
        "topic": "Describe your ideal weekend",
        "transcripts": [
            "I like to spend my weekends relaxing at home and reading books",
            "I enjoy weekends relaxing at home reading books and cooking",
            "Weekends I relax read books and cook at home",
        ],
        "durations": [60, 40, 20],
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["rounds"]) == 3
    for r in data["rounds"]:
        assert "wpm" in r
        assert "word_count" in r
        assert "unique_words" in r
        assert "vocabulary_richness" in r
        assert r["wpm"] >= 0
    assert "fluency_improvement_score" in data
    assert isinstance(data["fluency_improvement_score"], (int, float))
    assert data["feedback"] == "Great improvement! You spoke more fluently in each round."
    assert len(data["strengths"]) == 2
    assert len(data["tips"]) == 2


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_evaluate_wpm_calculation(client, mock_copilot):
    """WPM calculation is correct for each round."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "feedback": "Good work.",
        "strengths": [],
        "tips": [],
    })
    # 10 words in 60s => 10 WPM; 8 words in 40s => 12 WPM; 5 words in 20s => 15 WPM
    res = await client.post("/api/pronunciation/fluency-sprint/evaluate", json={
        "topic": "Test topic",
        "transcripts": [
            "one two three four five six seven eight nine ten",
            "one two three four five six seven eight",
            "one two three four five",
        ],
        "durations": [60, 40, 20],
    })
    assert res.status_code == 200
    data = res.json()
    assert data["rounds"][0]["wpm"] == 10.0
    assert data["rounds"][1]["wpm"] == 12.0
    assert data["rounds"][2]["wpm"] == 15.0
    # Improvement: (15 - 10) / 10 * 100 = 50%
    assert data["fluency_improvement_score"] == 50.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_evaluate_empty_transcript_rejected(client):
    """Empty transcript in any round is rejected with 422."""
    res = await client.post("/api/pronunciation/fluency-sprint/evaluate", json={
        "topic": "Describe your ideal weekend",
        "transcripts": [
            "I like weekends",
            "",
            "Weekends are great",
        ],
        "durations": [60, 40, 20],
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_evaluate_wrong_transcript_count(client):
    """Fewer or more than 3 transcripts is rejected with 422."""
    res = await client.post("/api/pronunciation/fluency-sprint/evaluate", json={
        "topic": "Test",
        "transcripts": ["hello", "world"],
        "durations": [60, 40],
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_evaluate_empty_topic_rejected(client):
    """Empty topic string is rejected with 422."""
    res = await client.post("/api/pronunciation/fluency-sprint/evaluate", json={
        "topic": "",
        "transcripts": ["a", "b", "c"],
        "durations": [60, 40, 20],
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_fluency_sprint_evaluate_llm_failure_fallback(client, mock_copilot):
    """When LLM fails, evaluation still returns rounds with fallback feedback."""
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM down"))
    res = await client.post("/api/pronunciation/fluency-sprint/evaluate", json={
        "topic": "Describe your weekend",
        "transcripts": [
            "I like to relax on weekends",
            "I relax on weekends often",
            "Relax weekends me",
        ],
        "durations": [60, 40, 20],
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["rounds"]) == 3
    assert len(data["feedback"]) > 0
