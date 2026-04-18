"""Integration tests for synonym swap practice API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_prompt_default_difficulty(client, mock_copilot):
    """Synonym swap prompt defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "The teacher gave a brief explanation of the topic.",
        "target_word": "brief",
        "context_hint": "Think about words meaning short or concise.",
        "example_synonyms": ["short", "concise", "succinct"],
        "difficulty": "intermediate",
    })
    res = await client.get("/api/pronunciation/synonym-swap")
    assert res.status_code == 200
    data = res.json()
    assert data["sentence"] == "The teacher gave a brief explanation of the topic."
    assert data["target_word"] == "brief"
    assert data["context_hint"] == "Think about words meaning short or concise."
    assert data["example_synonyms"] == ["short", "concise", "succinct"]
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_prompt_with_difficulty(client, mock_copilot):
    """Synonym swap prompt respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "The cat is very big.",
        "target_word": "big",
        "context_hint": "Think about size words.",
        "example_synonyms": ["large", "huge", "giant"],
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/synonym-swap?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["target_word"] == "big"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_prompt_advanced_difficulty(client, mock_copilot):
    """Synonym swap prompt works with advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "The politician's rhetoric was deliberately ambiguous.",
        "target_word": "ambiguous",
        "context_hint": "Consider words meaning unclear or open to interpretation.",
        "example_synonyms": ["equivocal", "vague", "cryptic"],
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/synonym-swap?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_prompt_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/synonym-swap?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_prompt_fallback_on_missing_keys(client, mock_copilot):
    """Synonym swap prompt returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/synonym-swap")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["sentence"], str) and len(data["sentence"]) > 0
    assert isinstance(data["target_word"], str) and len(data["target_word"]) > 0
    assert isinstance(data["context_hint"], str) and len(data["context_hint"]) > 0
    assert isinstance(data["example_synonyms"], list) and len(data["example_synonyms"]) >= 3
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_prompt_non_list_synonyms_fallback(client, mock_copilot):
    """Non-list example_synonyms falls back to defaults."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "sentence": "She is a happy person.",
        "target_word": "happy",
        "context_hint": "Think about positive emotion words.",
        "example_synonyms": "not-a-list",
    })
    res = await client.get("/api/pronunciation/synonym-swap")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["example_synonyms"], list)
    assert len(data["example_synonyms"]) >= 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_evaluate_success(client, mock_copilot):
    """Synonym swap evaluation returns scores and feedback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "synonym_accuracy_score": 8,
        "context_fit_score": 9,
        "grammar_score": 10,
        "overall_score": 9,
        "feedback": "Excellent synonym choice! 'Concise' fits perfectly here.",
        "suggested_synonyms": ["short", "succinct", "terse"],
    })
    res = await client.post("/api/pronunciation/synonym-swap/evaluate", json={
        "original_sentence": "The teacher gave a brief explanation.",
        "target_word": "brief",
        "user_transcript": "The teacher gave a concise explanation.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["synonym_accuracy_score"] == 8
    assert data["context_fit_score"] == 9
    assert data["grammar_score"] == 10
    assert data["overall_score"] == 9
    assert data["feedback"] == "Excellent synonym choice! 'Concise' fits perfectly here."
    assert data["suggested_synonyms"] == ["short", "succinct", "terse"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "synonym_accuracy_score": 15,
        "context_fit_score": -2,
        "grammar_score": 0,
        "overall_score": 100,
        "feedback": "Good try!",
        "suggested_synonyms": ["word1"],
    })
    res = await client.post("/api/pronunciation/synonym-swap/evaluate", json={
        "original_sentence": "She is happy.",
        "target_word": "happy",
        "user_transcript": "She is glad.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["synonym_accuracy_score"] == 10
    assert data["context_fit_score"] == 1
    assert data["grammar_score"] == 1
    assert data["overall_score"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_evaluate_validation_empty_sentence(client):
    """Empty original sentence is rejected."""
    res = await client.post("/api/pronunciation/synonym-swap/evaluate", json={
        "original_sentence": "",
        "target_word": "happy",
        "user_transcript": "She is glad.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_evaluate_validation_empty_target(client):
    """Empty target word is rejected."""
    res = await client.post("/api/pronunciation/synonym-swap/evaluate", json={
        "original_sentence": "She is happy.",
        "target_word": "",
        "user_transcript": "She is glad.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_evaluate_validation_empty_transcript(client):
    """Empty user transcript is rejected."""
    res = await client.post("/api/pronunciation/synonym-swap/evaluate", json={
        "original_sentence": "She is happy.",
        "target_word": "happy",
        "user_transcript": "",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_evaluate_non_numeric_scores_fallback(client, mock_copilot):
    """Non-numeric scores fall back to 5.0."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "synonym_accuracy_score": "great",
        "context_fit_score": None,
        "grammar_score": "excellent",
        "overall_score": "impressive",
        "feedback": "Nice work!",
        "suggested_synonyms": ["alt1", "alt2"],
    })
    res = await client.post("/api/pronunciation/synonym-swap/evaluate", json={
        "original_sentence": "The dog is fast.",
        "target_word": "fast",
        "user_transcript": "The dog is quick.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["synonym_accuracy_score"] == 5.0
    assert data["context_fit_score"] == 5.0
    assert data["grammar_score"] == 5.0
    assert data["overall_score"] == 5.0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_synonym_swap_evaluate_non_list_suggested_synonyms(client, mock_copilot):
    """Non-list suggested_synonyms returns empty list."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "synonym_accuracy_score": 7,
        "context_fit_score": 7,
        "grammar_score": 8,
        "overall_score": 7,
        "feedback": "Good choice!",
        "suggested_synonyms": "not-a-list",
    })
    res = await client.post("/api/pronunciation/synonym-swap/evaluate", json={
        "original_sentence": "She is happy.",
        "target_word": "happy",
        "user_transcript": "She is glad.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["suggested_synonyms"] == []
