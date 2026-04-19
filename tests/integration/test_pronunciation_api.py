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
    assert data["sentences"][0]["topic"] == "Hotel & Accommodation"


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


@pytest.mark.asyncio
async def test_dictation_check_perfect(client):
    """Dictation check returns perfect score for exact match."""
    resp = await client.post(
        "/api/pronunciation/dictation-check",
        json={
            "reference_text": "The quick brown fox jumps over the lazy dog",
            "user_typed_text": "The quick brown fox jumps over the lazy dog",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["score"] == 10.0
    assert data["correct_words"] == data["total_words"]
    assert all(w["is_correct"] for w in data["word_results"])


@pytest.mark.asyncio
async def test_dictation_check_partial(client):
    """Dictation check returns partial score for partial match."""
    resp = await client.post(
        "/api/pronunciation/dictation-check",
        json={
            "reference_text": "Hello world",
            "user_typed_text": "Hello word",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_words"] == 2
    assert data["correct_words"] == 1
    assert data["score"] == 5.0


@pytest.mark.asyncio
async def test_dictation_check_empty_typed(client):
    """Dictation check with empty typed text returns zero score."""
    resp = await client.post(
        "/api/pronunciation/dictation-check",
        json={
            "reference_text": "Hello world",
            "user_typed_text": " ",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["score"] == 0.0
    assert data["correct_words"] == 0


@pytest.mark.asyncio
async def test_dictation_check_validation(client):
    """Dictation check rejects empty reference text."""
    resp = await client.post(
        "/api/pronunciation/dictation-check",
        json={
            "reference_text": "",
            "user_typed_text": "hello",
        },
    )
    assert resp.status_code == 422


@pytest.mark.integration
async def test_dictation_check_insertion(client):
    """Dictation check handles word insertion gracefully."""
    resp = await client.post(
        "/api/pronunciation/dictation-check",
        json={
            "reference_text": "I went to the store",
            "user_typed_text": "I went the store",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_words"] == 5
    # Missing "to" — should not score every remaining word wrong
    assert data["correct_words"] >= 3
    assert isinstance(data["word_results"], list)


@pytest.mark.integration
async def test_dictation_check_extra_words(client):
    """Dictation check handles extra words in user input."""
    resp = await client.post(
        "/api/pronunciation/dictation-check",
        json={
            "reference_text": "The cat sat",
            "user_typed_text": "The big cat sat down",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_words"] == 3
    assert isinstance(data["word_results"], list)


@pytest.mark.integration
async def test_minimal_pairs_default(client):
    """GET /api/pronunciation/minimal-pairs returns pairs."""
    res = await client.get("/api/pronunciation/minimal-pairs")
    assert res.status_code == 200
    data = res.json()
    assert "pairs" in data
    assert "total" in data
    assert len(data["pairs"]) <= 10
    for pair in data["pairs"]:
        assert "word_a" in pair
        assert "word_b" in pair
        assert "phoneme_contrast" in pair
        assert pair["play_word"] in ("a", "b")


@pytest.mark.integration
async def test_minimal_pairs_filtered(client):
    """GET /api/pronunciation/minimal-pairs filters by difficulty."""
    res = await client.get("/api/pronunciation/minimal-pairs?difficulty=beginner&count=5")
    assert res.status_code == 200
    data = res.json()
    assert all(p["difficulty"] == "beginner" for p in data["pairs"])
    assert len(data["pairs"]) <= 5


@pytest.mark.integration
async def test_minimal_pairs_invalid_difficulty(client):
    """Invalid difficulty returns 422."""
    res = await client.get("/api/pronunciation/minimal-pairs?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.integration
async def test_minimal_pairs_count_one(client):
    """count=1 returns exactly 1 pair."""
    res = await client.get("/api/pronunciation/minimal-pairs?count=1")
    assert res.status_code == 200
    data = res.json()
    assert len(data["pairs"]) == 1
    assert data["total"] == 1


@pytest.mark.integration
async def test_minimal_pairs_count_exceeds_pool(client):
    """Requesting more pairs than available returns all without error."""
    res = await client.get("/api/pronunciation/minimal-pairs?difficulty=advanced&count=30")
    assert res.status_code == 200
    data = res.json()
    assert len(data["pairs"]) <= 30
    assert data["total"] == len(data["pairs"])


@pytest.mark.integration
async def test_minimal_pairs_count_zero_returns_422(client):
    """count=0 violates ge=1 constraint → 422."""
    res = await client.get("/api/pronunciation/minimal-pairs?count=0")
    assert res.status_code == 422


@pytest.mark.integration
async def test_minimal_pairs_count_over_max_returns_422(client):
    """count=31 violates le=30 constraint → 422."""
    res = await client.get("/api/pronunciation/minimal-pairs?count=31")
    assert res.status_code == 422


@pytest.mark.integration
async def test_minimal_pairs_intermediate_filter(client):
    """Intermediate filter returns only intermediate pairs."""
    res = await client.get("/api/pronunciation/minimal-pairs?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["pairs"]) > 0
    assert all(p["difficulty"] == "intermediate" for p in data["pairs"])


@pytest.mark.integration
async def test_minimal_pairs_advanced_filter(client):
    """Advanced filter returns only advanced pairs."""
    res = await client.get("/api/pronunciation/minimal-pairs?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert len(data["pairs"]) > 0
    assert all(p["difficulty"] == "advanced" for p in data["pairs"])


@pytest.mark.integration
async def test_minimal_pairs_response_shape(client):
    """Every pair has all required fields with correct types."""
    res = await client.get("/api/pronunciation/minimal-pairs?count=20")
    assert res.status_code == 200
    data = res.json()
    assert len(data["pairs"]) > 0
    for pair in data["pairs"]:
        assert isinstance(pair["word_a"], str) and len(pair["word_a"]) > 0
        assert isinstance(pair["word_b"], str) and len(pair["word_b"]) > 0
        assert isinstance(pair["phoneme_contrast"], str) and len(pair["phoneme_contrast"]) > 0
        assert isinstance(pair["example_a"], str) and len(pair["example_a"]) > 0
        assert isinstance(pair["example_b"], str) and len(pair["example_b"]) > 0
        assert pair["difficulty"] in ("beginner", "intermediate", "advanced")
        assert pair["play_word"] in ("a", "b")


@pytest.mark.integration
async def test_listening_quiz_success(client, mock_copilot):
    """Listening quiz returns passage and validated questions."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "title": "At the Coffee Shop",
        "passage": "Sarah walked into the coffee shop. She ordered a latte.",
        "questions": [
            {"question": "Where did Sarah go?", "options": ["Park", "Coffee shop", "Library", "Office"], "correct_index": 1, "explanation": "The passage says she walked into the coffee shop."},
            {"question": "What did she order?", "options": ["A latte", "Tea", "Water", "Juice"], "correct_index": 0, "explanation": "She ordered a latte."},
        ],
    })
    res = await client.post("/api/pronunciation/listening-quiz?difficulty=beginner&question_count=2")
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "At the Coffee Shop"
    assert "Sarah" in data["passage"]
    assert len(data["questions"]) == 2
    assert data["questions"][0]["correct_index"] == 1
    assert data["questions"][1]["correct_index"] == 0


@pytest.mark.integration
async def test_listening_quiz_correct_index_zero(client, mock_copilot):
    """correct_index=0 is NOT treated as falsy — question is included."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "title": "Test",
        "passage": "A simple passage for testing.",
        "questions": [
            {"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": 0, "explanation": "E1"},
        ],
    })
    res = await client.post("/api/pronunciation/listening-quiz?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 1
    assert data["questions"][0]["correct_index"] == 0


@pytest.mark.integration
async def test_listening_quiz_invalid_difficulty(client):
    """Invalid difficulty value is rejected."""
    res = await client.post("/api/pronunciation/listening-quiz?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.integration
async def test_listening_quiz_llm_failure(client, mock_copilot):
    """LLM failure returns 502."""
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM timeout"))
    res = await client.post("/api/pronunciation/listening-quiz?difficulty=beginner")
    assert res.status_code == 502


@pytest.mark.integration
async def test_quick_speak_prompt_success(client, mock_copilot):
    """Quick speak generates a prompt with suggested phrases."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "prompt": "Describe your morning routine.",
        "context_hint": "Think about what you do from waking up to leaving home.",
        "difficulty": "intermediate",
        "suggested_phrases": ["I usually start by", "After that I", "My favorite part is"],
    })
    res = await client.get("/api/pronunciation/quick-speak?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert "prompt" in data
    assert "suggested_phrases" in data
    assert len(data["suggested_phrases"]) <= 3


@pytest.mark.integration
async def test_quick_speak_evaluate_success(client, mock_copilot):
    """Quick speak evaluates a transcript and returns scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "fluency_score": 7, "relevance_score": 8,
        "grammar_score": 6, "vocabulary_score": 7,
        "overall_score": 7, "feedback": "Good job!",
        "suggestions": ["Try using more complex sentences"],
    })
    res = await client.post("/api/pronunciation/quick-speak/evaluate", json={
        "prompt": "Describe your day.", "transcript": "I wake up and go to work.", "duration_seconds": 15,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 7
    assert data["word_count"] >= 7
    assert data["wpm"] > 0


@pytest.mark.integration
async def test_quick_speak_evaluate_validation(client):
    """Empty transcript is rejected."""
    res = await client.post("/api/pronunciation/quick-speak/evaluate", json={
        "prompt": "Test", "transcript": "", "duration_seconds": 10,
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_save_listening_quiz_result(client):
    """Saving a valid listening quiz result returns ID."""
    res = await client.post("/api/pronunciation/listening-quiz/results", json={
        "title": "At the Airport", "difficulty": "beginner",
        "total_questions": 5, "correct_count": 4, "score": 80,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["id"] >= 1
    assert data["message"] == "Result saved"


@pytest.mark.integration
async def test_save_listening_quiz_result_with_first_listen(client):
    """Saving with first_listen_* fields persists them and returns via detail."""
    res = await client.post("/api/pronunciation/listening-quiz/results", json={
        "title": "FL Test", "difficulty": "intermediate",
        "total_questions": 5, "correct_count": 4, "score": 80,
        "first_listen_correct": 3, "first_listen_total": 5,
    })
    assert res.status_code == 200
    rid = res.json()["id"]
    detail_res = await client.get(f"/api/pronunciation/listening-quiz/{rid}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["first_listen_correct"] == 3
    assert detail["first_listen_total"] == 5


@pytest.mark.integration
async def test_save_listening_quiz_result_first_listen_validation(client):
    """first_listen_correct > first_listen_total is rejected."""
    res = await client.post("/api/pronunciation/listening-quiz/results", json={
        "title": "Bad", "difficulty": "beginner",
        "total_questions": 5, "correct_count": 4, "score": 80,
        "first_listen_correct": 4, "first_listen_total": 2,
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_save_listening_quiz_result_validation(client):
    """correct_count > total_questions is rejected."""
    res = await client.post("/api/pronunciation/listening-quiz/results", json={
        "title": "Test", "difficulty": "beginner",
        "total_questions": 3, "correct_count": 5, "score": 100,
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_save_listening_quiz_result_all_wrong(client):
    """Edge case: user gets all answers wrong (correct_count=0)."""
    res = await client.post("/api/pronunciation/listening-quiz/results", json={
        "title": "Hard Listening", "difficulty": "advanced",
        "total_questions": 5, "correct_count": 0, "score": 0,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["id"] >= 1
    assert data["message"] == "Result saved"


@pytest.mark.integration
async def test_listening_quiz_history_empty(client):
    """Empty history returns empty list."""
    res = await client.get("/api/pronunciation/listening-quiz/history")
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.integration
async def test_listening_quiz_history_populated(client):
    """Saved results appear in history."""
    await client.post("/api/pronunciation/listening-quiz/results", json={
        "title": "Hotel", "difficulty": "intermediate",
        "total_questions": 5, "correct_count": 3, "score": 60,
    })
    await client.post("/api/pronunciation/listening-quiz/results", json={
        "title": "Airport", "difficulty": "advanced",
        "total_questions": 5, "correct_count": 5, "score": 100,
    })
    res = await client.get("/api/pronunciation/listening-quiz/history?limit=10")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 2
    titles = {d["title"] for d in data}
    assert "Hotel" in titles
    assert "Airport" in titles


@pytest.mark.integration
async def test_response_drill_prompts(client, mock_copilot):
    """Response drill returns situational prompts."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "prompts": [
            {"situation": "At a hotel", "speaker_says": "Welcome!", "expected_response_type": "greeting", "difficulty": "beginner"},
            {"situation": "Restaurant", "speaker_says": "Ready to order?", "expected_response_type": "ordering", "difficulty": "beginner"},
        ]
    })
    res = await client.get("/api/pronunciation/response-drill?difficulty=beginner&count=2")
    assert res.status_code == 200
    data = res.json()
    assert len(data["prompts"]) == 2
    assert data["prompts"][0]["situation"] == "At a hotel"


@pytest.mark.integration
async def test_response_drill_evaluate(client, mock_copilot):
    """Response drill evaluation returns scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "appropriateness_score": 8, "grammar_score": 7, "naturalness_score": 7,
        "overall_score": 7.5, "feedback": "Good response!", "model_response": "Hello, I have a reservation.",
    })
    res = await client.post("/api/pronunciation/response-drill/evaluate", json={
        "situation": "At a hotel", "speaker_says": "Welcome! Do you have a reservation?",
        "user_response": "Yes I have reservation.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 7.5
    assert data["feedback"] == "Good response!"
    assert "model_response" in data


@pytest.mark.integration
async def test_response_drill_evaluate_validation(client):
    """Empty user_response is rejected."""
    res = await client.post("/api/pronunciation/response-drill/evaluate", json={
        "situation": "Hotel", "speaker_says": "Welcome!", "user_response": "",
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_sentence_expand_seeds(client, mock_copilot):
    """Sentence expand returns seed sentences."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "seeds": [
            {"seed": "I like coffee", "context": "Add details about when and where", "difficulty": "intermediate"},
            {"seed": "She went home", "context": "Describe the journey", "difficulty": "intermediate"},
        ]
    })
    res = await client.get("/api/pronunciation/sentence-expand?difficulty=intermediate&count=2")
    assert res.status_code == 200
    data = res.json()
    assert len(data["seeds"]) == 2
    assert data["seeds"][0]["seed"] == "I like coffee"


@pytest.mark.integration
async def test_sentence_expand_evaluate(client, mock_copilot):
    """Sentence expand evaluation returns scores and word count."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "grammar_score": 8, "creativity_score": 7, "complexity_score": 6,
        "overall_score": 7, "feedback": "Nice expansion!",
        "model_expansion": "I really enjoy drinking freshly brewed coffee every morning at the local cafe.",
    })
    res = await client.post("/api/pronunciation/sentence-expand/evaluate", json={
        "seed": "I like coffee",
        "expanded": "I like to drink hot coffee every morning before going to work",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 7
    assert data["word_count_added"] >= 7
    assert "model_expansion" in data


@pytest.mark.integration
async def test_sentence_expand_evaluate_validation(client):
    """Empty expanded sentence is rejected."""
    res = await client.post("/api/pronunciation/sentence-expand/evaluate", json={
        "seed": "I like coffee", "expanded": "",
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_pronunciation_check_with_passage_sentence(client, mock_copilot):
    """Echo practice: pronunciation check works with a sentence extracted from a listening passage."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 7.8,
        "overall_feedback": "Good pronunciation with minor issues.",
        "fluency_score": 7.2,
        "fluency_feedback": "Mostly fluent.",
        "word_feedback": [
            {"expected": "the", "heard": "the", "is_correct": True, "tip": ""},
            {"expected": "hotel", "heard": "hotel", "is_correct": True, "tip": ""},
            {"expected": "reservation", "heard": "reservation", "is_correct": True, "tip": ""},
        ],
        "focus_areas": [],
    })
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "The hotel reservation was confirmed for two nights.",
        "user_transcription": "The hotel reservation was confirmed for two nights.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["overall_score"] == 7.8
    assert "word_feedback" in data


@pytest.mark.integration
async def test_pronunciation_check_with_short_sentence(client, mock_copilot):
    """Echo practice: pronunciation check handles shorter sentences from passages."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 8.5,
        "overall_feedback": "Well done!",
        "word_feedback": [
            {"expected": "please", "heard": "please", "is_correct": True, "tip": ""},
        ],
        "focus_areas": [],
    })
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "Please take a seat.",
        "user_transcription": "Please take a seat.",
    })
    assert res.status_code == 200
    assert res.json()["overall_score"] == 8.5


@pytest.mark.integration
async def test_pronunciation_check_empty_transcription_rejected(client):
    """Echo practice: empty transcription is rejected."""
    res = await client.post("/api/pronunciation/check", json={
        "reference_text": "The weather is nice today.",
        "user_transcription": "",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listening_summary_evaluate(client, mock_copilot):
    """Listen-and-summarize endpoint returns evaluation scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage_score": 8,
        "accuracy_score": 7,
        "grammar_score": 9,
        "conciseness_score": 7,
        "overall_score": 8,
        "feedback": "Good summary covering main points.",
        "model_summary": "The passage discusses hotel check-in procedures.",
    })
    res = await client.post("/api/pronunciation/listening-summary/evaluate", json={
        "passage": "Welcome to our hotel. Please present your ID and credit card for check-in.",
        "user_summary": "The passage is about hotel check-in where you need to show ID and credit card.",
    })
    assert res.status_code == 200
    data = res.json()
    assert 1 <= data["content_coverage_score"] <= 10
    assert 1 <= data["accuracy_score"] <= 10
    assert 1 <= data["grammar_score"] <= 10
    assert 1 <= data["conciseness_score"] <= 10
    assert 1 <= data["overall_score"] <= 10
    assert len(data["feedback"]) > 0
    assert len(data["model_summary"]) > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listening_summary_evaluate_short_input(client):
    """Listen-and-summarize rejects too-short inputs."""
    res = await client.post("/api/pronunciation/listening-summary/evaluate", json={
        "passage": "Short.",
        "user_summary": "OK",
    })
    assert res.status_code == 422


# ── Pronunciation endpoint data-populated tests (iter 344) ──────────


async def _submit_checks(client, mock_copilot, sentences_scores: list[tuple[str, int]]):
    """Helper: submit multiple pronunciation checks with given scores."""
    for text, score in sentences_scores:
        mock_copilot.ask_json = AsyncMock(return_value={
            "overall_score": score,
            "overall_feedback": "Feedback",
            "word_feedback": [],
            "focus_areas": [],
        })
        res = await client.post("/api/pronunciation/check", json={
            "reference_text": text,
            "user_transcription": text,
        })
        assert res.status_code == 200


@pytest.mark.asyncio
@pytest.mark.integration
async def test_retry_suggestions_populated(client, mock_copilot):
    """GET /retry-suggestions returns low-scored sentences."""
    await _submit_checks(client, mock_copilot, [
        ("She sells seashells.", 4),
        ("The weather is nice.", 9),
    ])
    res = await client.get("/api/pronunciation/retry-suggestions")
    assert res.status_code == 200
    data = res.json()
    texts = [s["text"] for s in data["suggestions"]]
    assert "She sells seashells." in texts
    assert "The weather is nice." not in texts
    low = next(s for s in data["suggestions"] if s["text"] == "She sells seashells.")
    assert low["latest_score"] == 4


@pytest.mark.asyncio
@pytest.mark.integration
async def test_personal_records_populated(client, mock_copilot):
    """GET /records returns best/worst with correct ordering after submitting checks."""
    await _submit_checks(client, mock_copilot, [
        ("Good sentence.", 9),
        ("Bad sentence.", 3),
        ("Medium sentence.", 6),
    ])
    res = await client.get("/api/pronunciation/records")
    assert res.status_code == 200
    data = res.json()
    assert data["total_attempts"] >= 3
    assert data["best_score"] >= 9
    assert data["worst_score"] <= 3
    assert len(data["best_attempts"]) >= 1
    assert len(data["worst_attempts"]) >= 1
    assert data["best_attempts"][0]["score"] >= data["best_attempts"][-1]["score"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_score_distribution_populated(client, mock_copilot):
    """GET /distribution has non-zero counts after submitting varied scores."""
    await _submit_checks(client, mock_copilot, [
        ("Sentence A.", 2),
        ("Sentence B.", 5),
        ("Sentence C.", 9),
    ])
    res = await client.get("/api/pronunciation/distribution")
    assert res.status_code == 200
    data = res.json()
    assert data["total_attempts"] >= 3
    non_zero = [b for b in data["distribution"] if b["count"] > 0]
    assert len(non_zero) >= 2


@pytest.mark.asyncio
@pytest.mark.integration
async def test_score_trend_with_data(client, mock_copilot):
    """GET /trend returns improving/stable/declining when enough data exists."""
    # Need window*2 = 10 attempts. First 5 low, last 5 high → improving.
    sentences = [(f"Trend sentence {i}.", score) for i, score in enumerate([
        3, 3, 4, 3, 3,   # older 5 (avg ~3.2)
        8, 9, 8, 9, 8,   # recent 5 (avg ~8.4)
    ])]
    await _submit_checks(client, mock_copilot, sentences)
    res = await client.get("/api/pronunciation/trend")
    assert res.status_code == 200
    data = res.json()
    assert data["trend"] in ("improving", "stable", "declining")
    assert data["trend"] != "insufficient_data"
    assert data["recent_avg"] > data["previous_avg"]
    assert data["change"] > 0


# ── Minimal Pairs Results & Stats ───────────────────────────


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_minimal_pairs_results_success(client):
    """POST /minimal-pairs/results saves valid results and returns count."""
    body = {
        "results": [
            {"phoneme_contrast": "p/b", "word_a": "pat", "word_b": "bat", "is_correct": True},
            {"phoneme_contrast": "p/b", "word_a": "pin", "word_b": "bin", "is_correct": False},
            {"phoneme_contrast": "s/z", "word_a": "sip", "word_b": "zip", "is_correct": True},
        ]
    }
    res = await client.post("/api/pronunciation/minimal-pairs/results", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["saved"] == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_save_minimal_pairs_results_empty_rejected(client):
    """POST /minimal-pairs/results rejects empty results list."""
    res = await client.post("/api/pronunciation/minimal-pairs/results", json={"results": []})
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_minimal_pairs_stats_empty(client):
    """GET /minimal-pairs/stats returns empty list when no results exist."""
    res = await client.get("/api/pronunciation/minimal-pairs/stats")
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_minimal_pairs_stats_after_results(client):
    """GET /minimal-pairs/stats reflects saved results accurately."""
    body = {
        "results": [
            {"phoneme_contrast": "t/d", "word_a": "ten", "word_b": "den", "is_correct": True},
            {"phoneme_contrast": "t/d", "word_a": "tip", "word_b": "dip", "is_correct": True},
            {"phoneme_contrast": "t/d", "word_a": "tuck", "word_b": "duck", "is_correct": False},
            {"phoneme_contrast": "f/v", "word_a": "fan", "word_b": "van", "is_correct": True},
        ]
    }
    await client.post("/api/pronunciation/minimal-pairs/results", json=body)

    res = await client.get("/api/pronunciation/minimal-pairs/stats")
    assert res.status_code == 200
    stats = res.json()
    assert len(stats) >= 2

    td_stat = next(s for s in stats if s["phoneme_contrast"] == "t/d")
    assert td_stat["attempts"] == 3
    assert td_stat["correct"] == 2
    assert abs(td_stat["accuracy"] - 66.67) < 1

    fv_stat = next(s for s in stats if s["phoneme_contrast"] == "f/v")
    assert fv_stat["attempts"] == 1
    assert fv_stat["correct"] == 1
    assert fv_stat["accuracy"] == 100.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_minimal_pairs_stats_limit(client):
    """GET /minimal-pairs/stats respects limit parameter."""
    contrasts = ["a/b", "c/d", "e/f", "g/h", "i/j"]
    results = [
        {"phoneme_contrast": c, "word_a": "x", "word_b": "y", "is_correct": True}
        for c in contrasts
    ]
    await client.post("/api/pronunciation/minimal-pairs/results", json={"results": results})

    res = await client.get("/api/pronunciation/minimal-pairs/stats?limit=3")
    assert res.status_code == 200
    assert len(res.json()) <= 3


# ── Listening Quiz Difficulty Recommendation ────────────────


@pytest.mark.asyncio
@pytest.mark.integration
async def test_difficulty_recommendation_empty(client):
    """GET /listening-quiz/difficulty-recommendation returns beginner with no history."""
    res = await client.get("/api/pronunciation/listening-quiz/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    assert data["recommended_difficulty"] == "beginner"
    assert data["current_difficulty"] is None
    assert data["stats"]["quizzes_analyzed"] == 0


async def _insert_quiz_results(client, difficulty: str, scores: list[float]):
    """Helper to insert listening quiz results via the results endpoint."""
    for score in scores:
        total = 5
        correct = round(score / 100 * total)
        body = {
            "title": f"Test quiz {difficulty}",
            "difficulty": difficulty,
            "total_questions": total,
            "correct_count": correct,
            "score": score,
        }
        res = await client.post("/api/pronunciation/listening-quiz/results", json=body)
        assert res.status_code == 200


@pytest.mark.asyncio
@pytest.mark.integration
async def test_difficulty_recommendation_level_up(client):
    """High scores on beginner should recommend intermediate."""
    await _insert_quiz_results(client, "beginner", [90, 85, 95, 80, 90])

    res = await client.get("/api/pronunciation/listening-quiz/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    assert data["recommended_difficulty"] == "intermediate"
    assert data["current_difficulty"] == "beginner"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_difficulty_recommendation_level_down(client):
    """Low scores on advanced should recommend stepping down."""
    await _insert_quiz_results(client, "advanced", [30, 25, 40, 35, 20])

    res = await client.get("/api/pronunciation/listening-quiz/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    assert data["recommended_difficulty"] == "intermediate"
    assert data["current_difficulty"] == "advanced"


@pytest.mark.integration
async def test_sentence_transform_exercises(client, mock_copilot):
    """Sentence transform GET returns exercises from LLM."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "exercises": [
            {
                "original_sentence": "She walks to school every day.",
                "transformation_type": "past tense",
                "instruction": "Change this sentence to the past tense",
                "expected_answer": "She walked to school every day.",
                "difficulty": "intermediate",
            },
            {
                "original_sentence": "They eat lunch at noon.",
                "transformation_type": "question",
                "instruction": "Turn this into a question",
                "expected_answer": "Do they eat lunch at noon?",
                "difficulty": "intermediate",
            },
        ]
    })
    res = await client.get("/api/pronunciation/sentence-transform?difficulty=intermediate&count=2")
    assert res.status_code == 200
    data = res.json()
    assert len(data["exercises"]) == 2
    assert data["exercises"][0]["transformation_type"] == "past tense"
    assert data["exercises"][1]["original_sentence"] == "They eat lunch at noon."


@pytest.mark.integration
async def test_sentence_transform_evaluate(client, mock_copilot):
    """Sentence transform evaluate returns clamped scores."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "grammar_score": 9,
        "transformation_score": 8,
        "naturalness_score": 7,
        "overall_score": 8,
        "feedback": "Excellent transformation!",
        "correct_version": "She walked to school every day.",
    })
    res = await client.post("/api/pronunciation/sentence-transform/evaluate", json={
        "original_sentence": "She walks to school every day.",
        "transformation_type": "past tense",
        "expected_answer": "She walked to school every day.",
        "user_response": "She walked to school every day.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["grammar_score"] == 9
    assert data["transformation_score"] == 8
    assert data["overall_score"] == 8
    assert data["feedback"] == "Excellent transformation!"
    assert data["correct_version"] == "She walked to school every day."


@pytest.mark.integration
async def test_sentence_transform_evaluate_validation(client):
    """Empty user response is rejected."""
    res = await client.post("/api/pronunciation/sentence-transform/evaluate", json={
        "original_sentence": "She walks to school.",
        "transformation_type": "past tense",
        "expected_answer": "She walked to school.",
        "user_response": "",
    })
    assert res.status_code == 422


# --- Listening QA Evaluate ---

@pytest.mark.integration
async def test_listening_qa_evaluate_success(client, mock_copilot):
    mock_copilot.ask_json.return_value = {
        "content_accuracy_score": 8,
        "grammar_score": 7,
        "vocabulary_score": 9,
        "overall_score": 8,
        "feedback": "Good answer with accurate content.",
        "model_answer": "The main character went to the park.",
    }
    res = await client.post("/api/pronunciation/listening-qa/evaluate", json={
        "passage": "The main character decided to visit the park on a sunny afternoon.",
        "question": "Where did the main character go?",
        "correct_answer": "The main character went to the park.",
        "user_spoken_answer": "He went to the park in the afternoon.",
    })
    assert res.status_code == 200
    data = res.json()
    assert 1 <= data["content_accuracy_score"] <= 10
    assert 1 <= data["grammar_score"] <= 10
    assert 1 <= data["vocabulary_score"] <= 10
    assert 1 <= data["overall_score"] <= 10
    assert isinstance(data["feedback"], str)
    assert isinstance(data["model_answer"], str)


@pytest.mark.integration
async def test_listening_qa_evaluate_validation(client):
    # Missing required field
    res = await client.post("/api/pronunciation/listening-qa/evaluate", json={
        "passage": "Some passage",
        "question": "Some question?",
        "correct_answer": "The answer.",
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_listening_qa_evaluate_empty_spoken_answer(client):
    res = await client.post("/api/pronunciation/listening-qa/evaluate", json={
        "passage": "Some passage",
        "question": "Some question?",
        "correct_answer": "The answer.",
        "user_spoken_answer": "",
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_listening_qa_evaluate_score_clamping(client, mock_copilot):
    mock_copilot.ask_json.return_value = {
        "content_accuracy_score": 15,
        "grammar_score": -2,
        "vocabulary_score": "not_a_number",
        "overall_score": 0,
        "feedback": "Evaluation complete",
        "model_answer": "Model answer here",
    }
    res = await client.post("/api/pronunciation/listening-qa/evaluate", json={
        "passage": "A short passage for testing.",
        "question": "What is this about?",
        "correct_answer": "Testing.",
        "user_spoken_answer": "It is about testing.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["content_accuracy_score"] == 10.0  # clamped from 15
    assert data["grammar_score"] == 1.0  # clamped from -2
    assert data["vocabulary_score"] == 5.0  # fallback for non-numeric
    assert data["overall_score"] == 1.0  # clamped from 0


@pytest.mark.integration
async def test_sentence_mastery_empty(client):
    """Empty DB returns empty mastery overview."""
    res = await client.get("/api/pronunciation/sentence-mastery")
    assert res.status_code == 200
    data = res.json()
    assert data["sentences"] == []
    assert data["total_count"] == 0
    assert data["mastered_count"] == 0


@pytest.mark.integration
async def test_sentence_mastery_with_data(client, mock_copilot):
    """Seeded pronunciation attempts produce correct mastery classifications."""
    mock_copilot.ask_json.return_value = {
        "accuracy_score": 5.0,
        "fluency_score": 5.0,
        "pronunciation_score": 5.0,
        "overall_score": 5.0,
        "feedback": "Test",
        "phoneme_errors": [],
    }
    # Create multiple attempts for the same sentence via /check endpoint
    for score_val in [3.0, 5.0, 9.0]:
        mock_copilot.ask_json.return_value = {
            "accuracy_score": score_val,
            "fluency_score": score_val,
            "pronunciation_score": score_val,
            "overall_score": score_val,
            "feedback": "Test",
            "phoneme_errors": [],
        }
        await client.post("/api/pronunciation/check", json={
            "reference_text": "Mastery test sentence",
            "user_transcription": "Mastery test sentence",
        })

    res = await client.get("/api/pronunciation/sentence-mastery?min_attempts=2")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] >= 1
    s = data["sentences"][0]
    assert s["reference_text"] == "Mastery test sentence"
    assert s["attempt_count"] >= 2


@pytest.mark.integration
async def test_sentence_mastery_min_attempts_filter(client):
    """min_attempts query parameter filters correctly."""
    res = await client.get("/api/pronunciation/sentence-mastery?min_attempts=5")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] == 0


@pytest.mark.integration
async def test_speaking_journal_progress_empty(client):
    """Progress endpoint returns zeros with no entries."""
    res = await client.get("/api/pronunciation/speaking-journal/progress")
    assert res.status_code == 200
    data = res.json()
    assert data["total_entries"] == 0
    assert data["avg_wpm"] == 0.0
    assert data["wpm_trend"] == "insufficient_data"
    assert data["entries_by_date"] == []


@pytest.mark.integration
async def test_speaking_journal_progress_with_entries(client):
    """Progress endpoint returns correct stats after adding entries."""
    for i in range(3):
        await client.post("/api/pronunciation/speaking-journal", json={
            "prompt": f"Test prompt {i}",
            "transcript": f"This is my test transcript number {i} with some words",
            "duration_seconds": 30,
        })
    res = await client.get("/api/pronunciation/speaking-journal/progress")
    assert res.status_code == 200
    data = res.json()
    assert data["total_entries"] == 3
    assert data["total_speaking_time_seconds"] > 0
    assert data["avg_wpm"] > 0
    assert data["longest_entry"] is not None
    assert "wpm" in data["longest_entry"]
    assert "vocabulary_diversity" in data["longest_entry"]


@pytest.mark.integration
async def test_speaking_journal_vocab_upgrade(client, mock_copilot):
    """Vocab upgrade endpoint returns upgrade suggestions from LLM."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "upgrades": [
            {
                "original": "good",
                "upgraded": "excellent",
                "explanation": "More specific and impactful",
                "example": "The presentation was excellent.",
            },
            {
                "original": "big",
                "upgraded": "substantial",
                "explanation": "More formal and precise",
                "example": "There was a substantial increase in revenue.",
            },
        ]
    })
    res = await client.post("/api/pronunciation/speaking-journal/vocab-upgrade", json={
        "transcript": "I think it was a good day and we had a big meeting about the project.",
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["upgrades"]) == 2
    assert data["upgrades"][0]["original"] == "good"
    assert data["upgrades"][0]["upgraded"] == "excellent"


@pytest.mark.integration
async def test_speaking_journal_vocab_upgrade_empty_result(client, mock_copilot):
    """Vocab upgrade handles empty LLM response gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.post("/api/pronunciation/speaking-journal/vocab-upgrade", json={
        "transcript": "Hello world.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["upgrades"] == []


@pytest.mark.integration
async def test_speaking_journal_grammar_check(client, mock_copilot):
    """Grammar check endpoint returns corrections from LLM."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "grammar_score": 7.5,
        "corrections": [
            {
                "original": "I go to store yesterday",
                "corrected": "I went to the store yesterday",
                "explanation": "Past tense needed and missing article 'the'",
            },
        ],
        "overall_feedback": "Good effort, watch your verb tenses.",
    })
    res = await client.post("/api/pronunciation/speaking-journal/grammar-check", json={
        "transcript": "I go to store yesterday and buy some food.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["grammar_score"] == 7.5
    assert len(data["corrections"]) == 1
    assert data["corrections"][0]["original"] == "I go to store yesterday"
    assert data["corrections"][0]["corrected"] == "I went to the store yesterday"
    assert data["overall_feedback"] == "Good effort, watch your verb tenses."


@pytest.mark.integration
async def test_speaking_journal_grammar_check_empty(client, mock_copilot):
    """Grammar check handles empty LLM response gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.post("/api/pronunciation/speaking-journal/grammar-check", json={
        "transcript": "Hello world.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["grammar_score"] == 0.0
    assert data["corrections"] == []


@pytest.mark.integration
async def test_speaking_journal_model_answer(client, mock_copilot):
    """Model answer endpoint returns model response from LLM."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "model_answer": "I usually start my mornings with a cup of coffee while reading the news.",
        "key_phrases": ["start my mornings", "while reading"],
        "comparison_tip": "Try using more connecting phrases to link your ideas.",
    })
    res = await client.post("/api/pronunciation/speaking-journal/model-answer", json={
        "prompt": "Describe your morning routine.",
        "user_transcript": "I wake up and eat breakfast then go to work.",
    })
    assert res.status_code == 200
    data = res.json()
    assert "coffee" in data["model_answer"]
    assert len(data["key_phrases"]) == 2
    assert data["comparison_tip"] != ""


@pytest.mark.integration
async def test_speaking_journal_model_answer_empty(client, mock_copilot):
    """Model answer handles empty LLM response gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.post("/api/pronunciation/speaking-journal/model-answer", json={
        "prompt": "Tell me about your hobby.",
        "user_transcript": "I like reading books.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["model_answer"] == ""
    assert data["key_phrases"] == []


# ── Filler Word Analysis Tests ──────────────────────────


@pytest.mark.integration
async def test_filler_analysis_empty(client):
    """Filler analysis returns defaults with no entries."""
    res = await client.get("/api/pronunciation/speaking-journal/filler-analysis")
    assert res.status_code == 200
    data = res.json()
    assert data["total_entries"] == 0
    assert data["filler_breakdown"] == []
    assert data["daily_trend"] == []
    assert data["trend_direction"] == "insufficient_data"
    assert data["fluency_cleanliness_score"] == 100


@pytest.mark.integration
async def test_filler_analysis_with_entries(client):
    """Filler analysis correctly counts and ranks filler words."""
    # Entry with known filler words: "um" x2, "like" x1, "you know" x1
    await client.post("/api/pronunciation/speaking-journal", json={
        "prompt": "Describe your day",
        "transcript": "Um I went to the store and um like bought some groceries you know",
        "duration_seconds": 30,
    })
    # Entry with different fillers: "basically" x1, "actually" x1
    await client.post("/api/pronunciation/speaking-journal", json={
        "prompt": "Talk about work",
        "transcript": "Basically I work in software and actually I really enjoy coding every day",
        "duration_seconds": 30,
    })
    res = await client.get("/api/pronunciation/speaking-journal/filler-analysis")
    assert res.status_code == 200
    data = res.json()
    assert data["total_entries"] == 2
    assert len(data["filler_breakdown"]) > 0
    # "um" should be the most frequent (2 times)
    assert data["filler_breakdown"][0]["word"] == "um"
    assert data["filler_breakdown"][0]["count"] == 2
    assert data["fluency_cleanliness_score"] <= 100
    assert data["fluency_cleanliness_score"] >= 0


@pytest.mark.integration
async def test_filler_analysis_daily_trend(client):
    """Filler analysis includes daily density trend."""
    await client.post("/api/pronunciation/speaking-journal", json={
        "prompt": "Test",
        "transcript": "Um uh I think um this is uh a good day",
        "duration_seconds": 60,
    })
    res = await client.get("/api/pronunciation/speaking-journal/filler-analysis")
    assert res.status_code == 200
    data = res.json()
    assert len(data["daily_trend"]) >= 1
    trend = data["daily_trend"][0]
    assert "date" in trend
    assert "filler_count" in trend
    assert "density_per_min" in trend
    assert trend["filler_count"] >= 4  # um, uh, um, uh
    assert trend["density_per_min"] > 0


@pytest.mark.integration
async def test_filler_analysis_no_fillers(client):
    """Clean transcript results in high cleanliness score."""
    await client.post("/api/pronunciation/speaking-journal", json={
        "prompt": "Test clean speech",
        "transcript": "I went to the store and bought groceries for dinner tonight",
        "duration_seconds": 30,
    })
    res = await client.get("/api/pronunciation/speaking-journal/filler-analysis")
    assert res.status_code == 200
    data = res.json()
    assert data["fluency_cleanliness_score"] == 100
    assert data["filler_breakdown"] == []


@pytest.mark.integration
async def test_speaking_journal_prompt_default(client):
    """Default prompt returns a valid prompt string."""
    res = await client.get("/api/pronunciation/speaking-journal/prompt")
    assert res.status_code == 200
    data = res.json()
    assert "prompt" in data
    assert len(data["prompt"]) > 0


@pytest.mark.integration
async def test_speaking_journal_prompt_with_difficulty(client):
    """Difficulty parameter filters prompts to the correct pool."""
    from app.routers.pronunciation import _SPEAKING_JOURNAL_PROMPTS_BY_DIFFICULTY

    for difficulty in ("beginner", "intermediate", "advanced"):
        res = await client.get(f"/api/pronunciation/speaking-journal/prompt?difficulty={difficulty}")
        assert res.status_code == 200
        data = res.json()
        assert data["prompt"] in _SPEAKING_JOURNAL_PROMPTS_BY_DIFFICULTY[difficulty], (
            f"Prompt '{data['prompt']}' not in {difficulty} pool"
        )


@pytest.mark.integration
async def test_speaking_journal_prompt_invalid_difficulty_falls_back(client):
    """Invalid difficulty value falls back to full prompt pool."""
    res = await client.get("/api/pronunciation/speaking-journal/prompt?difficulty=expert")
    assert res.status_code == 200
    data = res.json()
    assert len(data["prompt"]) > 0


# ── Quick Listening Comprehension ───────────────────────────────


@pytest.mark.integration
async def test_quick_listening_comp_success(client, mock_copilot):
    """Quick listening comp generates a passage with question and options."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "The train to London departs at 9:15 every morning. It stops at three stations before arriving at the final destination. The journey takes approximately two hours.",
        "question": "How long does the train journey take?",
        "options": ["One hour", "Two hours", "Three hours", "Four hours"],
        "correct_index": 1,
        "explanation": "The passage states the journey takes approximately two hours.",
    })
    res = await client.get("/api/pronunciation/quick-listening-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert "passage" in data
    assert "question" in data
    assert "options" in data
    assert len(data["options"]) == 4
    assert data["correct_index"] == 1
    assert "explanation" in data
    assert data["difficulty"] == "intermediate"


@pytest.mark.integration
async def test_quick_listening_comp_beginner(client, mock_copilot):
    """Quick listening comp works with beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "I like apples. They are red and sweet.",
        "question": "What color are the apples?",
        "options": ["Green", "Red", "Yellow", "Blue"],
        "correct_index": 1,
        "explanation": "The passage says the apples are red.",
    })
    res = await client.get("/api/pronunciation/quick-listening-comp?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert len(data["options"]) == 4


@pytest.mark.integration
async def test_quick_listening_comp_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/quick-listening-comp?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.integration
async def test_quick_listening_comp_defaults_to_intermediate(client, mock_copilot):
    """No difficulty parameter defaults to intermediate."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "A passage about something.",
        "question": "A question?",
        "options": ["A", "B", "C", "D"],
        "correct_index": 0,
        "explanation": "Because A.",
    })
    res = await client.get("/api/pronunciation/quick-listening-comp")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


# ---------------------------------------------------------------------------
# Speaking journal – empty transcript / prompt validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.integration
async def test_speaking_journal_rejects_empty_transcript(client):
    """POST /speaking-journal should return 422 when transcript is empty."""
    res = await client.post("/api/pronunciation/speaking-journal", json={
        "prompt": "Tell me about your favourite hobby.",
        "transcript": "",
        "duration_seconds": 30,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_speaking_journal_rejects_empty_prompt(client):
    """POST /speaking-journal should return 422 when prompt is empty."""
    res = await client.post("/api/pronunciation/speaking-journal", json={
        "prompt": "",
        "transcript": "I like reading books.",
        "duration_seconds": 30,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_speaking_journal_accepts_valid_entry(client):
    """POST /speaking-journal should succeed with valid prompt, transcript, and duration."""
    res = await client.post("/api/pronunciation/speaking-journal", json={
        "prompt": "What did you do last weekend?",
        "transcript": "Last weekend I went hiking in the mountains.",
        "duration_seconds": 30,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["word_count"] == 8
    assert data["transcript"] == "Last weekend I went hiking in the mountains."
    assert data["prompt"] == "What did you do last weekend?"


# ---------------------------------------------------------------------------
# Listen & Paraphrase
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_prompt_success(client, mock_copilot):
    """GET /listen-paraphrase returns a sentence with topic hint."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "The weather has been unusually warm this winter.",
        "topic_hint": "weather",
    })
    res = await client.get("/api/pronunciation/listen-paraphrase?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert "sentence" in data
    assert data["sentence"] == "The weather has been unusually warm this winter."
    assert data["difficulty"] == "intermediate"
    assert data["topic_hint"] == "weather"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_prompt_beginner(client, mock_copilot):
    """GET /listen-paraphrase works with beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "I like to read books.",
        "topic_hint": "hobbies",
    })
    res = await client.get("/api/pronunciation/listen-paraphrase?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["topic_hint"] == "hobbies"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/listen-paraphrase?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_prompt_defaults_to_intermediate(client, mock_copilot):
    """No difficulty parameter defaults to intermediate."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "A sentence about something.",
        "topic_hint": "general",
    })
    res = await client.get("/api/pronunciation/listen-paraphrase")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_evaluate_success(client, mock_copilot):
    """POST /listen-paraphrase/evaluate returns scores and model paraphrase."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "meaning_score": 8,
        "grammar_score": 7,
        "vocabulary_score": 9,
        "overall_score": 8,
        "feedback": "Good job! You captured the main meaning well.",
        "model_paraphrase": "This winter, the temperatures have been higher than normal.",
    })
    res = await client.post("/api/pronunciation/listen-paraphrase/evaluate", json={
        "original_sentence": "The weather has been unusually warm this winter.",
        "user_paraphrase": "This winter the temperature is much warmer than usual.",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["meaning_score"] == 8
    assert data["grammar_score"] == 7
    assert data["vocabulary_score"] == 9
    assert data["overall_score"] == 8
    assert "feedback" in data
    assert "model_paraphrase" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "meaning_score": 15,
        "grammar_score": -2,
        "vocabulary_score": "abc",
        "overall_score": 0,
        "feedback": "Some feedback.",
        "model_paraphrase": "A paraphrase.",
    })
    res = await client.post("/api/pronunciation/listen-paraphrase/evaluate", json={
        "original_sentence": "The cat sat on the mat.",
        "user_paraphrase": "A cat was sitting on a mat.",
        "duration_seconds": 5,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["meaning_score"] == 10  # clamped from 15
    assert data["grammar_score"] == 1   # clamped from -2
    assert data["vocabulary_score"] == 5.0  # fallback for non-numeric
    assert data["overall_score"] == 1   # clamped from 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_evaluate_empty_paraphrase(client):
    """Empty paraphrase is rejected with 422."""
    res = await client.post("/api/pronunciation/listen-paraphrase/evaluate", json={
        "original_sentence": "The cat sat on the mat.",
        "user_paraphrase": "",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_paraphrase_evaluate_empty_original(client):
    """Empty original sentence is rejected with 422."""
    res = await client.post("/api/pronunciation/listen-paraphrase/evaluate", json={
        "original_sentence": "",
        "user_paraphrase": "A cat was sitting on a mat.",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


# ── Quick Register Switch ──────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_success(client, mock_copilot):
    """GET /register-switch returns a valid prompt with situation and target_register."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Ask your professor for a deadline extension.",
        "target_register": "formal",
        "context_hint": "You are emailing your university professor.",
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/register-switch?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["situation"] == "Ask your professor for a deadline extension."
    assert data["target_register"] == "formal"
    assert data["context_hint"] == "You are emailing your university professor."
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/register-switch?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_defaults_to_intermediate(client, mock_copilot):
    """No difficulty param defaults to intermediate."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Chat with a neighbor.",
        "target_register": "casual",
        "context_hint": "You are chatting with your next-door neighbor.",
    })
    res = await client.get("/api/pronunciation/register-switch")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_prompt_normalizes_register(client, mock_copilot):
    """If LLM returns unexpected register value, it defaults to neutral."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "situation": "Order coffee.",
        "target_register": "SUPER_FORMAL",
        "context_hint": "At a coffee shop.",
    })
    res = await client.get("/api/pronunciation/register-switch")
    assert res.status_code == 200
    data = res.json()
    assert data["target_register"] == "neutral"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_success(client, mock_copilot):
    """POST /register-switch/evaluate returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "register_accuracy_score": 8,
        "vocabulary_score": 7,
        "grammar_score": 9,
        "politeness_score": 8,
        "overall_score": 8,
        "feedback": "Great use of formal language.",
        "model_response": "I would be grateful if you could extend the deadline.",
    })
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask for a deadline extension.",
        "target_register": "formal",
        "transcript": "I was wondering if it would be possible to extend the deadline.",
        "duration_seconds": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["register_accuracy_score"] == 8
    assert data["vocabulary_score"] == 7
    assert data["grammar_score"] == 9
    assert data["politeness_score"] == 8
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great use of formal language."
    assert data["model_response"] == "I would be grateful if you could extend the deadline."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "register_accuracy_score": 15,
        "vocabulary_score": -3,
        "grammar_score": "abc",
        "politeness_score": 0,
        "overall_score": 12,
        "feedback": "Some feedback.",
        "model_response": "A model response.",
    })
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Decline an invitation.",
        "target_register": "casual",
        "transcript": "Nah I can't make it sorry.",
        "duration_seconds": 5,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["register_accuracy_score"] == 10  # clamped from 15
    assert data["vocabulary_score"] == 1           # clamped from -3
    assert data["grammar_score"] == 5.0            # fallback for non-numeric
    assert data["politeness_score"] == 1           # clamped from 0
    assert data["overall_score"] == 10             # clamped from 12


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_empty_transcript(client):
    """Empty transcript is rejected with 422."""
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask for help.",
        "target_register": "neutral",
        "transcript": "",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_register_switch_evaluate_invalid_register(client):
    """Invalid target_register is rejected with 422."""
    res = await client.post("/api/pronunciation/register-switch/evaluate", json={
        "situation": "Ask for help.",
        "target_register": "super_formal",
        "transcript": "Could you help me?",
        "duration_seconds": 5,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_sentence_stats_empty(client):
    """Sentence stats for an unpracticed sentence returns zeros."""
    res = await client.get("/api/pronunciation/sentence-stats", params={"text": "Never practiced."})
    assert res.status_code == 200
    data = res.json()
    assert data["attempt_count"] == 0
    assert data["best_score"] == 0
    assert data["avg_score"] == 0
    assert data["recent_scores"] == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_sentence_stats_after_attempts(client, mock_copilot):
    """Sentence stats should reflect pronunciation check results for that sentence."""
    sentence = "Hello world."
    for score in [5, 7, 9]:
        mock_copilot.ask_json = AsyncMock(return_value={
            "overall_score": score,
            "overall_feedback": "Feedback.",
            "word_feedback": [],
            "focus_areas": [],
        })
        await client.post("/api/pronunciation/check", json={
            "reference_text": sentence,
            "user_transcription": sentence,
        })

    res = await client.get("/api/pronunciation/sentence-stats", params={"text": sentence})
    assert res.status_code == 200
    data = res.json()
    assert data["attempt_count"] == 3
    assert data["best_score"] == 9.0
    assert data["avg_score"] == 7.0
    assert len(data["recent_scores"]) == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_sentence_stats_isolates_sentences(client, mock_copilot):
    """Stats for one sentence should not include attempts for another."""
    for text, score in [("Sentence A.", 8), ("Sentence B.", 4)]:
        mock_copilot.ask_json = AsyncMock(return_value={
            "overall_score": score,
            "overall_feedback": "Ok.",
            "word_feedback": [],
            "focus_areas": [],
        })
        await client.post("/api/pronunciation/check", json={
            "reference_text": text,
            "user_transcription": text,
        })

    res = await client.get("/api/pronunciation/sentence-stats", params={"text": "Sentence A."})
    assert res.status_code == 200
    data = res.json()
    assert data["attempt_count"] == 1
    assert data["best_score"] == 8.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_sentence_stats_missing_text_param(client):
    """Missing required text param should return 422."""
    res = await client.get("/api/pronunciation/sentence-stats")
    assert res.status_code == 422
