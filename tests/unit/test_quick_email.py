"""Unit tests for Quick Email Writing endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.unit
@pytest.mark.asyncio
async def test_email_scenario_returns_correct_structure(client, mock_copilot):
    """GET /email-scenario returns a scenario with required structure."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "You need to request time off from your manager.",
        "email_type": "formal",
        "required_elements": ["greeting", "dates", "reason", "closing"],
        "tone_guidance": "Be respectful and professional.",
    })
    res = await client.get("/api/pronunciation/email-scenario?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert "scenario" in data
    assert "email_type" in data
    assert "required_elements" in data
    assert "tone_guidance" in data
    assert "difficulty" in data
    assert data["difficulty"] == "advanced"
    assert data["email_type"] in ("formal", "semi-formal", "informal")
    assert isinstance(data["required_elements"], list)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_email_scenario_empty_elements_fallback(client, mock_copilot):
    """Empty required_elements from LLM gets a default fallback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Test scenario",
        "email_type": "formal",
        "required_elements": [],
        "tone_guidance": "Be polite.",
    })
    res = await client.get("/api/pronunciation/email-scenario")
    assert res.status_code == 200
    data = res.json()
    assert len(data["required_elements"]) >= 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_email_scenario_non_list_elements_fallback(client, mock_copilot):
    """Non-list required_elements from LLM gets a default fallback."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "scenario": "Test scenario",
        "email_type": "formal",
        "required_elements": "not a list",
        "tone_guidance": "Be polite.",
    })
    res = await client.get("/api/pronunciation/email-scenario")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["required_elements"], list)
    assert len(data["required_elements"]) >= 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_email_evaluate_returns_all_fields(client, mock_copilot):
    """POST /email-evaluate returns all expected fields."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "format_score": 8,
        "tone_score": 7,
        "grammar_score": 9,
        "completeness_score": 8,
        "overall_score": 8,
        "feedback": "Well structured email.",
        "missing_elements": [],
        "corrections": [],
        "model_email_subject": "Meeting Follow-up",
        "model_email_body": "Dear team, following up on our meeting...",
    })
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Follow up on a meeting.",
        "email_type": "formal",
        "required_elements": ["greeting", "summary", "closing"],
        "user_subject": "Follow Up",
        "user_body": "Dear team, I wanted to follow up on our discussion. Best, Alice",
    })
    assert res.status_code == 200
    data = res.json()
    expected_keys = [
        "format_score", "tone_score", "grammar_score", "completeness_score",
        "overall_score", "feedback", "missing_elements", "corrections",
        "model_email_subject", "model_email_body",
    ]
    for key in expected_keys:
        assert key in data, f"Missing key: {key}"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_email_evaluate_missing_required_elements_field(client):
    """Validation rejects request with empty required_elements."""
    res = await client.post("/api/pronunciation/email-evaluate", json={
        "scenario": "Test scenario.",
        "email_type": "formal",
        "required_elements": [],
        "user_subject": "Test Subject",
        "user_body": "Hello, test body.",
    })
    assert res.status_code == 422
