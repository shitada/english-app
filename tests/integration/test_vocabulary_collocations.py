"""Integration tests for POST /api/vocabulary/collocations (autoresearch #661)."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock


async def _seed_words(client, topic: str, count: int = 3) -> list[int]:
    """Use the existing /quiz endpoint to populate vocabulary_words for *topic*."""
    # Patch the mock copilot via the client fixture chain — this helper
    # assumes the caller has already configured mock_copilot.ask_json to
    # return quiz questions. We just call /quiz to insert the rows.
    res = await client.get(f"/api/vocabulary/quiz?topic={topic}&count={count}")
    assert res.status_code == 200, res.text
    return [q["id"] for q in res.json()["questions"]]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_collocations_returns_items(client, mock_copilot):
    """Happy path: copilot returns valid JSON → endpoint returns parsed items."""
    # Seed 3 words for the topic.
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {
                "word": "negotiate",
                "correct_meaning": "to discuss to reach an agreement",
                "wrong_options": ["a", "b", "c"],
                "example_sentence": "We negotiate the price.",
                "difficulty": 2,
            },
            {
                "word": "deadline",
                "correct_meaning": "a time limit",
                "wrong_options": ["a", "b", "c"],
                "example_sentence": "The deadline is today.",
                "difficulty": 1,
            },
            {
                "word": "agenda",
                "correct_meaning": "list of items",
                "wrong_options": ["a", "b", "c"],
                "example_sentence": "Let's review the agenda.",
                "difficulty": 1,
            },
        ]
    })
    word_ids = await _seed_words(client, "job_interview", count=3)
    assert len(word_ids) == 3

    # Now reconfigure mock to return collocation items keyed to those IDs.
    canned_items = [
        {
            "word_id": word_ids[0],
            "word": "negotiate",
            "prompt_sentence": "They will ____ negotiate the contract terms.",
            "options": ["aggressively", "happily", "loudly", "barely"],
            "correct_index": 0,
            "explanation": "'aggressively negotiate' is a common collocation.",
        },
        {
            "word_id": word_ids[1],
            "word": "deadline",
            "prompt_sentence": "We need to ____ the deadline.",
            "options": ["meet", "buy", "drink", "open"],
            "correct_index": 0,
            "explanation": "'meet a deadline' is the standard collocation.",
        },
        {
            "word_id": word_ids[2],
            "word": "agenda",
            "prompt_sentence": "Let's ____ the agenda before we start.",
            "options": ["set", "eat", "drive", "sleep"],
            "correct_index": 0,
            "explanation": "'set the agenda' is natural.",
        },
    ]
    mock_copilot.ask_json = AsyncMock(return_value={"items": canned_items})

    res = await client.post(
        "/api/vocabulary/collocations",
        json={"topic": "job_interview", "count": 3},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert "items" in data
    assert len(data["items"]) == 3
    first = data["items"][0]
    assert first["word_id"] in word_ids
    assert "____" in first["prompt_sentence"]
    assert len(first["options"]) == 4
    assert 0 <= first["correct_index"] <= 3
    assert first["explanation"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_collocations_partial_parse(client, mock_copilot):
    """If some LLM items are malformed, only valid ones are returned (no 5xx)."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "interview",
            "correct_meaning": "a formal meeting",
            "wrong_options": ["x", "y", "z"],
            "example_sentence": "I have an interview tomorrow.",
            "difficulty": 1,
        }, {
            "word": "resume",
            "correct_meaning": "a CV",
            "wrong_options": ["x", "y", "z"],
            "example_sentence": "Send your resume.",
            "difficulty": 1,
        }]
    })
    word_ids = await _seed_words(client, "job_interview", count=2)

    # Mix one valid and one malformed (3 options instead of 4).
    mock_copilot.ask_json = AsyncMock(return_value={"items": [
        {
            "word_id": word_ids[0],
            "word": "interview",
            "prompt_sentence": "I have to ____ for an interview.",
            "options": ["prepare", "sleep", "drive", "cook"],
            "correct_index": 0,
            "explanation": "Common.",
        },
        {
            # malformed: only 3 options
            "word_id": word_ids[1],
            "word": "resume",
            "prompt_sentence": "Please ____ your resume.",
            "options": ["update", "drink", "eat"],
            "correct_index": 0,
            "explanation": "Bad.",
        },
    ]})

    res = await client.post(
        "/api/vocabulary/collocations",
        json={"topic": "job_interview", "count": 2},
    )
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["word_id"] == word_ids[0]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_collocations_llm_failure_returns_503(client, mock_copilot):
    """If safe_llm_call exhausts retries, the endpoint surfaces 503."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "checkin",
            "correct_meaning": "registering at a hotel",
            "wrong_options": ["x", "y", "z"],
            "example_sentence": "Hotel check-in is at 3.",
            "difficulty": 1,
        }]
    })
    await _seed_words(client, "hotel_checkin", count=1)

    mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("LLM down"))

    res = await client.post(
        "/api/vocabulary/collocations",
        json={"topic": "hotel_checkin", "count": 1},
    )
    assert res.status_code == 503
    assert "unavailable" in res.json()["detail"].lower()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_collocations_empty_topic_returns_404(client):
    """No saved words for the topic → 404."""
    res = await client.post(
        "/api/vocabulary/collocations",
        json={"topic": "job_interview", "count": 3},
    )
    assert res.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_collocations_invalid_topic_returns_422(client):
    res = await client.post(
        "/api/vocabulary/collocations",
        json={"topic": "nonexistent_topic_xyz", "count": 3},
    )
    assert res.status_code == 422
