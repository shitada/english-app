"""Integration tests for word family API endpoint."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_word_family_returns_404_for_missing_word(client):
    res = await client.get("/api/vocabulary/9999/word-family")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_word_family_generates_and_caches(client, mock_copilot):
    # First create a word via quiz generation
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "improve",
            "correct_meaning": "to make better",
            "wrong_options": ["to worsen", "to ignore", "to delay"],
            "example_sentence": "We need to improve our process.",
            "difficulty": 2,
        }]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=1")
    assert quiz_res.status_code == 200
    word_id = quiz_res.json()["questions"][0]["id"]

    # Now request word family — mock LLM response
    mock_copilot.ask_json = AsyncMock(return_value={
        "forms": [
            {
                "part_of_speech": "verb",
                "form": "improve",
                "example_sentence": "We need to improve.",
                "pronunciation_tip": "im-PROOV",
            },
            {
                "part_of_speech": "noun",
                "form": "improvement",
                "example_sentence": "There was a noticeable improvement.",
                "pronunciation_tip": "im-PROOV-ment",
            },
            {
                "part_of_speech": "adjective",
                "form": "improved",
                "example_sentence": "The improved version is better.",
                "pronunciation_tip": "im-PROOVD",
            },
        ]
    })
    res = await client.get(f"/api/vocabulary/{word_id}/word-family")
    assert res.status_code == 200
    data = res.json()
    assert data["word_id"] == word_id
    assert data["word"] == "improve"
    assert len(data["forms"]) == 3
    assert data["forms"][0]["part_of_speech"] == "verb"
    assert data["forms"][1]["form"] == "improvement"

    # Second request should return cached data (no LLM call needed)
    mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("should not be called"))
    res2 = await client.get(f"/api/vocabulary/{word_id}/word-family")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["forms"]) == 3
    assert data2["forms"][0]["form"] == "improve"


@pytest.mark.asyncio
async def test_word_family_handles_llm_failure(client, mock_copilot):
    # Create a word first
    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [{
            "word": "schedule",
            "correct_meaning": "a plan of activities",
            "wrong_options": ["a tool", "a food item", "a colour"],
            "example_sentence": "Check the schedule.",
            "difficulty": 1,
        }]
    })
    quiz_res = await client.get("/api/vocabulary/quiz?topic=job_interview&count=1")
    word_id = quiz_res.json()["questions"][0]["id"]

    # LLM fails
    mock_copilot.ask_json = AsyncMock(side_effect=RuntimeError("LLM error"))
    res = await client.get(f"/api/vocabulary/{word_id}/word-family")
    assert res.status_code == 200
    data = res.json()
    assert data["word"] == "schedule"
    # Should return fallback
    assert len(data["forms"]) >= 1
    assert data["forms"][0]["form"] == "schedule"
