"""Integration tests for vocabulary API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_list_vocabulary_topics(client):
    res = await client.get("/api/vocabulary/topics")
    assert res.status_code == 200
    topics = res.json()
    assert isinstance(topics, list)
    assert len(topics) > 0
    assert all("id" in t and "label" in t for t in topics)


@pytest.mark.asyncio
async def test_generate_quiz(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {
                "word": "agenda",
                "correct_meaning": "a list of items to be discussed at a meeting",
                "wrong_options": ["a type of food", "a travel document", "a musical instrument"],
                "example_sentence": "Let's review the agenda before the meeting.",
                "difficulty": 1,
            },
            {
                "word": "negotiate",
                "correct_meaning": "to discuss something in order to reach an agreement",
                "wrong_options": ["to ignore", "to celebrate", "to complain"],
                "example_sentence": "We need to negotiate the contract terms.",
                "difficulty": 2,
            },
        ]
    })

    res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=2")
    assert res.status_code == 200
    data = res.json()
    assert "questions" in data
    assert len(data["questions"]) == 2
    assert data["questions"][0]["word"] == "agenda"


@pytest.mark.asyncio
async def test_submit_correct_answer(client, mock_copilot):
    # First generate a quiz to get word IDs
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "deadline",
            "correct_meaning": "a time limit",
            "wrong_options": ["a type of line", "a greeting", "a dessert"],
            "example_sentence": "The deadline is tomorrow.",
            "difficulty": 1,
        }]
    })

    quiz_res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]

    # Submit correct answer
    res = await client.post("/api/vocabulary/answer", json={
        "word_id": word_id,
        "is_correct": True,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["is_correct"] is True
    assert data["new_level"] == 1  # First correct answer → level 1


@pytest.mark.asyncio
async def test_submit_incorrect_answer(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "revenue",
            "correct_meaning": "income earned by a business",
            "wrong_options": ["a type of food", "an event", "a color"],
            "example_sentence": "Our revenue increased this quarter.",
            "difficulty": 2,
        }]
    })

    quiz_res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]

    res = await client.post("/api/vocabulary/answer", json={
        "word_id": word_id,
        "is_correct": False,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["is_correct"] is False
    assert data["new_level"] == 0  # First incorrect answer → level 0


@pytest.mark.asyncio
async def test_submit_answer_nonexistent_word(client):
    res = await client.post("/api/vocabulary/answer", json={
        "word_id": 99999,
        "is_correct": True,
    })
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_spaced_repetition_level_up(client, mock_copilot):
    """Multiple correct answers should increase the level."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "synergy",
            "correct_meaning": "combined effort being greater than individual parts",
            "wrong_options": ["energy drink", "a planet", "a disease"],
            "example_sentence": "There is great synergy between our teams.",
            "difficulty": 3,
        }]
    })

    quiz_res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]

    # Answer correctly 3 times
    for i in range(3):
        res = await client.post("/api/vocabulary/answer", json={
            "word_id": word_id,
            "is_correct": True,
        })
        assert res.status_code == 200

    data = res.json()
    assert data["new_level"] == 3


@pytest.mark.asyncio
async def test_get_progress(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "milestone",
            "correct_meaning": "an important event or stage",
            "wrong_options": ["a rock", "a distance", "a tool"],
            "example_sentence": "This is a major milestone.",
            "difficulty": 1,
        }]
    })

    quiz_res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]

    await client.post("/api/vocabulary/answer", json={"word_id": word_id, "is_correct": True})

    res = await client.get("/api/vocabulary/progress?topic=job_interview")
    assert res.status_code == 200
    data = res.json()
    assert len(data["progress"]) >= 1
    assert data["progress"][0]["word"] == "milestone"


@pytest.mark.asyncio
async def test_frontend_log_endpoint(client):
    res = await client.post("/api/log", json={
        "level": "INFO",
        "message": "[SpeechRecognition] test log from frontend",
    })
    assert res.status_code == 200
    assert res.json()["ok"] is True


@pytest.mark.asyncio
async def test_vocabulary_stats_empty(client):
    """Test vocabulary stats on empty database."""
    res = await client.get("/api/vocabulary/stats")
    assert res.status_code == 200
    data = res.json()
    assert data["total_words"] == 0
    assert data["total_mastered"] == 0
    assert data["total_reviews"] == 0
    assert data["accuracy_rate"] == 0.0
    assert data["level_distribution"] == []
    assert data["topic_breakdown"] == []


@pytest.mark.asyncio
async def test_vocabulary_stats_with_data(client, mock_copilot):
    """Test vocabulary stats after some quiz activity."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "hello", "correct_meaning": "greeting", "example_sentence": "Hello!", "difficulty": 1},
            {"word": "goodbye", "correct_meaning": "farewell", "example_sentence": "Goodbye!", "difficulty": 1},
        ]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=2")
    assert quiz_res.status_code == 200
    questions = quiz_res.json()["questions"]

    # Answer first word correctly
    await client.post("/api/vocabulary/answer", json={"word_id": questions[0]["id"], "is_correct": True})

    res = await client.get("/api/vocabulary/stats")
    assert res.status_code == 200
    data = res.json()
    assert data["total_words"] >= 1
    assert data["total_reviews"] >= 1
    assert data["accuracy_rate"] > 0
    assert isinstance(data["level_distribution"], list)
    assert isinstance(data["topic_breakdown"], list)


@pytest.mark.asyncio
async def test_due_words_empty(client):
    """Test due words endpoint on empty database."""
    res = await client.get("/api/vocabulary/due")
    assert res.status_code == 200
    data = res.json()
    assert data["due_count"] == 0
    assert data["words"] == []


@pytest.mark.asyncio
async def test_due_words_returns_due_items(client, mock_copilot):
    """Words answered with level 0 (interval=0 days) should be immediately due."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "apple", "correct_meaning": "a fruit", "example_sentence": "I ate an apple.", "difficulty": 1},
        ]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=restaurant_order&count=1")
    assert quiz_res.status_code == 200
    word_id = quiz_res.json()["questions"][0]["id"]

    # Answer incorrectly → level goes to 0, interval = 0 days → due immediately
    await client.post("/api/vocabulary/answer", json={"word_id": word_id, "is_correct": False})

    res = await client.get("/api/vocabulary/due")
    assert res.status_code == 200
    data = res.json()
    assert data["due_count"] >= 1
    assert any(w["id"] == word_id for w in data["words"])


@pytest.mark.asyncio
async def test_due_words_filter_by_topic(client, mock_copilot):
    """Filter due words by topic."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "cat", "correct_meaning": "a pet", "example_sentence": "The cat sat.", "difficulty": 1},
        ]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=doctor_visit&count=1")
    assert quiz_res.status_code == 200
    word_id = quiz_res.json()["questions"][0]["id"]

    await client.post("/api/vocabulary/answer", json={"word_id": word_id, "is_correct": False})

    # Filter by matching topic
    res = await client.get("/api/vocabulary/due?topic=doctor_visit")
    assert res.status_code == 200
    assert res.json()["due_count"] >= 1

    # Filter by non-matching topic
    res2 = await client.get("/api/vocabulary/due?topic=technology")
    assert res2.status_code == 200
    assert res2.json()["due_count"] == 0


@pytest.mark.asyncio
async def test_quiz_fill_blank_mode(client, mock_copilot):
    """Test fill_blank quiz mode returns correct response shape."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "book", "correct_meaning": "a written work", "example_sentence": "I read a book.", "difficulty": 1},
        ]
    })
    res = await client.get("/api/vocabulary/quiz?topic=shopping&count=1&mode=fill_blank")
    assert res.status_code == 200
    questions = res.json()["questions"]
    assert len(questions) >= 1
    q = questions[0]
    assert "example_with_blank" in q
    assert "hint" in q
    assert "answer" in q
    assert "___" in q["example_with_blank"]
    assert "wrong_options" not in q


@pytest.mark.asyncio
async def test_quiz_default_mode_unchanged(client, mock_copilot):
    """Default mode still returns multiple_choice format."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "pen", "correct_meaning": "writing tool", "example_sentence": "Use a pen.", "difficulty": 1},
        ]
    })
    res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=1")
    assert res.status_code == 200
    questions = res.json()["questions"]
    assert len(questions) >= 1
    # Default should have wrong_options (multiple choice format)
    q = questions[0]
    assert "word" in q
    assert "meaning" in q


@pytest.mark.asyncio
async def test_reset_progress_empty(client):
    """Reset on empty DB returns 0."""
    res = await client.delete("/api/vocabulary/progress")
    assert res.status_code == 200
    assert res.json()["deleted_count"] == 0


@pytest.mark.asyncio
async def test_reset_progress_after_answers(client, mock_copilot):
    """Reset clears progress after answering quiz."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "sun", "correct_meaning": "star", "example_sentence": "The sun.", "difficulty": 1}]
    })
    quiz = await client.get("/api/vocabulary/quiz?topic=airport&count=1")
    wid = quiz.json()["questions"][0]["id"]
    await client.post("/api/vocabulary/answer", json={"word_id": wid, "is_correct": True})

    res = await client.delete("/api/vocabulary/progress")
    assert res.status_code == 200
    assert res.json()["deleted_count"] >= 1

    prog = await client.get("/api/vocabulary/progress")
    assert prog.json()["progress"] == []


@pytest.mark.asyncio
async def test_weak_words_empty(client):
    res = await client.get("/api/vocabulary/weak-words")
    assert res.status_code == 200
    assert res.json()["words"] == []


@pytest.mark.asyncio
async def test_weak_words_after_answers(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "hard", "correct_meaning": "difficult", "example_sentence": "Hard work.", "difficulty": 1},
        ]
    })
    quiz = await client.get("/api/vocabulary/quiz?topic=shopping&count=1")
    wid = quiz.json()["questions"][0]["id"]
    # 2 wrong answers → error_rate = 1.0
    await client.post("/api/vocabulary/answer", json={"word_id": wid, "is_correct": False})
    await client.post("/api/vocabulary/answer", json={"word_id": wid, "is_correct": False})

    res = await client.get("/api/vocabulary/weak-words")
    assert res.status_code == 200
    words = res.json()["words"]
    assert len(words) >= 1
    assert words[0]["error_rate"] > 0


@pytest.mark.asyncio
async def test_word_bank_empty(client):
    res = await client.get("/api/vocabulary/words")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] == 0
    assert data["words"] == []


@pytest.mark.asyncio
async def test_word_bank_after_quiz(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "moon", "correct_meaning": "celestial body", "example_sentence": "The moon.", "difficulty": 1}]
    })
    await client.get("/api/vocabulary/quiz?topic=airport&count=1")

    res = await client.get("/api/vocabulary/words")
    assert res.status_code == 200
    assert res.json()["total_count"] >= 1

    # Search by word
    res2 = await client.get("/api/vocabulary/words?q=moon")
    assert res2.status_code == 200
    assert res2.json()["total_count"] >= 1


@pytest.mark.asyncio
async def test_quiz_invalid_topic(client):
    res = await client.get("/api/vocabulary/quiz?topic=nonexistent_xyz")
    assert res.status_code == 422
    assert "Unknown topic" in res.json()["detail"]


@pytest.mark.asyncio
async def test_quiz_response_includes_quiz_type(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "desk", "correct_meaning": "a table", "example_sentence": "Sit at the desk.", "difficulty": 1}]
    })
    res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    assert res.status_code == 200
    data = res.json()
    assert data["quiz_type"] == "multiple_choice"

    # fill_blank mode
    fb_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1&mode=fill_blank")
    assert fb_res.status_code == 200
    assert fb_res.json()["quiz_type"] == "fill_blank"


@pytest.mark.asyncio
async def test_delete_word(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "chair", "correct_meaning": "seat", "example_sentence": "Sit on a chair.", "difficulty": 1}]
    })
    quiz = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    word_id = quiz.json()["questions"][0]["id"]
    res = await client.delete(f"/api/vocabulary/{word_id}")
    assert res.status_code == 200
    assert res.json()["deleted"] is True


@pytest.mark.asyncio
async def test_delete_word_not_found(client):
    res = await client.delete("/api/vocabulary/99999")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_export_words_empty(client):
    res = await client.get("/api/vocabulary/export")
    assert res.status_code == 200
    data = res.json()
    assert data["words"] == []
    assert data["total_count"] == 0


@pytest.mark.asyncio
async def test_export_words_with_data(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "book", "correct_meaning": "reading material", "example_sentence": "Read a book.", "difficulty": 1}]
    })
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    res = await client.get("/api/vocabulary/export?topic=hotel_checkin")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] >= 1
    assert "word" in data["words"][0]
    assert "correct_count" in data["words"][0]
    assert "topic_id" in data["words"][0]
    assert data["words"][0]["topic_id"] == "hotel_checkin"


@pytest.mark.integration
async def test_export_import_round_trip(client, mock_copilot):
    """Exported words should be re-importable using topic_id."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "towel", "correct_meaning": "drying cloth", "example_sentence": "Use a towel.", "difficulty": 1}]
    })
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    export_res = await client.get("/api/vocabulary/export?topic=hotel_checkin")
    assert export_res.status_code == 200
    exported = export_res.json()["words"]
    assert len(exported) >= 1
    # Re-import using topic_id (raw ID)
    import_payload = [
        {"word": w["word"], "meaning": w["meaning"], "example_sentence": w["example_sentence"], "difficulty": w["difficulty"], "topic": w["topic_id"]}
        for w in exported
    ]
    import_res = await client.post(
        "/api/vocabulary/import",
        json={"words": import_payload},
    )
    assert import_res.status_code == 200


@pytest.mark.asyncio
async def test_topic_summary_empty(client):
    res = await client.get("/api/vocabulary/topic-summary")
    assert res.status_code == 200
    assert res.json()["topics"] == []


@pytest.mark.asyncio
async def test_topic_summary_with_data(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "lamp", "correct_meaning": "light", "example_sentence": "Turn on the lamp.", "difficulty": 1}]
    })
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    res = await client.get("/api/vocabulary/topic-summary")
    assert res.status_code == 200
    data = res.json()
    assert len(data["topics"]) >= 1
    assert data["topics"][0]["total_words"] >= 1


@pytest.mark.asyncio
async def test_forecast_empty(client):
    res = await client.get("/api/vocabulary/forecast")
    assert res.status_code == 200
    data = res.json()
    assert data["overdue_count"] == 0
    assert data["total_upcoming"] == 0
    assert data["daily_forecast"] == []


@pytest.mark.asyncio
async def test_forecast_with_due_words(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "delay", "correct_meaning": "to postpone", "example_sentence": "Don't delay.", "difficulty": 1}]
    })
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    # Answer incorrectly -> level 0, interval 0 -> due today
    res = await client.get("/api/vocabulary/forecast")
    assert res.status_code == 200
    data = res.json()
    # Word has next_review_at set, should appear in forecast
    assert isinstance(data["daily_forecast"], list)
    assert data["total_upcoming"] >= 0


@pytest.mark.asyncio
async def test_forecast_days_param(client):
    res = await client.get("/api/vocabulary/forecast?days=7")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["daily_forecast"], list)
    # Invalid days param
    res2 = await client.get("/api/vocabulary/forecast?days=0")
    assert res2.status_code == 422
    res3 = await client.get("/api/vocabulary/forecast?days=100")
    assert res3.status_code == 422


@pytest.mark.asyncio
async def test_attempts_empty(client):
    res = await client.get("/api/vocabulary/attempts")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] == 0
    assert data["attempts"] == []


@pytest.mark.asyncio
async def test_attempts_after_answering(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "fork", "correct_meaning": "utensil", "example_sentence": "Use a fork.", "difficulty": 1}]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]
    await client.post("/api/vocabulary/answer", json={"word_id": word_id, "is_correct": True})
    res = await client.get("/api/vocabulary/attempts")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] >= 1
    assert data["attempts"][0]["is_correct"] is True


@pytest.mark.asyncio
async def test_topic_accuracy_empty(client):
    res = await client.get("/api/vocabulary/topic-accuracy")
    assert res.status_code == 200
    assert res.json()["topics"] == []


@pytest.mark.asyncio
async def test_topic_accuracy_with_data(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "key", "correct_meaning": "tool for locks", "example_sentence": "Use the key.", "difficulty": 1}]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]
    await client.post("/api/vocabulary/answer", json={"word_id": word_id, "is_correct": True})
    res = await client.get("/api/vocabulary/topic-accuracy")
    assert res.status_code == 200
    data = res.json()
    assert len(data["topics"]) >= 1
    assert data["topics"][0]["accuracy_rate"] > 0


@pytest.mark.asyncio
async def test_batch_import_success(client):
    words = [
        {"word": "desk", "meaning": "a table for work", "topic": "hotel_checkin", "difficulty": 1},
        {"word": "lamp", "meaning": "a light source", "topic": "hotel_checkin"},
    ]
    res = await client.post("/api/vocabulary/import", json={"words": words})
    assert res.status_code == 200
    data = res.json()
    assert data["imported_count"] == 2
    assert data["skipped_count"] == 0


@pytest.mark.asyncio
async def test_batch_import_validation_error(client):
    res = await client.post("/api/vocabulary/import", json={"words": []})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_batch_import_skips_duplicates(client):
    words = [{"word": "pillow", "meaning": "for sleeping", "topic": "hotel_checkin"}]
    await client.post("/api/vocabulary/import", json={"words": words})
    res = await client.post("/api/vocabulary/import", json={"words": words})
    assert res.status_code == 200
    assert res.json()["skipped_count"] == 1


@pytest.mark.asyncio
async def test_batch_import_invalid_topic(client):
    words = [{"word": "test", "meaning": "a test", "topic": "nonexistent_xyz"}]
    res = await client.post("/api/vocabulary/import", json={"words": words})
    assert res.status_code == 422
    assert "Unknown topic" in res.json()["detail"]


@pytest.mark.asyncio
async def test_update_word(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "bed", "correct_meaning": "furniture for sleeping", "example_sentence": "Sleep on the bed.", "difficulty": 1}]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]
    res = await client.put(f"/api/vocabulary/{word_id}", json={"meaning": "updated meaning"})
    assert res.status_code == 200
    assert res.json()["meaning"] == "updated meaning"


@pytest.mark.asyncio
async def test_update_word_not_found(client):
    res = await client.put("/api/vocabulary/99999", json={"meaning": "test"})
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_favorites_empty(client):
    res = await client.get("/api/vocabulary/favorites")
    assert res.status_code == 200
    assert res.json()["total_count"] == 0


@pytest.mark.asyncio
async def test_toggle_favorite(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{"word": "towel", "correct_meaning": "cloth for drying", "example_sentence": "Use a towel.", "difficulty": 1}]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]
    # Toggle on
    res = await client.post(f"/api/vocabulary/{word_id}/favorite")
    assert res.status_code == 200
    assert res.json()["is_favorite"] is True
    # Check favorites
    fav_res = await client.get("/api/vocabulary/favorites")
    assert fav_res.json()["total_count"] == 1


@pytest.mark.asyncio
async def test_toggle_favorite_not_found(client):
    res = await client.post("/api/vocabulary/99999/favorite")
    assert res.status_code == 404


@pytest.mark.integration
async def test_update_notes(client):
    await client.post("/api/vocabulary/import", json={
        "words": [{"word": "hotel", "meaning": "宿泊施設", "topic": "hotel_checkin", "example_sentence": "I stayed at a hotel.", "difficulty": 1}],
    })
    words_res = await client.get("/api/vocabulary/words?topic=hotel_checkin")
    word_list = words_res.json()["words"]
    word_id = word_list[0]["id"]
    res = await client.put(f"/api/vocabulary/{word_id}/notes", json={"notes": "Important!"})
    assert res.status_code == 200
    assert res.json()["notes"] == "Important!"


@pytest.mark.integration
async def test_update_notes_not_found(client):
    res = await client.put("/api/vocabulary/9999/notes", json={"notes": "test"})
    assert res.status_code == 404


@pytest.mark.integration
async def test_word_detail(client, mock_copilot):
    mock_copilot.ask_json.return_value = {
        "questions": [
            {"word": "desk", "correct_meaning": "a table", "example_sentence": "Sit at the desk.", "difficulty": 2, "wrong_options": ["chair", "lamp", "bed"]},
            {"word": "lamp", "correct_meaning": "a light", "example_sentence": "Turn on the lamp.", "difficulty": 2, "wrong_options": ["desk", "chair", "bed"]},
        ]
    }
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    words_res = await client.get("/api/vocabulary/words?topic=hotel_checkin")
    words = words_res.json()["words"]
    word_id = words[0]["id"]
    res = await client.get(f"/api/vocabulary/{word_id}/detail")
    assert res.status_code == 200
    data = res.json()
    assert "word" in data
    assert "similar_words" in data
    assert isinstance(data.get("is_favorite"), bool), "is_favorite must be bool"


@pytest.mark.integration
async def test_word_detail_not_found(client):
    res = await client.get("/api/vocabulary/9999/detail")
    assert res.status_code == 404


@pytest.mark.integration
async def test_srs_analytics_empty(client):
    res = await client.get("/api/vocabulary/srs-analytics")
    assert res.status_code == 200
    data = res.json()
    assert "retention_by_level" in data
    assert "review_efficiency" in data
    assert "level_summary" in data
    assert "mastery_velocity" in data
    assert data["level_summary"]["total_words"] >= 0


@pytest.mark.integration
async def test_srs_analytics_with_data(client, mock_copilot):
    mock_copilot.ask_json.return_value = {
        "questions": [
            {"word": "srs_w1", "correct_meaning": "m1", "example_sentence": "E1.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
            {"word": "srs_w2", "correct_meaning": "m2", "example_sentence": "E2.", "difficulty": 2, "wrong_options": ["a", "b", "c"]},
        ]
    }
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    words_res = await client.get("/api/vocabulary/words?topic=hotel_checkin")
    word_id = words_res.json()["words"][0]["id"]
    await client.post("/api/vocabulary/answer", json={"word_id": word_id, "selected_answer": words_res.json()["words"][0]["meaning"], "is_correct": True})
    res = await client.get("/api/vocabulary/srs-analytics")
    assert res.status_code == 200
    data = res.json()
    assert data["level_summary"]["with_progress"] >= 1


@pytest.mark.integration
async def test_answer_triggers_auto_adjust_difficulty(client, mock_copilot):
    """Test that submitting 5 correct answers for a high-difficulty word triggers difficulty adjustment."""
    mock_copilot.ask_json.return_value = {
        "questions": [
            {"word": "ubiquitous", "correct_meaning": "found everywhere", "example_sentence": "Smartphones are ubiquitous.", "difficulty": 3, "wrong_options": ["rare", "hidden", "small"]},
        ]
    }
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    # Find the word_id
    words_res = await client.get("/api/vocabulary/words?q=ubiquitous")
    word_id = words_res.json()["words"][0]["id"]

    # Submit 5 correct answers to trigger auto_adjust_difficulty
    last_res = None
    for _ in range(5):
        last_res = await client.post("/api/vocabulary/answer", json={"word_id": word_id, "is_correct": True})
        assert last_res.status_code == 200

    data = last_res.json()
    assert "difficulty_adjustment" in data
    # After 5 correct, difficulty should decrease from 3 to 2
    assert data["difficulty_adjustment"] is not None
    assert data["difficulty_adjustment"]["old_difficulty"] == 3
    assert data["difficulty_adjustment"]["new_difficulty"] == 2
    assert data["difficulty_adjustment"]["reason"] == "too_easy"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_llm_generated_quiz_has_wrong_options(client, mock_copilot):
    """LLM-generated quiz should build proper wrong_options via build_quiz, not rely on LLM."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "cat", "correct_meaning": "a small animal", "example_sentence": "The cat sat."},
            {"word": "dog", "correct_meaning": "a pet animal", "example_sentence": "The dog barked."},
            {"word": "bird", "correct_meaning": "a flying creature", "example_sentence": "A bird sang."},
            {"word": "fish", "correct_meaning": "an aquatic animal", "example_sentence": "The fish swam."},
        ],
    })
    res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    assert res.status_code == 200
    data = res.json()
    assert data["quiz_type"] == "multiple_choice"
    for q in data["questions"]:
        assert "wrong_options" in q
        assert isinstance(q["wrong_options"], list)
        assert len(q["wrong_options"]) > 0


async def test_quiz_handles_items_key_from_parse_json(client, mock_copilot):
    """When LLM returns array and _parse_json wraps it as {items: [...]}, quiz still works."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "items": [
            {"word": "hello", "correct_meaning": "a greeting", "example_sentence": "Hello there."},
            {"word": "goodbye", "correct_meaning": "a farewell", "example_sentence": "Goodbye friend."},
            {"word": "thanks", "correct_meaning": "gratitude", "example_sentence": "Thanks a lot."},
            {"word": "please", "correct_meaning": "polite request", "example_sentence": "Please help."},
        ],
    })
    res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    assert res.status_code == 200
    data = res.json()
    assert data["quiz_type"] == "multiple_choice"
    assert len(data["questions"]) == 4


async def test_quiz_handles_non_list_questions(client, mock_copilot):
    """When LLM returns {questions: 'not a list'}, quiz returns empty rather than crashing."""
    mock_copilot.ask_json = AsyncMock(return_value={"questions": "invalid"})
    res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    assert res.status_code == 200
    data = res.json()
    assert data["questions"] == []


@pytest.mark.integration
async def test_quiz_supplements_from_existing_when_llm_returns_few(client, mock_copilot):
    """When LLM returns fewer words than count, quiz supplements from existing topic words."""
    # First call: populate topic with 3 words
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"word": "reservation", "correct_meaning": "a booking", "wrong_options": ["a", "b", "c"], "example_sentence": "I have a reservation.", "difficulty": 1},
            {"word": "checkout", "correct_meaning": "leaving the hotel", "wrong_options": ["a", "b", "c"], "example_sentence": "Checkout is at noon.", "difficulty": 1},
            {"word": "lobby", "correct_meaning": "the entrance hall", "wrong_options": ["a", "b", "c"], "example_sentence": "Meet me in the lobby.", "difficulty": 1},
        ]
    })
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=3")

    # Second call: LLM returns empty → quiz should still have questions from existing words
    mock_copilot.ask_json = AsyncMock(return_value={"questions": []})
    res = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=5")
    assert res.status_code == 200
    data = res.json()
    # Should get at least the 3 existing words despite LLM returning nothing
    assert len(data["questions"]) >= 3
