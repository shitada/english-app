"""Integration tests for Quick Email Writing API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_scenario_default_difficulty(client, mock_copilot):
    """Email scenario defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Your manager asked you to confirm attendance at a team meeting.",
        "email_type": "formal",
        "required_elements": ["greeting", "confirmation", "closing"],
        "tone_guidance": "Keep a professional tone.",
    })
    res = await client.get("/api/pronunciation/email-scenario")
    assert res.status_code == 200
    data = res.json()
    assert data["scenario"] == "Your manager asked you to confirm attendance at a team meeting."
    assert data["email_type"] == "formal"
    assert len(data["required_elements"]) == 3
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_scenario_with_difficulty(client, mock_copilot):
    """Email scenario respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Write to a friend about weekend plans.",
        "email_type": "informal",
        "required_elements": ["greeting", "plans", "closing"],
        "tone_guidance": "Be casual and friendly.",
    })
    res = await client.get("/api/pronunciation/email-scenario?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["email_type"] == "informal"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_scenario_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/email-scenario?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_scenario_fallback_on_missing_keys(client, mock_copilot):
    """Email scenario returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/email-scenario")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["scenario"], str) and len(data["scenario"]) > 0
    assert data["email_type"] == "semi-formal"
    assert len(data["required_elements"]) >= 1
    assert isinstance(data["tone_guidance"], str) and len(data["tone_guidance"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_scenario_invalid_email_type_fallback(client, mock_copilot):
    """Invalid email_type falls back to semi-formal."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Test scenario",
        "email_type": "super-casual",
        "required_elements": ["greeting"],
        "tone_guidance": "Be nice.",
    })
    res = await client.get("/api/pronunciation/email-scenario")
    assert res.status_code == 200
    assert res.json()["email_type"] == "semi-formal"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_scenario_required_elements_capped_at_5(client, mock_copilot):
    """Required elements are capped at 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Test",
        "email_type": "formal",
        "required_elements": ["a", "b", "c", "d", "e", "f", "g"],
        "tone_guidance": "Test tone.",
    })
    res = await client.get("/api/pronunciation/email-scenario")
    assert res.status_code == 200
    assert len(res.json()["required_elements"]) == 5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_success(client, mock_copilot):
    """Email evaluation returns scores, corrections, and model email."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "format_score": 8,
        "tone_score": 7,
        "grammar_score": 9,
        "completeness_score": 6,
        "overall_score": 7.5,
        "feedback": "Good email! You covered most required elements.",
        "missing_elements": ["specific date"],
        "corrections": [
            {
                "original": "I want to say",
                "corrected": "I would like to mention",
                "explanation": "More formal phrasing for business emails.",
            }
        ],
        "model_email_subject": "Re: Team Meeting Confirmation",
        "model_email_body": "Dear Mr. Smith,\n\nI am writing to confirm my attendance at the meeting.\n\nBest regards,\nJohn",
    })
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Confirm attendance at a meeting.",
        "email_type": "formal",
        "required_elements": ["greeting", "confirmation", "closing"],
        "user_subject": "Meeting Confirmation",
        "user_body": "Hi, I want to say I can come to the meeting. Thanks.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["format_score"] == 8
    assert data["tone_score"] == 7
    assert data["grammar_score"] == 9
    assert data["completeness_score"] == 6
    assert data["overall_score"] == 7.5
    assert data["feedback"] == "Good email! You covered most required elements."
    assert data["missing_elements"] == ["specific date"]
    assert len(data["corrections"]) == 1
    assert data["corrections"][0]["original"] == "I want to say"
    assert data["model_email_subject"] == "Re: Team Meeting Confirmation"
    assert "Dear Mr. Smith" in data["model_email_body"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "format_score": 15,
        "tone_score": -3,
        "grammar_score": 0.5,
        "completeness_score": 11,
        "overall_score": 0,
        "feedback": "Okay.",
        "missing_elements": [],
        "corrections": [],
        "model_email_subject": "Test",
        "model_email_body": "Test body.",
    })
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Test scenario.",
        "email_type": "formal",
        "required_elements": ["greeting"],
        "user_subject": "Test Subject",
        "user_body": "Hello, this is a test email body.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["format_score"] == 10
    assert data["tone_score"] == 1
    assert data["grammar_score"] == 1
    assert data["completeness_score"] == 10
    assert data["overall_score"] == 1


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_empty_subject(client):
    """Empty subject is rejected."""
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Test scenario.",
        "email_type": "formal",
        "required_elements": ["greeting"],
        "user_subject": "",
        "user_body": "Hello, test body.",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_empty_body(client):
    """Empty body is rejected."""
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Test scenario.",
        "email_type": "formal",
        "required_elements": ["greeting"],
        "user_subject": "Test Subject",
        "user_body": "",
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_no_corrections(client, mock_copilot):
    """Evaluation with no corrections returns empty corrections array."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "format_score": 9,
        "tone_score": 9,
        "grammar_score": 9,
        "completeness_score": 9,
        "overall_score": 9,
        "feedback": "Excellent email!",
        "missing_elements": [],
        "corrections": [],
        "model_email_subject": "Perfect Subject",
        "model_email_body": "Perfect body.",
    })
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Write a thank you email.",
        "email_type": "semi-formal",
        "required_elements": ["greeting", "thanks", "closing"],
        "user_subject": "Thank You",
        "user_body": "Dear Team, Thank you for the wonderful support. Best, John",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["corrections"] == []
    assert data["missing_elements"] == []
    assert data["overall_score"] == 9


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_malformed_corrections(client, mock_copilot):
    """Malformed corrections are handled gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "format_score": 7,
        "tone_score": 7,
        "grammar_score": 7,
        "completeness_score": 7,
        "overall_score": 7,
        "feedback": "Good!",
        "missing_elements": [],
        "corrections": "not a list",
        "model_email_subject": "Test",
        "model_email_body": "Test body.",
    })
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Test scenario.",
        "email_type": "formal",
        "required_elements": ["greeting"],
        "user_subject": "Test Subject",
        "user_body": "Hello, this is a test email body.",
    })
    assert res.status_code == 200
    assert res.json()["corrections"] == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_missing_score_keys(client, mock_copilot):
    """Missing score keys fall back to 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "feedback": "Okay.",
        "model_email_subject": "Subject",
        "model_email_body": "Body.",
    })
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Test scenario.",
        "email_type": "formal",
        "required_elements": ["greeting"],
        "user_subject": "Test Subject",
        "user_body": "Hello, this is a test email body.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["format_score"] == 5
    assert data["tone_score"] == 5
    assert data["grammar_score"] == 5
    assert data["completeness_score"] == 5
    assert data["overall_score"] == 5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_email_evaluate_malformed_missing_elements(client, mock_copilot):
    """Malformed missing_elements are handled gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "format_score": 6,
        "tone_score": 6,
        "grammar_score": 6,
        "completeness_score": 6,
        "overall_score": 6,
        "feedback": "OK.",
        "missing_elements": "not a list",
        "corrections": [],
        "model_email_subject": "Test",
        "model_email_body": "Test body.",
    })
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Test scenario.",
        "email_type": "formal",
        "required_elements": ["greeting"],
        "user_subject": "Test Subject",
        "user_body": "Hello, this is a test email body.",
    })
    assert res.status_code == 200
    assert res.json()["missing_elements"] == []
