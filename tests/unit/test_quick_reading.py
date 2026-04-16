"""Unit tests for Quick Reading Comprehension endpoint."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_success(client, mock_copilot):
    """GET /reading-comp returns passage, question, options, correct_index, explanation."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "Maria goes to the bakery every morning. She buys fresh bread and a coffee. The bakery is on Main Street near the park.",
        "question": "Where is the bakery located?",
        "options": ["Near the school", "On Main Street near the park", "Next to the hospital", "At the train station"],
        "correct_index": 1,
        "explanation": "The passage states the bakery is on Main Street near the park.",
    })
    res = await client.get("/api/pronunciation/reading-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["passage"] == "Maria goes to the bakery every morning. She buys fresh bread and a coffee. The bakery is on Main Street near the park."
    assert data["question"] == "Where is the bakery located?"
    assert len(data["options"]) == 4
    assert data["options"][1] == "On Main Street near the park"
    assert data["correct_index"] == 1
    assert "Main Street" in data["explanation"]
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "A short passage.",
        "question": "What is this?",
        "options": ["A", "B", "C", "D"],
        "correct_index": 0,
        "explanation": "Because A.",
    })
    res = await client.get("/api/pronunciation/reading-comp")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_beginner_difficulty(client, mock_copilot):
    """Beginner difficulty is accepted and returned."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "The cat sits on the mat.",
        "question": "Where does the cat sit?",
        "options": ["On the mat", "On the table", "On the chair", "On the floor"],
        "correct_index": 0,
        "explanation": "The passage says the cat sits on the mat.",
    })
    res = await client.get("/api/pronunciation/reading-comp?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_advanced_difficulty(client, mock_copilot):
    """Advanced difficulty is accepted and returned."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "The unprecedented economic downturn forced many corporations to restructure.",
        "question": "What caused corporations to restructure?",
        "options": ["A new law", "The economic downturn", "Consumer demand", "Technology changes"],
        "correct_index": 1,
        "explanation": "The passage mentions the economic downturn as the cause.",
    })
    res = await client.get("/api/pronunciation/reading-comp?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/reading-comp?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_pads_options_if_fewer_than_4(client, mock_copilot):
    """Options are padded to 4 if LLM returns fewer."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "A short story.",
        "question": "What is it?",
        "options": ["A story", "A poem"],
        "correct_index": 0,
        "explanation": "It is a story.",
    })
    res = await client.get("/api/pronunciation/reading-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["options"]) == 4
    assert data["options"][0] == "A story"
    assert data["options"][1] == "A poem"
    assert data["options"][2] == ""
    assert data["options"][3] == ""


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_truncates_options_if_more_than_4(client, mock_copilot):
    """Options are truncated to 4 if LLM returns more."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "A passage.",
        "question": "A question?",
        "options": ["A", "B", "C", "D", "E", "F"],
        "correct_index": 2,
        "explanation": "Because C.",
    })
    res = await client.get("/api/pronunciation/reading-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert len(data["options"]) == 4
    assert data["options"] == ["A", "B", "C", "D"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_clamps_correct_index(client, mock_copilot):
    """correct_index is clamped to 0-3."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "A passage.",
        "question": "A question?",
        "options": ["A", "B", "C", "D"],
        "correct_index": 10,
        "explanation": "Explanation.",
    })
    res = await client.get("/api/pronunciation/reading-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["correct_index"] == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_invalid_correct_index_fallback(client, mock_copilot):
    """Non-integer correct_index falls back to 0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "passage": "A passage.",
        "question": "A question?",
        "options": ["A", "B", "C", "D"],
        "correct_index": "not_a_number",
        "explanation": "Explanation.",
    })
    res = await client.get("/api/pronunciation/reading-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["correct_index"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_llm_failure(client, mock_copilot):
    """LLM failure returns 502."""
    from fastapi import HTTPException
    mock_copilot.ask_json = AsyncMock(side_effect=HTTPException(status_code=502, detail="LLM error"))
    res = await client.get("/api/pronunciation/reading-comp?difficulty=intermediate")
    assert res.status_code == 502


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reading_comp_missing_fields_fallback(client, mock_copilot):
    """Missing fields from LLM are handled with defaults."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/reading-comp?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["passage"] == ""
    assert data["question"] == ""
    assert len(data["options"]) == 4
    assert data["correct_index"] == 0
    assert data["explanation"] == ""
    assert data["difficulty"] == "intermediate"
