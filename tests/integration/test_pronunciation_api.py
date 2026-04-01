"""Integration tests for pronunciation API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_get_sentences_empty(client):
    """When no conversations exist, should return sample sentences or empty list."""
    res = await client.get("/api/pronunciation/sentences")
    assert res.status_code == 200
    data = res.json()
    assert "sentences" in data
    assert isinstance(data["sentences"], list)


@pytest.mark.asyncio
async def test_get_sentences_after_conversation(client, mock_copilot):
    """After a conversation, sentences should be extracted from AI messages."""
    mock_copilot.ask = AsyncMock(
        return_value="That sounds like a great idea. I think we should schedule a meeting for next week."
    )
    await client.post("/api/conversation/start", json={"topic": "business"})

    res = await client.get("/api/pronunciation/sentences")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["sentences"], list)


@pytest.mark.asyncio
async def test_check_pronunciation(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 8,
        "overall_feedback": "Good pronunciation overall!",
        "word_feedback": [
            {"expected": "hello", "heard": "hello", "is_correct": True, "tip": ""},
            {"expected": "world", "heard": "word", "is_correct": False, "tip": "Pay attention to the 'ld' ending."},
        ],
        "focus_areas": ["word-final consonant clusters"],
    })

    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world.",
        "user_transcription": "Hello word.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 8
    assert len(data["word_feedback"]) == 2
    assert data["word_feedback"][1]["is_correct"] is False


@pytest.mark.asyncio
async def test_check_pronunciation_saves_to_db(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 6,
        "overall_feedback": "Needs work.",
        "word_feedback": [],
        "focus_areas": [],
    })

    await client.post("/api/pronunciation/check", json={
        "reference_text": "Good morning.",
        "user_transcription": "Good moaning.",
    })

    res = await client.get("/api/pronunciation/history")
    assert res.status_code == 200
    data = res.json()
    assert len(data["attempts"]) >= 1
    assert data["attempts"][0]["reference_text"] == "Good morning."


@pytest.mark.asyncio
async def test_pronunciation_history_empty(client):
    res = await client.get("/api/pronunciation/history")
    assert res.status_code == 200
    assert res.json()["attempts"] == []


@pytest.mark.asyncio
async def test_pronunciation_progress_empty(client):
    """Progress on empty database should return zeroed stats."""
    res = await client.get("/api/pronunciation/progress")
    assert res.status_code == 200
    data = res.json()
    assert data["total_attempts"] == 0
    assert data["avg_score"] == 0
    assert data["best_score"] == 0
    assert data["scores_by_date"] == []
    assert data["most_practiced"] == []


@pytest.mark.asyncio
async def test_pronunciation_progress_after_attempts(client, mock_copilot):
    """Progress should reflect submitted pronunciation checks."""
    for score in [7, 9, 5]:
        mock_copilot.ask_json = AsyncMock(return_value={
            "overall_score": score,
            "overall_feedback": "OK",
            "word_feedback": [],
            "focus_areas": [],
        })
        await client.post("/api/pronunciation/check", json={
            "reference_text": "Hello world",
            "user_transcription": "Hello world",
        })

    res = await client.get("/api/pronunciation/progress")
    assert res.status_code == 200
    data = res.json()
    assert data["total_attempts"] == 3
    assert data["best_score"] == 9
    assert data["avg_score"] == 7.0
    assert len(data["scores_by_date"]) >= 1
    assert len(data["most_practiced"]) >= 1
    assert data["most_practiced"][0]["text"] == "Hello world"
    assert data["most_practiced"][0]["attempt_count"] == 3


@pytest.mark.asyncio
async def test_pronunciation_progress_response_shape(client):
    """Response should match PronunciationProgressResponse model."""
    res = await client.get("/api/pronunciation/progress")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["total_attempts"], int)
    assert isinstance(data["avg_score"], (int, float))
    assert isinstance(data["best_score"], (int, float))
    assert isinstance(data["scores_by_date"], list)
    assert isinstance(data["most_practiced"], list)


@pytest.mark.asyncio
async def test_pronunciation_history_ordering(client, mock_copilot):
    """History should return attempts in order."""
    for text in ["Good morning", "Good evening"]:
        mock_copilot.ask_json = AsyncMock(return_value={
            "overall_score": 8,
            "overall_feedback": "Good",
            "word_feedback": [],
            "focus_areas": [],
        })
        await client.post("/api/pronunciation/check", json={
            "reference_text": text,
            "user_transcription": text,
        })

    res = await client.get("/api/pronunciation/history")
    assert res.status_code == 200
    data = res.json()
    assert len(data["attempts"]) == 2
    assert data["attempts"][0]["reference_text"] == "Good morning"
    assert data["attempts"][1]["reference_text"] == "Good evening"


@pytest.mark.asyncio
async def test_clear_history_empty(client):
    res = await client.delete("/api/pronunciation/history")
    assert res.status_code == 200
    assert res.json()["deleted_count"] == 0


@pytest.mark.asyncio
async def test_clear_history_with_data(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 7, "overall_feedback": "Good",
        "word_feedback": [], "focus_areas": [],
    })
    await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world", "user_transcription": "Hello world",
    })
    res = await client.delete("/api/pronunciation/history")
    assert res.status_code == 200
    assert res.json()["deleted_count"] >= 1


@pytest.mark.asyncio
async def test_delete_attempt_not_found(client):
    res = await client.delete("/api/pronunciation/99999")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_pronunciation_check_text_too_long(client):
    long_text = "x" * 1001
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": long_text, "user_transcription": "hello",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_score_trend_insufficient_data(client):
    res = await client.get("/api/pronunciation/trend")
    assert res.status_code == 200
    assert res.json()["trend"] == "insufficient_data"


@pytest.mark.asyncio
async def test_score_distribution_empty(client):
    res = await client.get("/api/pronunciation/distribution")
    assert res.status_code == 200
    data = res.json()
    assert data["total_attempts"] == 0
    assert len(data["distribution"]) == 5


@pytest.mark.asyncio
async def test_personal_records_empty(client):
    res = await client.get("/api/pronunciation/records")
    assert res.status_code == 200
    data = res.json()
    assert data["total_attempts"] == 0
    assert data["best_attempts"] == []


@pytest.mark.integration
async def test_weekly_progress_empty(client):
    res = await client.get("/api/pronunciation/weekly-progress")
    assert res.status_code == 200
    data = res.json()
    assert data["weeks"] == []
    assert data["total_weeks"] == 0
    assert data["improvement"] == 0.0


@pytest.mark.asyncio
async def test_get_sentences_includes_difficulty(client, mock_copilot):
    """Sentences should include a difficulty field."""
    mock_copilot.ask = AsyncMock(
        return_value="That sounds like a great idea. I think we should schedule a meeting."
    )
    await client.post("/api/conversation/start", json={"topic": "hotel", "difficulty": "beginner"})

    res = await client.get("/api/pronunciation/sentences")
    assert res.status_code == 200
    data = res.json()
    for s in data["sentences"]:
        assert "difficulty" in s
        assert s["difficulty"] in ("beginner", "intermediate", "advanced")


@pytest.mark.asyncio
async def test_get_sentences_filter_by_difficulty(client):
    """Filtering by difficulty should only return matching sentences."""
    res = await client.get("/api/pronunciation/sentences?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    for s in data["sentences"]:
        assert s["difficulty"] == "beginner"


@pytest.mark.asyncio
async def test_get_sentences_invalid_difficulty(client):
    """Invalid difficulty value should return 422."""
    res = await client.get("/api/pronunciation/sentences?difficulty=expert")
    assert res.status_code == 422
