"""Integration tests for Quick Practice difficulty parameter across cards.

Verifies that all four updated card endpoints (quick-speak, opinion-prompt,
idiom-prompt, listen-respond-prompt) correctly accept beginner/intermediate/advanced
difficulty values — the backend contract needed by the new global difficulty selector.
"""

import pytest
from unittest.mock import AsyncMock


# ── Quick Speak ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_speak_beginner(client, mock_copilot):
    """Quick Speak prompt endpoint accepts beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "prompt": "What is your name?",
        "context_hint": "Introduce yourself simply.",
        "difficulty": "beginner",
        "suggested_phrases": ["My name is..."],
    })
    res = await client.get("/api/pronunciation/quick-speak?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert "prompt" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_quick_speak_advanced(client, mock_copilot):
    """Quick Speak prompt endpoint accepts advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "prompt": "Discuss the implications of AI on modern education.",
        "context_hint": "Consider multiple perspectives.",
        "difficulty": "advanced",
        "suggested_phrases": ["One could argue that..."],
    })
    res = await client.get("/api/pronunciation/quick-speak?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert "prompt" in data


# ── Opinion Prompt ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.integration
async def test_opinion_prompt_beginner(client, mock_copilot):
    """Opinion prompt endpoint accepts beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "question": "Do you like dogs or cats?",
        "hint": "Say which one and why.",
        "discourse_markers": ["I think", "because"],
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/opinion-prompt?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert "question" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_opinion_prompt_advanced(client, mock_copilot):
    """Opinion prompt endpoint accepts advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "question": "Should governments regulate AI development?",
        "hint": "Consider ethical, economic, and safety perspectives.",
        "discourse_markers": ["Furthermore", "On the contrary", "Notwithstanding"],
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/opinion-prompt?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert "question" in data


# ── Idiom Prompt ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_prompt_beginner(client, mock_copilot):
    """Idiom prompt endpoint accepts beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "idiom": "a piece of cake",
        "meaning": "Something very easy.",
        "example_sentence": "The test was a piece of cake.",
        "situation_prompt": "Describe something easy.",
        "difficulty": "beginner",
    })
    res = await client.get("/api/pronunciation/idiom-prompt?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert "idiom" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_idiom_prompt_advanced(client, mock_copilot):
    """Idiom prompt endpoint accepts advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "idiom": "burn the midnight oil",
        "meaning": "To work late into the night.",
        "example_sentence": "She burned the midnight oil to finish the report.",
        "situation_prompt": "Describe a time you worked late on a challenging project.",
        "difficulty": "advanced",
    })
    res = await client.get("/api/pronunciation/idiom-prompt?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert "idiom" in data


# ── Listen & Respond ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_respond_beginner(client, mock_copilot):
    """Listen & Respond prompt endpoint accepts beginner difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "question": "What is your favourite colour?",
        "difficulty": "beginner",
        "topic_hint": "Colours",
    })
    res = await client.get("/api/pronunciation/listen-respond-prompt?difficulty=beginner")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "beginner"
    assert "question" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_listen_respond_advanced(client, mock_copilot):
    """Listen & Respond prompt endpoint accepts advanced difficulty."""
    mock_copilot.ask_json = AsyncMock(return_value={
        "question": "How do you think remote work has impacted workplace culture?",
        "difficulty": "advanced",
        "topic_hint": "Workplace",
    })
    res = await client.get("/api/pronunciation/listen-respond-prompt?difficulty=advanced")
    assert res.status_code == 200
    data = res.json()
    assert data["difficulty"] == "advanced"
    assert "question" in data
