"""Unit tests for Sentence Scramble endpoint."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_get_success(client, mock_copilot):
    """GET /sentence-scramble returns sentence with shuffled words."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "She has been studying English for three years.",
        "words": ["for", "been", "years", "She", "three", "has", "studying", "English"],
        "hint": "A statement about someone's long-term activity.",
        "grammar_point": "present perfect continuous",
    })
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    assert data["sentence"] == "She has been studying English for three years."
    assert len(data["words"]) == 8
    assert "She" in data["words"]
    assert "studying" in data["words"]
    assert data["hint"] == "A statement about someone's long-term activity."
    assert data["grammar_point"] == "present perfect continuous"
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_beginner_difficulty(client, mock_copilot):
    """GET /sentence-scramble with beginner returns correct difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "I like apples.",
        "words": ["apples", "I", "like"],
        "hint": "A statement about food preference.",
        "grammar_point": "simple present",
    })
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["sentence"] == "I like apples."
    assert len(data["words"]) == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_advanced_difficulty(client, mock_copilot):
    """GET /sentence-scramble with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "Had the government not intervened, the economy would have collapsed entirely.",
        "words": ["entirely", "Had", "collapsed", "the", "economy", "government", "would", "not", "have", "intervened", "the"],
        "hint": "A hypothetical scenario about economic policy.",
        "grammar_point": "third conditional with inversion",
    })
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert len(data["words"]) == 11


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_fallback_on_empty_sentence(client, mock_copilot):
    """Falls back to default when LLM returns empty sentence."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "",
        "words": [],
        "hint": "",
        "grammar_point": "",
    })
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["sentence"] == "The cat sat on the warm mat."
    assert len(data["words"]) == 7
    assert "cat" in data["words"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_fallback_on_missing_words(client, mock_copilot):
    """Falls back when words list is too short."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "Hello",
        "words": ["Hello"],
        "hint": "A greeting.",
        "grammar_point": "interjection",
    })
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    # Should fall back since only 1 word
    assert data["sentence"] == "The cat sat on the warm mat."
    assert len(data["words"]) >= 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_non_list_words(client, mock_copilot):
    """Falls back when words is not a list."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "She reads books.",
        "words": "not a list",
        "hint": "Reading activity.",
        "grammar_point": "simple present",
    })
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=intermediate")
    assert res.status_code == 200
    data = res.json()
    # Should fall back since words is not a list
    assert data["sentence"] == "The cat sat on the warm mat."


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_invalid_difficulty(client):
    """Invalid difficulty pattern is rejected."""
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_default_difficulty(client, mock_copilot):
    """Default difficulty is intermediate when not specified."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "They are going to the store.",
        "words": ["store", "are", "the", "They", "to", "going"],
        "hint": "People heading somewhere.",
        "grammar_point": "present continuous",
    })
    res = await client.get("/api/pronunciation/sentence-scramble")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "intermediate"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sentence_scramble_strips_empty_words(client, mock_copilot):
    """Empty strings in words list are stripped out."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "He runs fast.",
        "words": ["fast", "", "He", "  ", "runs"],
        "hint": "Athletic ability.",
        "grammar_point": "simple present",
    })
    res = await client.get("/api/pronunciation/sentence-scramble?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert "" not in data["words"]
    assert len(data["words"]) == 3
