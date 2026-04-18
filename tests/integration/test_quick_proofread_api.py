"""Integration tests for Quick Proofreading API endpoints."""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_scenario_default_difficulty(client, mock_copilot):
    """Proofread scenario defaults to intermediate difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "paragraph_with_errors": "She go to the store yesterday and buyed some apples.",
        "error_count": 3,
        "topic": "Shopping",
    })
    res = await client.get("/api/pronunciation/proofread")
    assert res.status_code == 200
    data = res.json()
    assert data["paragraph_with_errors"] == "She go to the store yesterday and buyed some apples."
    assert data["error_count"] == 3
    assert data["topic"] == "Shopping"
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_scenario_with_difficulty(client, mock_copilot):
    """Proofread scenario respects difficulty parameter."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "paragraph_with_errors": "I likes cats.",
        "error_count": 2,
        "topic": "Pets",
    })
    res = await client.get("/api/pronunciation/proofread?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert data["error_count"] == 2


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_scenario_invalid_difficulty(client):
    """Invalid difficulty is rejected with 422."""
    res = await client.get("/api/pronunciation/proofread?difficulty=expert")
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_scenario_fallback_on_missing_keys(client, mock_copilot):
    """Proofread scenario returns fallback values for missing keys."""
    mock_copilot.ask_json = AsyncMock(return_value={})
    res = await client.get("/api/pronunciation/proofread")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["paragraph_with_errors"], str) and len(data["paragraph_with_errors"]) > 0
    assert data["error_count"] >= 1
    assert isinstance(data["topic"], str) and len(data["topic"]) > 0
    assert data["difficulty"] == "intermediate"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_scenario_error_count_clamped(client, mock_copilot):
    """Error count is clamped to valid range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "paragraph_with_errors": "Test paragraph.",
        "error_count": 99,
        "topic": "Test",
    })
    res = await client.get("/api/pronunciation/proofread")
    assert res.status_code == 200
    assert res.json()["error_count"] == 10


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_success(client, mock_copilot):
    """Proofread evaluation returns scores, corrections, and corrected version."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "errors_found": 2,
        "errors_missed": 1,
        "corrections": [
            {
                "original": "go",
                "user_fix": "went",
                "correct_fix": "went",
                "is_correct": True,
            },
            {
                "original": "buyed",
                "user_fix": "bought",
                "correct_fix": "bought",
                "is_correct": True,
            },
            {
                "original": "grocerries",
                "user_fix": "grocerries",
                "correct_fix": "groceries",
                "is_correct": False,
            },
        ],
        "accuracy_score": 7,
        "grammar_score": 8,
        "overall_score": 7.5,
        "feedback": "Good job! You found most errors but missed the spelling mistake.",
        "fully_corrected_version": "She went to the store yesterday and bought some groceries.",
    })
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "She go to the store yesterday and buyed some grocerries.",
        "user_corrected": "She went to the store yesterday and bought some grocerries.",
        "error_count": 3,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["errors_found"] == 2
    assert data["errors_missed"] == 1
    assert len(data["corrections"]) == 3
    assert data["corrections"][0]["is_correct"] is True
    assert data["corrections"][2]["is_correct"] is False
    assert data["accuracy_score"] == 7
    assert data["grammar_score"] == 8
    assert data["overall_score"] == 7.5
    assert "Good job" in data["feedback"]
    assert "went" in data["fully_corrected_version"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_score_clamping(client, mock_copilot):
    """Scores are clamped to 1-10 range."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "errors_found": 1,
        "errors_missed": 0,
        "corrections": [],
        "accuracy_score": 15,
        "grammar_score": -3,
        "overall_score": 0,
        "feedback": "Okay.",
        "fully_corrected_version": "Test.",
    })
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "Test paragraph with error.",
        "user_corrected": "Test paragraph with correction.",
        "error_count": 1,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["accuracy_score"] == 10
    assert data["grammar_score"] == 1
    assert data["overall_score"] == 1


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_empty_original(client):
    """Empty original paragraph is rejected."""
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "",
        "user_corrected": "Some corrected text.",
        "error_count": 2,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_empty_corrected(client):
    """Empty corrected text is rejected."""
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "Some original text.",
        "user_corrected": "",
        "error_count": 2,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_invalid_error_count(client):
    """Error count of 0 is rejected."""
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "Some original text.",
        "user_corrected": "Some corrected text.",
        "error_count": 0,
    })
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_malformed_corrections(client, mock_copilot):
    """Malformed corrections are handled gracefully."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "errors_found": 0,
        "errors_missed": 1,
        "corrections": "not a list",
        "accuracy_score": 5,
        "grammar_score": 5,
        "overall_score": 5,
        "feedback": "Needs work.",
        "fully_corrected_version": "Fixed text.",
    })
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "Test paragraph with error.",
        "user_corrected": "Test paragraph with error.",
        "error_count": 1,
    })
    assert res.status_code == 200
    assert res.json()["corrections"] == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_missing_score_keys(client, mock_copilot):
    """Missing score keys fall back to 5."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "errors_found": 0,
        "errors_missed": 0,
        "corrections": [],
        "feedback": "OK.",
        "fully_corrected_version": "Text.",
    })
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "Test paragraph.",
        "user_corrected": "Test paragraph.",
        "error_count": 1,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["accuracy_score"] == 5
    assert data["grammar_score"] == 5
    assert data["overall_score"] == 5


@pytest.mark.asyncio
@pytest.mark.integration
async def test_proofread_evaluate_no_corrections(client, mock_copilot):
    """Evaluation with no corrections returns empty corrections array."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "errors_found": 3,
        "errors_missed": 0,
        "corrections": [],
        "accuracy_score": 10,
        "grammar_score": 9,
        "overall_score": 9.5,
        "feedback": "Perfect proofreading!",
        "fully_corrected_version": "All errors corrected.",
    })
    res = await client.post("/api/pronunciation/proofread/evaluate", json={
        "original_paragraph": "Original with errors.",
        "user_corrected": "All errors corrected.",
        "error_count": 3,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["corrections"] == []
    assert data["errors_found"] == 3
    assert data["errors_missed"] == 0
    assert data["overall_score"] == 9.5
