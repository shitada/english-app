"""Integration tests for collocation drill API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_drill_default_params(client, mock_copilot):
    """Collocation drill returns exercises with default parameters."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "exercises": [
            {
                "base_word": "make",
                "correct_collocation": "make a decision",
                "wrong_collocations": ["do a decision", "take a decision", "have a decision"],
                "category": "verb+noun",
                "explanation": "'Make a decision' is the natural English collocation.",
            },
            {
                "base_word": "heavy",
                "correct_collocation": "heavy rain",
                "wrong_collocations": ["strong rain", "big rain", "thick rain"],
                "category": "adjective+noun",
                "explanation": "'Heavy rain' is the standard way to describe intense rainfall.",
            },
        ],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/collocation-drill")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"
    assert len(data["exercises"]) == 2
    ex = data["exercises"][0]
    assert ex["base_word"] == "make"
    assert ex["correct_collocation"] == "make a decision"
    assert len(ex["wrong_collocations"]) == 3
    assert ex["category"] == "verb+noun"
    assert ex["explanation"] == "'Make a decision' is the natural English collocation."


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_drill_with_difficulty_and_count(client, mock_copilot):
    """Collocation drill respects difficulty and count parameters."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "exercises": [
            {
                "base_word": "catch",
                "correct_collocation": "catch a cold",
                "wrong_collocations": ["get a cold", "take a cold", "have a cold"],
                "category": "verb+noun",
                "explanation": "'Catch a cold' is the natural collocation.",
            },
        ],
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/collocation-drill?difficulty=beginner&count=1")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert len(data["exercises"]) == 1
    assert data["exercises"][0]["base_word"] == "catch"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_drill_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/collocation-drill?difficulty=invalid")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_drill_pads_wrong_collocations(client, mock_copilot):
    """Missing distractors are padded to 3."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "exercises": [
            {
                "base_word": "pay",
                "correct_collocation": "pay attention",
                "wrong_collocations": ["give attention"],
                "category": "verb+noun",
                "explanation": "We say 'pay attention' in English.",
            },
        ],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/collocation-drill")
    assert res.status_code == 200
    data = res.json()
    ex = data["exercises"][0]
    assert len(ex["wrong_collocations"]) == 3
    assert ex["wrong_collocations"][0] == "give attention"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_drill_fallback_on_empty_llm(client, mock_copilot):
    """Empty LLM response returns empty exercises list."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/collocation-drill")
    assert res.status_code == 200
    data = res.json()
    assert data["exercises"] == []
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_evaluate_correct(client, mock_copilot):
    """Correct collocation choice returns is_correct=True."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "is_correct": True,
        "explanation": "'Make a decision' is the natural English collocation because 'make' pairs with abstract outcomes.",
        "example_sentence": "She had to make a decision about her career path.",
    })
    res = await client.post("/api/pronunciation/collocation-drill/evaluate", json={
        "base_word": "make",
        "correct_collocation": "make a decision",
        "user_choice": "make a decision",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["is_correct"] is True
    assert "explanation" in data
    assert "example_sentence" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_evaluate_incorrect(client, mock_copilot):
    """Incorrect collocation choice returns is_correct=False."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "is_correct": False,
        "explanation": "'Do a decision' is not natural in English. We say 'make a decision'.",
        "example_sentence": "She had to make a decision about her career path.",
    })
    res = await client.post("/api/pronunciation/collocation-drill/evaluate", json={
        "base_word": "make",
        "correct_collocation": "make a decision",
        "user_choice": "do a decision",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["is_correct"] is False
    assert len(data["explanation"]) > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_collocation_evaluate_empty_fields_rejected(client):
    """Empty base_word or user_choice is rejected with 422."""
    res = await client.post("/api/pronunciation/collocation-drill/evaluate", json={
        "base_word": "",
        "correct_collocation": "make a decision",
        "user_choice": "do a decision",
    })
    assert res.status_code == 422

    res2 = await client.post("/api/pronunciation/collocation-drill/evaluate", json={
        "base_word": "make",
        "correct_collocation": "make a decision",
        "user_choice": "",
    })
    assert res2.status_code == 422
