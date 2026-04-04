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
    assert data["attempts"][0]["reference_text"] == "Good evening"
    assert data["attempts"][1]["reference_text"] == "Good morning"


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


@pytest.mark.integration
async def test_vocabulary_sentences_empty(client):
    res = await client.get("/api/pronunciation/sentences/vocabulary")
    assert res.status_code == 200
    data = res.json()
    assert data["sentences"] == []
    assert data["source"] == "vocabulary"


@pytest.mark.integration
async def test_vocabulary_sentences_with_data(client, mock_copilot):
    mock_copilot.ask_json.return_value = {
        "questions": [
            {"word": "desk", "correct_meaning": "a table", "example_sentence": "Please sit at the desk.", "difficulty": 2, "wrong_options": ["a", "b", "c"]},
        ]
    }
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    res = await client.get("/api/pronunciation/sentences/vocabulary")
    assert res.status_code == 200
    data = res.json()
    assert data["count"] >= 1
    assert data["sentences"][0]["word"] == "desk"


@pytest.mark.integration
async def test_vocabulary_sentences_difficulty_filter(client, mock_copilot):
    mock_copilot.ask_json.return_value = {
        "questions": [
            {"word": "desk", "correct_meaning": "a table", "example_sentence": "Sit.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
            {"word": "complex", "correct_meaning": "difficult", "example_sentence": "Complex.", "difficulty": 4, "wrong_options": ["a", "b", "c"]},
        ]
    }
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    res = await client.get("/api/pronunciation/sentences/vocabulary?difficulty=beginner")
    assert res.status_code == 200
    for s in res.json()["sentences"]:
        assert s["difficulty"] == "beginner"


@pytest.mark.integration
async def test_sentence_history_empty_result(client):
    """Querying history for a sentence with no attempts returns empty."""
    res = await client.get("/api/pronunciation/sentence-history", params={"text": "No attempts."})
    assert res.status_code == 200
    data = res.json()
    assert data["attempts"] == []
    assert data["summary"]["attempt_count"] == 0


@pytest.mark.integration
async def test_sentence_history_after_attempts(client, mock_copilot):
    """Saving attempts then querying returns correct history."""
    for score in [5, 8]:
        mock_copilot.ask_json = AsyncMock(return_value={
            "overall_score": score, "overall_feedback": "OK",
            "word_feedback": [], "focus_areas": [],
        })
        await client.post("/api/pronunciation/check", json={
            "reference_text": "Good morning.",
            "user_transcription": "Good morning.",
        })
    res = await client.get("/api/pronunciation/sentence-history", params={"text": "Good morning."})
    assert res.status_code == 200
    data = res.json()
    assert len(data["attempts"]) == 2
    assert data["summary"]["attempt_count"] == 2
    assert data["summary"]["improvement"] == 3.0


@pytest.mark.integration
async def test_sentence_history_missing_text_param(client):
    """Missing text parameter should return 422."""
    res = await client.get("/api/pronunciation/sentence-history")
    assert res.status_code == 422


@pytest.mark.integration
async def test_weaknesses_empty(client):
    res = await client.get("/api/pronunciation/weaknesses")
    assert res.status_code == 200
    data = res.json()
    assert data["weaknesses"] == []
    assert data["total"] == 0


@pytest.mark.integration
async def test_retry_suggestions_empty(client):
    res = await client.get("/api/pronunciation/retry-suggestions")
    assert res.status_code == 200
    data = res.json()
    assert data["suggestions"] == []
    assert data["threshold"] == 7.0


@pytest.mark.integration
async def test_check_pronunciation_with_difficulty(client, mock_copilot):
    """Submitting a check with difficulty should persist and return it in history."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 7,
        "overall_feedback": "Good job!",
        "word_feedback": [],
        "focus_areas": [],
    })

    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "I have a reservation.",
        "user_transcription": "I have a reservation.",
        "difficulty": "beginner",
    })
    assert res.status_code == 200

    res = await client.get("/api/pronunciation/history")
    assert res.status_code == 200
    attempts = res.json()["attempts"]
    assert len(attempts) >= 1
    match = [a for a in attempts if a["reference_text"] == "I have a reservation."]
    assert len(match) == 1
    assert match[0]["difficulty"] == "beginner"


@pytest.mark.integration
async def test_difficulty_progress_empty(client):
    """Empty DB should return empty items list."""
    res = await client.get("/api/pronunciation/difficulty-progress")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []


@pytest.mark.integration
async def test_difficulty_progress_after_attempts(client, mock_copilot):
    """Submit attempts at different difficulties and verify breakdown."""
    for difficulty, score in [("beginner", 8), ("beginner", 6), ("advanced", 9)]:
        mock_copilot.ask_json = AsyncMock(return_value={
            "overall_score": score, "overall_feedback": "OK",
            "word_feedback": [], "focus_areas": [],
        })
        await client.post("/api/pronunciation/check", json={
            "reference_text": "Test sentence.",
            "user_transcription": "Test sentence.",
            "difficulty": difficulty,
        })

    res = await client.get("/api/pronunciation/difficulty-progress")
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 2
    difficulties = {item["difficulty"] for item in data["items"]}
    assert difficulties == {"beginner", "advanced"}
    beginner = next(i for i in data["items"] if i["difficulty"] == "beginner")
    assert beginner["attempt_count"] == 2
    assert beginner["avg_score"] == 7.0
    assert beginner["best_score"] == 8
    advanced = next(i for i in data["items"] if i["difficulty"] == "advanced")
    assert advanced["attempt_count"] == 1
    assert advanced["best_score"] == 9


@pytest.mark.asyncio
@pytest.mark.integration
async def test_check_pronunciation_empty_llm_response(client, mock_copilot):
    """LLM returns empty dict — should normalize to safe defaults."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world",
        "user_transcription": "Hello world",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] is None
    assert data["word_feedback"] == []
    assert data["focus_areas"] == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_check_pronunciation_score_as_string(client, mock_copilot):
    """LLM returns overall_score as string — should be coerced to float."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": "7.5",
        "overall_feedback": "Good",
        "word_feedback": [],
        "focus_areas": [],
    })
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world",
        "user_transcription": "Hello world",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 7.5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_check_pronunciation_word_feedback_non_list(client, mock_copilot):
    """LLM returns word_feedback as string — should be normalized to empty list."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 8,
        "overall_feedback": "Nice",
        "word_feedback": "some invalid string",
        "focus_areas": ["intonation"],
    })
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world",
        "user_transcription": "Hello world",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["word_feedback"] == []
    assert data["focus_areas"] == ["intonation"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_check_pronunciation_clamps_high_scores(client, mock_copilot):
    """LLM returns scores above 10 — should be clamped to 10.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 15,
        "overall_feedback": "Perfect",
        "word_feedback": [],
        "focus_areas": [],
        "fluency_score": 12,
        "fluency_feedback": "Great",
    })
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world",
        "user_transcription": "Hello world",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 10.0
    assert data["fluency_score"] == 10.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_check_pronunciation_clamps_negative_scores(client, mock_copilot):
    """LLM returns negative scores — should be clamped to 0.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": -2,
        "overall_feedback": "Poor",
        "word_feedback": [],
        "focus_areas": [],
        "fluency_score": -5,
        "fluency_feedback": "Needs work",
    })
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Hello world",
        "user_transcription": "Hello world",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 0.0
    assert data["fluency_score"] == 0.0


@pytest.mark.integration
async def test_common_mistakes_empty(client):
    """Common mistakes on empty DB returns empty list."""
    resp = await client.get("/api/pronunciation/common-mistakes")
    assert resp.status_code == 200
    data = resp.json()
    assert data["patterns"] == []
    assert data["total"] == 0


@pytest.mark.integration
async def test_common_mistakes_after_attempts(client, mock_copilot):
    """Common mistakes aggregates phoneme issues from feedback."""
    mock_copilot.ask_json.return_value = {
        "overall_score": 6,
        "overall_feedback": "Good try",
        "word_feedback": [
            {
                "expected": "three",
                "heard": "tree",
                "is_correct": False,
                "tip": "θ sound",
                "phoneme_issues": [
                    {"target_sound": "θ", "produced_sound": "t", "position": "beginning"}
                ],
            },
            {
                "expected": "the",
                "heard": "da",
                "is_correct": False,
                "tip": "ð sound",
                "phoneme_issues": [
                    {"target_sound": "ð", "produced_sound": "d", "position": "beginning"}
                ],
            },
            {"expected": "cat", "heard": "cat", "is_correct": True, "tip": ""},
        ],
        "fluency_score": 7,
        "fluency_feedback": "OK",
        "focus_areas": ["th sounds"],
        "common_patterns": ["θ replaced with t"],
    }

    # Make two attempts to accumulate data
    await client.post(
        "/api/pronunciation/check",
        json={"reference_text": "three cats", "user_transcription": "tree cats"},
    )
    await client.post(
        "/api/pronunciation/check",
        json={"reference_text": "the dog", "user_transcription": "da dog"},
    )

    resp = await client.get("/api/pronunciation/common-mistakes")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    # Should find θ→t pattern
    patterns = data["patterns"]
    assert len(patterns) >= 1
    first = patterns[0]
    assert "target_sound" in first
    assert "produced_sound" in first
    assert "occurrence_count" in first
    assert "example_words" in first
    assert first["occurrence_count"] >= 1


@pytest.mark.integration
async def test_check_pronunciation_normalizes_phoneme_issues(client, mock_copilot):
    """Phoneme issues and common_patterns are normalized in check response."""
    mock_copilot.ask_json.return_value = {
        "overall_score": 8,
        "overall_feedback": "Good",
        "word_feedback": [
            {
                "expected": "think",
                "heard": "sink",
                "is_correct": False,
                "tip": "th sound",
                "phoneme_issues": "not a list",
            },
        ],
        "fluency_score": 8,
        "fluency_feedback": "OK",
        "focus_areas": [],
        "common_patterns": 42,
    }

    resp = await client.post(
        "/api/pronunciation/check",
        json={"reference_text": "think", "user_transcription": "sink"},
    )
    assert resp.status_code == 200
    data = resp.json()
    # phoneme_issues should be normalized to empty list
    wf = data["word_feedback"][0]
    assert wf["phoneme_issues"] == []
    # common_patterns should be normalized to empty list
    assert data["common_patterns"] == []
