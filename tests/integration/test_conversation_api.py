"""Integration tests for conversation API endpoints."""

import json
import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_list_topics(client):
    res = await client.get("/api/conversation/topics")
    assert res.status_code == 200
    topics = res.json()
    assert isinstance(topics, list)
    assert len(topics) > 0
    assert all("id" in t and "label" in t for t in topics)


@pytest.mark.asyncio
async def test_start_conversation(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hi! What kind of business do you work in?")

    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert res.status_code == 200
    data = res.json()
    assert "conversation_id" in data
    assert data["conversation_id"] > 0
    assert "message" in data
    assert data["topic"] == "hotel_checkin"
    mock_copilot.ask.assert_called_once()


@pytest.mark.asyncio
async def test_send_message(client, mock_copilot):
    # Start a conversation first
    mock_copilot.ask = AsyncMock(return_value="Welcome! Let's talk about business.")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Send a message
    mock_copilot.ask = AsyncMock(return_value="That sounds interesting! Tell me more.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I work in technology.",
        "is_correct": True,
        "errors": [],
        "suggestions": [
            {"original": "I work in technology", "better": "I work in the tech industry", "explanation": "More natural"}
        ],
    })

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I work in technology.",
    })
    assert res.status_code == 200
    data = res.json()
    assert "message" in data
    assert "feedback" in data
    assert data["feedback"]["is_correct"] is True


@pytest.mark.asyncio
async def test_send_message_invalid_conversation(client):
    res = await client.post("/api/conversation/message", json={
        "conversation_id": 99999,
        "content": "Hello",
    })
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_end_conversation(client, mock_copilot):
    # Start conversation
    mock_copilot.ask = AsyncMock(return_value="Let's chat!")
    start_res = await client.post("/api/conversation/start", json={"topic": "restaurant_order"})
    conv_id = start_res.json()["conversation_id"]

    # End it
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Brief conversation about daily life.",
        "key_vocabulary": ["chat", "daily"],
        "communication_level": "intermediate",
        "tip": "Try using more varied vocabulary.",
    })

    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 200
    data = res.json()
    assert "summary" in data
    assert data["summary"]["communication_level"] == "intermediate"


@pytest.mark.asyncio
async def test_end_already_ended_conversation(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hi!")
    start_res = await client.post("/api/conversation/start", json={"topic": "airport"})
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Short conversation.",
        "key_vocabulary": [],
        "communication_level": "beginner",
        "tip": "Practice more.",
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Try ending again — should be 409 (conflict), not 404
    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 409


@pytest.mark.integration
async def test_end_nonexistent_conversation(client):
    """Ending a conversation that doesn't exist should return 404."""
    res = await client.post("/api/conversation/end", json={"conversation_id": 99999})
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_end_conversation_skip_summary(client, mock_copilot):
    """Ending with skip_summary=true should skip LLM call and use fallback summary."""
    mock_copilot.ask = AsyncMock(return_value="Let's chat!")
    start_res = await client.post("/api/conversation/start", json={"topic": "restaurant_order"})
    conv_id = start_res.json()["conversation_id"]

    # ask_json should NOT be called when skip_summary=true
    mock_copilot.ask_json = AsyncMock(side_effect=AssertionError("LLM should not be called"))

    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id, "skip_summary": True})
    assert res.status_code == 200
    data = res.json()
    assert "summary" in data
    assert data["summary"]["note"] == "Session ended without summary"
    assert data["summary"]["key_vocabulary"] == []
    assert data["summary"]["communication_level"] == "unknown"

    # Verify conversation is actually ended (second end should fail)
    res2 = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res2.status_code == 409


@pytest.mark.asyncio
async def test_get_history(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hello! How are you?")
    start_res = await client.post("/api/conversation/start", json={"topic": "restaurant_order"})
    conv_id = start_res.json()["conversation_id"]

    res = await client.get(f"/api/conversation/{conv_id}/history")
    assert res.status_code == 200
    data = res.json()
    assert "messages" in data
    # Verify messages include id and is_bookmarked fields
    if data["messages"]:
        msg = data["messages"][0]
        assert "id" in msg
        assert "is_bookmarked" in msg
        assert isinstance(msg["id"], int)


@pytest.mark.integration
async def test_history_shows_bookmark_status(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    # Get history to find message id
    hist = await client.get(f"/api/conversation/{conv_id}/history")
    msg_id = hist.json()["messages"][0]["id"]
    # Bookmark it
    await client.put(f"/api/conversation/messages/{msg_id}/bookmark")
    # Verify history reflects bookmark
    hist2 = await client.get(f"/api/conversation/{conv_id}/history")
    bookmarked = [m for m in hist2.json()["messages"] if m["id"] == msg_id]
    assert bookmarked[0]["is_bookmarked"] is True


@pytest.mark.asyncio
async def test_history_messages_always_have_feedback_key(client, mock_copilot):
    """All messages should have 'feedback' key (None if no feedback)."""
    mock_copilot.ask = AsyncMock(return_value="Welcome to the hotel!")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = res.json()["conversation_id"]
    hist = await client.get(f"/api/conversation/{conv_id}/history")
    messages = hist.json()["messages"]
    assert len(messages) >= 1
    for msg in messages:
        assert "feedback" in msg, "All messages must have 'feedback' key"
        assert isinstance(msg["is_bookmarked"], bool), "is_bookmarked must be bool"


@pytest.mark.asyncio
async def test_start_conversation_with_difficulty(client, mock_copilot):
    """Test that difficulty parameter is accepted and stored."""
    mock_copilot.ask = AsyncMock(return_value="Hello! Let's practice!")

    for diff in ["beginner", "intermediate", "advanced"]:
        res = await client.post(
            "/api/conversation/start",
            json={"topic": "hotel_checkin", "difficulty": diff},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["conversation_id"] > 0


@pytest.mark.asyncio
async def test_start_conversation_invalid_difficulty(client):
    """Test that invalid difficulty returns 422."""
    res = await client.post(
        "/api/conversation/start",
        json={"topic": "hotel_checkin", "difficulty": "expert"},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_start_conversation_default_difficulty(client, mock_copilot):
    """Test that omitting difficulty defaults to intermediate."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert res.status_code == 200
    assert res.json()["conversation_id"] > 0


@pytest.mark.asyncio
async def test_list_conversations_empty(client):
    """Test listing conversations when none exist."""
    res = await client.get("/api/conversation/list")
    assert res.status_code == 200
    data = res.json()
    assert data["conversations"] == []
    assert data["total_count"] == 0
    assert data["has_more"] is False


@pytest.mark.asyncio
async def test_list_conversations_after_creating(client, mock_copilot):
    """Test listing conversations returns created conversations."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    await client.post("/api/conversation/start", json={"topic": "shopping"})
    res = await client.get("/api/conversation/list")
    assert res.status_code == 200
    data = res.json()
    assert len(data["conversations"]) == 2
    assert data["total_count"] == 2
    assert data["has_more"] is False


@pytest.mark.asyncio
async def test_list_conversations_filter_by_topic(client, mock_copilot):
    """Test filtering conversation list by topic."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    await client.post("/api/conversation/start", json={"topic": "shopping"})
    res = await client.get("/api/conversation/list?topic=hotel_checkin")
    assert res.status_code == 200
    data = res.json()
    assert len(data["conversations"]) == 1
    assert data["conversations"][0]["topic"] == "Hotel Check-in"


@pytest.mark.asyncio
async def test_send_message_grammar_check_failure_is_non_fatal(client, mock_copilot):
    """Test that grammar check failure doesn't kill the conversation response."""
    # Start a conversation
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Grammar check fails, but conversation response succeeds
    mock_copilot.ask = AsyncMock(return_value="That sounds great!")
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("Grammar LLM timeout"))

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I want to check in.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["message"] == "That sounds great!"
    assert data["feedback"] is None


@pytest.mark.asyncio
async def test_get_summary_after_end(client, mock_copilot):
    """Test that summary is persisted and retrievable after ending conversation."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    summary_data = {
        "summary": "Brief hotel check-in conversation.",
        "key_vocabulary": ["check-in", "reservation"],
        "communication_level": "intermediate",
        "tip": "Try using more polite phrases.",
    }
    mock_copilot.ask_json = AsyncMock(return_value=summary_data)
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Retrieve the stored summary
    res = await client.get(f"/api/conversation/{conv_id}/summary")
    assert res.status_code == 200
    data = res.json()
    assert data["summary"]["communication_level"] == "intermediate"
    assert "check-in" in data["summary"]["key_vocabulary"]


@pytest.mark.asyncio
async def test_get_summary_not_found(client):
    """Test that summary returns 404 for nonexistent conversation."""
    res = await client.get("/api/conversation/99999/summary")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_conversation(client, mock_copilot):
    """Test deleting an existing conversation."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    res = await client.delete(f"/api/conversation/{conv_id}")
    assert res.status_code == 200
    assert res.json()["deleted"] is True

    # Verify it's gone
    list_res = await client.get("/api/conversation/list")
    ids = [c["id"] for c in list_res.json()["conversations"]]
    assert conv_id not in ids


@pytest.mark.asyncio
async def test_delete_nonexistent_conversation(client):
    """Test deleting a nonexistent conversation returns 404."""
    res = await client.delete("/api/conversation/99999")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_clear_ended_conversations(client, mock_copilot):
    """Test clearing all ended conversations."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Test.", "key_vocabulary": [], "communication_level": "beginner", "tip": "Practice.",
    })

    # Create and end 2 conversations, leave 1 active
    for _ in range(2):
        start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
        cid = start_res.json()["conversation_id"]
        await client.post("/api/conversation/end", json={"conversation_id": cid})

    await client.post("/api/conversation/start", json={"topic": "shopping"})

    res = await client.delete("/api/conversation/clear/ended")
    assert res.status_code == 200
    assert res.json()["deleted_count"] == 2

    # Active conversation should remain
    list_res = await client.get("/api/conversation/list")
    conversations = list_res.json()["conversations"]
    assert len(conversations) == 1
    assert conversations[0]["topic"] == "Shopping"


@pytest.mark.asyncio
async def test_start_conversation_invalid_topic(client):
    res = await client.post("/api/conversation/start", json={
        "topic": "nonexistent_topic", "difficulty": "beginner",
    })
    assert res.status_code == 422
    assert "Unknown topic" in res.json()["detail"]


@pytest.mark.asyncio
async def test_message_content_too_long(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin", "difficulty": "beginner"
    })
    cid = start.json()["conversation_id"]
    long_content = "x" * 2001
    res = await client.post("/api/conversation/message", json={
        "conversation_id": cid, "content": long_content
    })
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_export_conversation(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome to the hotel!")
    start = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin", "difficulty": "beginner"
    })
    cid = start.json()["conversation_id"]
    mock_copilot.ask = AsyncMock(return_value="Your room is 205.")
    await client.post("/api/conversation/message", json={
        "conversation_id": cid, "content": "I'd like to check in"
    })
    res = await client.get(f"/api/conversation/{cid}/export")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == cid
    assert data["topic"] == "Hotel Check-in"
    assert data["difficulty"] == "beginner"
    assert data["status"] == "active"
    assert len(data["messages"]) >= 2  # assistant greeting + user + assistant reply


@pytest.mark.asyncio
async def test_export_nonexistent_conversation(client):
    res = await client.get("/api/conversation/99999/export")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_export_ended_conversation_with_summary(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hi there!")
    start = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin", "difficulty": "intermediate"
    })
    cid = start.json()["conversation_id"]
    mock_copilot.ask_json = AsyncMock(return_value={
        "overall_score": 8, "feedback": "Great conversation"
    })
    await client.post("/api/conversation/end", json={"conversation_id": cid})
    res = await client.get(f"/api/conversation/{cid}/export")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ended"
    assert data["ended_at"] is not None
    assert data["summary"] is not None


@pytest.mark.asyncio
async def test_list_conversations_pagination_metadata(client, mock_copilot):
    """Test pagination metadata with limit/offset."""
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    for _ in range(3):
        await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    # First page
    res1 = await client.get("/api/conversation/list?limit=2&offset=0")
    data1 = res1.json()
    assert len(data1["conversations"]) == 2
    assert data1["total_count"] == 3
    assert data1["has_more"] is True
    # Second page
    res2 = await client.get("/api/conversation/list?limit=2&offset=2")
    data2 = res2.json()
    assert len(data2["conversations"]) == 1
    assert data2["total_count"] == 3
    assert data2["has_more"] is False


@pytest.mark.asyncio
async def test_list_conversations_search_by_keyword(client, mock_copilot):
    """Test searching conversations by keyword in message content."""
    mock_copilot.ask = AsyncMock(return_value="Welcome to the hotel!")
    await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    mock_copilot.ask = AsyncMock(return_value="Welcome to the shop!")
    await client.post("/api/conversation/start", json={"topic": "shopping"})
    # Search for "hotel" - should match assistant greeting
    res = await client.get("/api/conversation/list?keyword=hotel")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] >= 1
    assert all("Hotel Check-in" == c["topic"] for c in data["conversations"])


@pytest.mark.integration
async def test_grammar_accuracy_empty(client):
    res = await client.get("/api/conversation/grammar-accuracy")
    assert res.status_code == 200
    data = res.json()
    assert data["total_checked"] == 0
    assert data["overall_accuracy_rate"] == 0.0
    assert data["by_topic"] == []


@pytest.mark.integration
async def test_topic_recommendations(client):
    res = await client.get("/api/conversation/topic-recommendations")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert all("topic" in r and "reason" in r for r in data)


@pytest.mark.integration
async def test_replay_not_found(client):
    res = await client.get("/api/conversation/9999/replay")
    assert res.status_code == 404


@pytest.mark.integration
async def test_replay_empty_conversation(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome to the hotel!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    res = await client.get(f"/api/conversation/{conv_id}/replay")
    assert res.status_code == 200
    data = res.json()
    assert data["conversation"]["id"] == conv_id
    assert data["total_turns"] >= 1
    # Opening assistant message should be the first turn
    assert data["turns"][0]["assistant_message"] == "Welcome to the hotel!"


@pytest.mark.integration
async def test_replay_multi_turn(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    mock_copilot.ask = AsyncMock(return_value="Sure, I can help!")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True, "corrected": "", "errors": []})
    await client.post("/api/conversation/message", json={"conversation_id": conv_id, "content": "I need a room."})
    res = await client.get(f"/api/conversation/{conv_id}/replay")
    assert res.status_code == 200
    data = res.json()
    assert data["total_turns"] >= 2
    # Find the user turn
    user_turns = [t for t in data["turns"] if t["user_message"] is not None]
    assert len(user_turns) >= 1
    assert user_turns[0]["user_message"] == "I need a room."
    assert user_turns[0]["assistant_message"] == "Sure, I can help!"


@pytest.mark.integration
async def test_conversation_vocabulary_not_found(client):
    res = await client.get("/api/conversation/9999/vocabulary")
    assert res.status_code == 404


@pytest.mark.integration
async def test_conversation_vocabulary_no_matches(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome to the hotel!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    res = await client.get(f"/api/conversation/{conv_id}/vocabulary")
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] == conv_id
    assert isinstance(data["words"], list)


@pytest.mark.integration
async def test_conversation_vocabulary_with_matches(client, mock_copilot):
    # First create vocabulary words
    mock_copilot.ask_json.return_value = {
        "questions": [
            {"word": "hotel", "correct_meaning": "a place to stay", "example_sentence": "Stay at the hotel.", "difficulty": 1, "wrong_options": ["a", "b", "c"]},
        ]
    }
    await client.get("/api/vocabulary/quiz?topic=hotel_checkin")
    # Create a conversation containing the word "hotel"
    mock_copilot.ask = AsyncMock(return_value="Welcome to the hotel!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    res = await client.get(f"/api/conversation/{conv_id}/vocabulary")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 1
    assert any(w["word"] == "hotel" for w in data["words"])


@pytest.mark.integration
async def test_get_history_nonexistent_conversation(client):
    """Test that history returns 404 for a nonexistent conversation ID."""
    res = await client.get("/api/conversation/99999/history")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_end_conversation_summary_failure_is_non_fatal(client, mock_copilot):
    """Test that LLM summary failure doesn't prevent ending a conversation."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # LLM summary generation fails
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM service unavailable"))

    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 200
    data = res.json()
    # Should have a fallback summary
    assert data["summary"]["communication_level"] == "unknown"
    assert data["summary"]["key_vocabulary"] == []

    # Conversation should be ended — trying to end again gives 409 (conflict)
    res2 = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res2.status_code == 409

    # History should still be retrievable
    res3 = await client.get(f"/api/conversation/{conv_id}/history")
    assert res3.status_code == 200


@pytest.mark.asyncio
@pytest.mark.integration
async def test_send_message_with_partial_grammar_feedback(client, mock_copilot):
    """LLM returns grammar feedback missing errors/suggestions — should be normalized."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Grammar check returns only is_correct, missing errors/suggestions/corrected_text
    mock_copilot.ask = AsyncMock(return_value="That sounds great!")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True})

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I want to check in.",
    })
    assert res.status_code == 200
    data = res.json()
    fb = data["feedback"]
    assert fb is not None
    assert fb["is_correct"] is True
    assert fb["errors"] == []
    assert fb["suggestions"] == []
    assert fb["corrected_text"] == ""


@pytest.mark.asyncio
@pytest.mark.integration
async def test_end_conversation_normalizes_string_key_vocabulary(client, mock_copilot):
    """LLM returns key_vocabulary as comma-separated string — should be split to list."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Brief chat.",
        "key_vocabulary": "reservation, amenities, check-in",
        "communication_level": "beginner",
        "tip": "Practice greetings.",
    })
    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["summary"]["key_vocabulary"], list)
    assert "reservation" in data["summary"]["key_vocabulary"]
    assert len(data["summary"]["key_vocabulary"]) == 3


@pytest.mark.asyncio
@pytest.mark.integration
async def test_end_conversation_normalizes_null_key_vocabulary(client, mock_copilot):
    """LLM returns key_vocabulary as None — should default to empty list."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Short conversation.",
        "key_vocabulary": None,
        "communication_level": "beginner",
    })
    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 200
    data = res.json()
    assert data["summary"]["key_vocabulary"] == []
    assert data["summary"]["tip"] == ""


@pytest.mark.asyncio
@pytest.mark.integration
async def test_start_conversation_llm_failure_no_orphan(client, mock_copilot):
    """If LLM fails during start, the conversation should be cleaned up (no orphan)."""
    mock_copilot.ask = AsyncMock(side_effect=Exception("LLM unavailable"))

    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert res.status_code == 502

    # Verify no orphan conversation exists
    list_res = await client.get("/api/conversation/list")
    assert list_res.status_code == 200
    conversations = list_res.json()["conversations"]
    assert len(conversations) == 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_send_message_llm_failure_no_orphan_message(client, mock_copilot):
    """If LLM fails during send_message, the user message should be cleaned up."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # Conversation response fails (safe_llm_call raises 502)
    mock_copilot.ask = AsyncMock(side_effect=Exception("LLM unavailable"))
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM unavailable"))

    res = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I want to check in.",
    })
    assert res.status_code == 502

    # Verify the orphan user message was cleaned up
    history_res = await client.get(f"/api/conversation/{conv_id}/history")
    assert history_res.status_code == 200
    messages = history_res.json()["messages"]
    # Should only have the initial assistant message, no orphaned user message
    user_messages = [m for m in messages if m["role"] == "user"]
    assert len(user_messages) == 0


@pytest.mark.integration
async def test_send_message_after_conversation_ended_during_llm_call(client, mock_copilot):
    """If conversation ends while LLM is processing, send_message returns 409 and cleans up."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]

    # End the conversation first via the API
    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Done.", "key_vocabulary": [], "communication_level": "beginner", "tip": "ok"
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Now try sending a message — should return 409 since conversation is ended
    mock_copilot.ask = AsyncMock(return_value="AI response")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True, "errors": [], "suggestions": []})
    res = await client.post("/api/conversation/message", json={"conversation_id": conv_id, "content": "Hello"})
    assert res.status_code == 409


@pytest.mark.integration
async def test_send_message_to_nonexistent_conversation_returns_404(client, mock_copilot):
    """Sending a message to a completely nonexistent conversation returns 404."""
    mock_copilot.ask = AsyncMock(return_value="AI response")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True, "errors": [], "suggestions": []})
    res = await client.post("/api/conversation/message", json={"conversation_id": 99999, "content": "Hello"})
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


@pytest.mark.integration
async def test_generate_quiz_on_ended_conversation(client, mock_copilot):
    """Generate quiz questions from an ended conversation."""
    mock_copilot.ask = AsyncMock(return_value="Welcome! How can I help?")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Great choice!")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True, "errors": [], "suggestions": []})
    await client.post("/api/conversation/message", json={"conversation_id": conv_id, "content": "I need a room"})

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Checked in.", "key_vocabulary": ["room", "reservation"],
        "communication_level": "beginner", "tip": "Practice more"
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"question": "What does 'reservation' mean?", "options": ["Booking", "Bill", "Room", "Key"], "correct_index": 0, "explanation": "A reservation is a booking."},
            {"question": "What did the user request?", "options": ["A room", "A car", "Food", "Directions"], "correct_index": 0, "explanation": "The user asked for a room."},
        ]
    })
    res = await client.post(f"/api/conversation/{conv_id}/quiz?count=4")
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] == conv_id
    assert len(data["questions"]) == 2
    assert data["questions"][0]["options"] == ["Booking", "Bill", "Room", "Key"]
    assert data["questions"][0]["correct_index"] == 0


@pytest.mark.integration
async def test_generate_quiz_on_active_conversation_returns_400(client, mock_copilot):
    """Quiz generation requires an ended conversation."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = res.json()["conversation_id"]

    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 400
    assert "ended" in res.json()["detail"].lower()


@pytest.mark.integration
async def test_generate_quiz_nonexistent_conversation_returns_404(client):
    """Quiz generation on non-existent conversation returns 404."""
    res = await client.post("/api/conversation/99999/quiz")
    assert res.status_code == 404


@pytest.mark.integration
async def test_generate_quiz_accepts_string_correct_index(client, mock_copilot):
    """Quiz validation should accept correct_index as a string from LLM."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Great!")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True, "errors": [], "suggestions": []})
    await client.post("/api/conversation/message", json={"conversation_id": conv_id, "content": "Hello"})

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Done.", "key_vocabulary": ["hello"], "communication_level": "beginner", "tip": "ok"
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": "2", "explanation": "Because C"},
            {"question": "Q2?", "options": ["A", "B", "C", "D"], "correct_index": 1.0, "explanation": "Because B"},
        ]
    })
    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 2
    assert data["questions"][0]["correct_index"] == 2
    assert data["questions"][1]["correct_index"] == 1


@pytest.mark.integration
async def test_generate_quiz_accepts_alternative_key_names(client, mock_copilot):
    """Quiz validation should accept alternative key names like correct_answer."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Great!")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True, "errors": [], "suggestions": []})
    await client.post("/api/conversation/message", json={"conversation_id": conv_id, "content": "Hello"})

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Done.", "key_vocabulary": [], "communication_level": "beginner", "tip": "ok"
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    mock_copilot.ask_json = AsyncMock(return_value={
        "questions": [
            {"question": "Q?", "options": ["A", "B", "C", "D"], "correct_answer": 0, "explanation": "A is correct"},
        ]
    })
    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 200
    assert len(res.json()["questions"]) == 1
    assert res.json()["questions"][0]["correct_index"] == 0


async def _create_ended_conversation(client, mock_copilot):
    """Helper: create and end a conversation, returning its ID."""
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="Great!")
    mock_copilot.ask_json = AsyncMock(return_value={"is_correct": True, "errors": [], "suggestions": []})
    await client.post("/api/conversation/message", json={"conversation_id": conv_id, "content": "Hello"})

    mock_copilot.ask_json = AsyncMock(return_value={
        "summary": "Done.", "key_vocabulary": ["hello"], "communication_level": "beginner", "tip": "ok"
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    return conv_id


@pytest.mark.integration
async def test_generate_quiz_llm_failure_returns_502(client, mock_copilot):
    """Quiz generation returns 502 when LLM raises an exception."""
    conv_id = await _create_ended_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM timeout"))
    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 502


@pytest.mark.integration
async def test_generate_quiz_empty_questions_returns_502(client, mock_copilot):
    """Quiz generation returns 502 when LLM returns empty questions list."""
    conv_id = await _create_ended_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(return_value={"questions": []})
    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 502


@pytest.mark.integration
async def test_generate_quiz_all_malformed_returns_502(client, mock_copilot):
    """Quiz returns 502 when all questions are malformed (wrong option count, missing fields)."""
    conv_id = await _create_ended_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(return_value={"questions": [
        {"options": ["A", "B"], "correct_index": 0},  # missing question field
        {"question": "Q?", "options": ["A", "B", "C"], "correct_index": 0, "explanation": "x"},  # only 3 options
        {"question": "Q2?", "correct_index": 0, "explanation": "x"},  # missing options
    ]})
    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 502


@pytest.mark.integration
async def test_generate_quiz_filters_invalid_keeps_valid(client, mock_copilot):
    """Valid questions are kept, malformed ones are filtered out."""
    conv_id = await _create_ended_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(return_value={"questions": [
        {"question": "Good Q?", "options": ["A", "B", "C", "D"], "correct_index": 1, "explanation": "Yes"},
        {"options": ["A", "B", "C", "D"], "correct_index": 0},  # no question field
        {"question": "Also good?", "options": ["W", "X", "Y", "Z"], "correct_index": 3, "explanation": "Z"},
    ]})
    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 2
    assert data["questions"][0]["question"] == "Good Q?"
    assert data["questions"][1]["question"] == "Also good?"


@pytest.mark.integration
async def test_generate_quiz_filters_out_of_range_index(client, mock_copilot):
    """Questions with out-of-range correct_index are filtered out."""
    conv_id = await _create_ended_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(return_value={"questions": [
        {"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": 5, "explanation": "x"},
        {"question": "Q2?", "options": ["A", "B", "C", "D"], "correct_index": -1, "explanation": "x"},
        {"question": "Q3?", "options": ["A", "B", "C", "D"], "correct_index": 2, "explanation": "OK"},
    ]})
    res = await client.post(f"/api/conversation/{conv_id}/quiz")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 1
    assert data["questions"][0]["question"] == "Q3?"
    assert data["questions"][0]["correct_index"] == 2


@pytest.mark.integration
async def test_generate_quiz_count_parameter_bounds(client, mock_copilot):
    """Count parameter enforces bounds: ge=2, le=8."""
    conv_id = await _create_ended_conversation(client, mock_copilot)

    res = await client.post(f"/api/conversation/{conv_id}/quiz?count=1")
    assert res.status_code == 422

    res = await client.post(f"/api/conversation/{conv_id}/quiz?count=9")
    assert res.status_code == 422


@pytest.mark.integration
async def test_generate_quiz_truncates_to_count(client, mock_copilot):
    """LLM returns more questions than requested count — only count are kept."""
    conv_id = await _create_ended_conversation(client, mock_copilot)

    mock_copilot.ask_json = AsyncMock(return_value={"questions": [
        {"question": f"Q{i}?", "options": ["A", "B", "C", "D"], "correct_index": 0, "explanation": f"E{i}"}
        for i in range(6)
    ]})
    res = await client.post(f"/api/conversation/{conv_id}/quiz?count=3")
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 3
    assert data["questions"][0]["question"] == "Q0?"
    assert data["questions"][2]["question"] == "Q2?"


@pytest.mark.integration
async def test_rephrase_sentences_not_found(client):
    res = await client.get("/api/conversation/99999/rephrase-sentences")
    assert res.status_code == 404


@pytest.mark.integration
async def test_rephrase_sentences_returns_list(client, mock_copilot):
    mock_copilot.ask = AsyncMock(
        return_value="Welcome to our hotel and thank you very much for choosing to stay with us today."
    )
    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = res.json()["conversation_id"]

    res = await client.get(f"/api/conversation/{conv_id}/rephrase-sentences")
    assert res.status_code == 200
    data = res.json()
    assert "sentences" in data
    assert data["conversation_id"] == conv_id
    for s in data["sentences"]:
        assert "text" in s
        assert "word_count" in s


@pytest.mark.integration
async def test_rephrase_evaluate_success(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "meaning_preserved": True,
        "naturalness_score": 8,
        "variety_score": 7,
        "overall_score": 7.5,
        "feedback": "Good rephrase!",
    })
    res = await client.post("/api/conversation/rephrase-evaluate", json={
        "original": "Welcome to the hotel.",
        "user_rephrase": "Thanks for having me at the hotel.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["meaning_preserved"] is True
    assert data["overall_score"] == 7.5
    assert data["feedback"] == "Good rephrase!"


@pytest.mark.integration
async def test_rephrase_evaluate_validation(client):
    res = await client.post("/api/conversation/rephrase-evaluate", json={
        "original": "",
        "user_rephrase": "Hello",
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_retelling_evaluate_success(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage": 8,
        "grammar_score": 7,
        "fluency_score": 9,
        "vocabulary_score": 7.5,
        "overall_score": 8,
        "feedback": "Great retelling!",
        "model_retelling": "The user checked into a hotel and asked about amenities.",
    })
    res = await client.post("/api/conversation/retelling/evaluate", json={
        "original_summary": "The guest arrived at the hotel and inquired about room service.",
        "user_retelling": "A person came to the hotel and asked about getting food in their room.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["content_coverage"] == 8
    assert data["grammar_score"] == 7
    assert data["fluency_score"] == 9
    assert data["vocabulary_score"] == 7.5
    assert data["overall_score"] == 8
    assert data["feedback"] == "Great retelling!"
    assert "hotel" in data["model_retelling"]


@pytest.mark.integration
async def test_retelling_evaluate_validation(client):
    res = await client.post("/api/conversation/retelling/evaluate", json={
        "original_summary": "",
        "user_retelling": "Hello",
    })
    assert res.status_code == 422


@pytest.mark.integration
async def test_retelling_evaluate_llm_failure(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(side_effect=Exception("LLM error"))
    res = await client.post("/api/conversation/retelling/evaluate", json={
        "original_summary": "A conversation about hotels.",
        "user_retelling": "They talked about hotels.",
    })
    assert res.status_code == 502


@pytest.mark.integration
async def test_retelling_evaluate_score_clamping(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "content_coverage": 0,
        "grammar_score": 15,
        "fluency_score": -2,
        "vocabulary_score": 100,
        "overall_score": 0,
        "feedback": "Clamped",
        "model_retelling": "Model text",
    })
    res = await client.post("/api/conversation/retelling/evaluate", json={
        "original_summary": "Summary text.",
        "user_retelling": "User retelling text.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["content_coverage"] == 1
    assert data["grammar_score"] == 10
    assert data["fluency_score"] == 1
    assert data["vocabulary_score"] == 10
    assert data["overall_score"] == 1


@pytest.mark.integration
async def test_message_returns_grammar_notes(client, mock_copilot):
    """Grammar notes field is present and correctly structured in message response."""
    mock_copilot.ask = AsyncMock(return_value="Welcome to our hotel!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    cid = start_res.json()["conversation_id"]

    mock_copilot.ask = AsyncMock(return_value="How can I help you today?")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "Hello!",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })
    res = await client.post("/api/conversation/message", json={"conversation_id": cid, "content": "Hello!"})
    assert res.status_code == 200
    data = res.json()
    assert "grammar_notes" in data
    assert isinstance(data["grammar_notes"], list)


@pytest.mark.asyncio
async def test_export_includes_messages_structure(client, mock_copilot):
    """Test export response includes messages with correct role/content structure."""
    mock_copilot.ask = AsyncMock(return_value="Welcome to our hotel!")
    start = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin", "difficulty": "beginner"
    })
    cid = start.json()["conversation_id"]
    mock_copilot.ask = AsyncMock(return_value="Your room is 101.")
    await client.post("/api/conversation/message", json={
        "conversation_id": cid, "content": "I have a reservation"
    })
    res = await client.get(f"/api/conversation/{cid}/export")
    assert res.status_code == 200
    data = res.json()
    assert "messages" in data
    for msg in data["messages"]:
        assert "role" in msg
        assert "content" in msg
        assert msg["role"] in ("user", "assistant")
        assert len(msg["content"]) > 0
    roles = [m["role"] for m in data["messages"]]
    assert "assistant" in roles
    assert "user" in roles


# ── Tests for untested conversation router endpoints ─────────────────


@pytest.mark.integration
async def test_favorites_empty(client):
    """No favorites set returns empty list."""
    res = await client.get("/api/conversation/topics/favorites")
    assert res.status_code == 200
    assert res.json()["favorites"] == []


@pytest.mark.integration
async def test_toggle_favorite_on(client):
    """Toggle a valid topic to favorite."""
    res = await client.put("/api/conversation/topics/hotel_checkin/favorite")
    assert res.status_code == 200
    data = res.json()
    assert data["is_favorite"] is True
    # Verify it's in favorites list
    res2 = await client.get("/api/conversation/topics/favorites")
    assert "hotel_checkin" in res2.json()["favorites"]


@pytest.mark.integration
async def test_toggle_favorite_off(client):
    """Toggle same topic twice unfavorites it."""
    await client.put("/api/conversation/topics/hotel_checkin/favorite")
    res = await client.put("/api/conversation/topics/hotel_checkin/favorite")
    assert res.status_code == 200
    assert res.json()["is_favorite"] is False


@pytest.mark.integration
async def test_toggle_favorite_invalid_topic(client):
    """Invalid topic returns 404."""
    res = await client.put("/api/conversation/topics/nonexistent_topic/favorite")
    assert res.status_code == 404


@pytest.mark.integration
async def test_cleanup_stale_no_stale(client):
    """No stale conversations returns 0 abandoned."""
    res = await client.post("/api/conversation/cleanup/stale")
    assert res.status_code == 200
    assert res.json()["abandoned_count"] == 0


@pytest.mark.integration
async def test_shadowing_phrases_not_found(client):
    """Non-existent conversation returns 404."""
    res = await client.get("/api/conversation/99999/shadowing-phrases")
    assert res.status_code == 404


@pytest.mark.integration
async def test_shadowing_phrases_returns_phrases(client, mock_copilot):
    """Conversation with messages returns phrases."""
    # Create conversation and add messages
    create_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin", "difficulty": "beginner"})
    cid = create_res.json()["conversation_id"]
    await client.post(f"/api/conversation/{cid}/message", json={"content": "Hello, I would like to check in please."})
    res = await client.get(f"/api/conversation/{cid}/shadowing-phrases")
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] == cid
    assert isinstance(data["phrases"], list)


@pytest.mark.integration
async def test_difficulty_recommendation_empty(client):
    """Difficulty recommendation on empty DB returns valid structure."""
    res = await client.get("/api/conversation/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    assert data["current_difficulty"] in ("beginner", "intermediate", "advanced")
    assert data["recommended_difficulty"] in ("beginner", "intermediate", "advanced")
    assert isinstance(data["reason"], str)
    assert isinstance(data["stats"], dict)


@pytest.mark.integration
async def test_session_averages_empty(client):
    """Session averages on empty DB returns zeroed stats."""
    res = await client.get("/api/conversation/session-averages")
    assert res.status_code == 200
    data = res.json()
    assert data["session_count"] == 0
    assert data["avg_grammar_accuracy_rate"] == 0.0
    assert data["avg_avg_words_per_message"] == 0.0
    assert data["avg_vocabulary_diversity"] == 0.0
    assert data["avg_total_user_messages"] == 0.0


@pytest.mark.integration
async def test_difficulty_recommendation_level_up(client, test_db):
    """Difficulty recommendation suggests level-up when accuracy is high."""
    import json as _json
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()
    perf = {"grammar_accuracy_rate": 90, "avg_words_per_message": 12, "vocabulary_diversity": 0.6, "total_user_messages": 8}
    summary = _json.dumps({"performance": perf})

    for i in range(3):
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
            ("hotel_checkin", "beginner", "ended", now_iso, now_iso, summary),
        )
    await test_db.commit()

    res = await client.get("/api/conversation/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    assert data["current_difficulty"] == "beginner"
    assert data["recommended_difficulty"] == "intermediate"
    assert data["stats"]["accuracy"] == 90.0
    assert data["stats"]["avg_words"] == 12.0
    assert data["stats"]["sessions_analyzed"] == 3
    assert "challenge" in data["reason"].lower() or "ready" in data["reason"].lower()


@pytest.mark.integration
async def test_difficulty_recommendation_stay(client, test_db):
    """Difficulty recommendation says stay when performance is moderate."""
    import json as _json
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()
    perf = {"grammar_accuracy_rate": 70, "avg_words_per_message": 8, "vocabulary_diversity": 0.5, "total_user_messages": 6}
    summary = _json.dumps({"performance": perf})

    for i in range(3):
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
            ("restaurant", "intermediate", "ended", now_iso, now_iso, summary),
        )
    await test_db.commit()

    res = await client.get("/api/conversation/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    assert data["current_difficulty"] == "intermediate"
    assert data["recommended_difficulty"] == "intermediate"
    assert "right level" in data["reason"].lower()


@pytest.mark.integration
async def test_difficulty_recommendation_level_down(client, test_db):
    """Difficulty recommendation suggests level-down when accuracy is low."""
    import json as _json
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()
    perf = {"grammar_accuracy_rate": 35, "avg_words_per_message": 3, "vocabulary_diversity": 0.2, "total_user_messages": 4}
    summary = _json.dumps({"performance": perf})

    for i in range(3):
        await test_db.execute(
            "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
            ("job_interview", "advanced", "ended", now_iso, now_iso, summary),
        )
    await test_db.commit()

    res = await client.get("/api/conversation/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    assert data["current_difficulty"] == "advanced"
    assert data["recommended_difficulty"] == "intermediate"
    assert data["stats"]["accuracy"] == 35.0


@pytest.mark.integration
async def test_difficulty_recommendation_malformed_summary(client, test_db):
    """Difficulty recommendation handles malformed summary_json gracefully."""
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()

    # Insert conversations with bad JSON
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("hotel_checkin", "beginner", "ended", now_iso, now_iso, "not-valid-json"),
    )
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("restaurant", "beginner", "ended", now_iso, now_iso, '{"no_performance": true}'),
    )
    await test_db.commit()

    res = await client.get("/api/conversation/difficulty-recommendation")
    assert res.status_code == 200
    data = res.json()
    # Both summaries are unparseable/missing performance → valid_count == 0 → "Not enough performance data"
    assert data["stats"]["sessions_analyzed"] == 0


@pytest.mark.integration
async def test_session_averages_with_data(client, test_db):
    """Session averages correctly computes averages from seeded conversations."""
    import json as _json
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()

    # Session 1: high performance
    perf1 = {"grammar_accuracy_rate": 90, "avg_words_per_message": 12, "vocabulary_diversity": 0.8, "total_user_messages": 10}
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "ended", now_iso, now_iso, _json.dumps({"performance": perf1})),
    )

    # Session 2: low performance
    perf2 = {"grammar_accuracy_rate": 60, "avg_words_per_message": 6, "vocabulary_diversity": 0.4, "total_user_messages": 4}
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("restaurant", "beginner", "ended", now_iso, now_iso, _json.dumps({"performance": perf2})),
    )
    await test_db.commit()

    res = await client.get("/api/conversation/session-averages")
    assert res.status_code == 200
    data = res.json()
    assert data["session_count"] == 2
    assert data["avg_grammar_accuracy_rate"] == 75.0  # (90+60)/2
    assert data["avg_avg_words_per_message"] == 9.0  # (12+6)/2
    assert data["avg_vocabulary_diversity"] == 0.6  # (0.8+0.4)/2
    assert data["avg_total_user_messages"] == 7.0  # (10+4)/2


@pytest.mark.integration
async def test_session_averages_skips_malformed(client, test_db):
    """Session averages gracefully skips malformed summary_json entries."""
    import json as _json
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()

    # Valid session
    perf = {"grammar_accuracy_rate": 80, "avg_words_per_message": 10, "vocabulary_diversity": 0.5, "total_user_messages": 8}
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "ended", now_iso, now_iso, _json.dumps({"performance": perf})),
    )

    # Malformed session (invalid JSON)
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("restaurant", "beginner", "ended", now_iso, now_iso, "{broken json}"),
    )

    # Missing performance key
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("job_interview", "advanced", "ended", now_iso, now_iso, _json.dumps({"summary": "no perf data"})),
    )
    await test_db.commit()

    res = await client.get("/api/conversation/session-averages")
    assert res.status_code == 200
    data = res.json()
    # Only the 1 valid session should be counted
    assert data["session_count"] == 1
    assert data["avg_grammar_accuracy_rate"] == 80.0
    assert data["avg_avg_words_per_message"] == 10.0


# --- Bookmarks endpoint ---

@pytest.mark.integration
async def test_bookmarks_empty(client):
    res = await client.get("/api/conversation/bookmarks")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.integration
async def test_bookmarks_with_data(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Hello! Welcome to the hotel.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "is_correct": True,
        "corrected_text": "",
        "explanation": "",
        "grammar_notes": [],
    })
    start = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    cid = start.json()["conversation_id"]
    await client.post("/api/conversation/message", json={
        "conversation_id": cid,
        "content": "I'd like to check in please",
    })
    # Get message ID from history
    hist = await client.get(f"/api/conversation/{cid}/history")
    user_msgs = [m for m in hist.json()["messages"] if m["role"] == "user"]
    mid = user_msgs[0]["id"]
    # Bookmark the message
    await client.put(f"/api/conversation/messages/{mid}/bookmark")
    # Get bookmarks
    res = await client.get("/api/conversation/bookmarks")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["id"] == mid


@pytest.mark.integration
async def test_bookmarks_filter_by_conversation(client, mock_copilot):
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    mock_copilot.ask_json = AsyncMock(return_value={
        "is_correct": True,
        "corrected_text": "",
        "explanation": "",
        "grammar_notes": [],
    })
    # Create two conversations with bookmarks
    start1 = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    cid1 = start1.json()["conversation_id"]
    await client.post("/api/conversation/message", json={
        "conversation_id": cid1,
        "content": "Hello",
    })
    hist1 = await client.get(f"/api/conversation/{cid1}/history")
    mid1 = [m for m in hist1.json()["messages"] if m["role"] == "user"][0]["id"]
    await client.put(f"/api/conversation/messages/{mid1}/bookmark")

    start2 = await client.post("/api/conversation/start", json={"topic": "restaurant_order"})
    cid2 = start2.json()["conversation_id"]
    await client.post("/api/conversation/message", json={
        "conversation_id": cid2,
        "content": "Hi there",
    })
    hist2 = await client.get(f"/api/conversation/{cid2}/history")
    mid2 = [m for m in hist2.json()["messages"] if m["role"] == "user"][0]["id"]
    await client.put(f"/api/conversation/messages/{mid2}/bookmark")

    # All bookmarks
    all_res = await client.get("/api/conversation/bookmarks")
    assert all_res.json()["total"] == 2

    # Filter by conversation
    filtered = await client.get(f"/api/conversation/bookmarks?conversation_id={cid1}")
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["id"] == mid1


@pytest.mark.integration
async def test_random_grammar_mistake_empty(client):
    res = await client.get("/api/conversation/random-grammar-mistake")
    assert res.status_code == 404


@pytest.mark.integration
async def test_random_grammar_mistake_with_data(client, test_db):
    import json
    await test_db.execute(
        "INSERT INTO conversations (id, topic, status) VALUES (?, ?, ?)",
        (900, "hotel_checkin", "ended"),
    )
    feedback = json.dumps({
        "is_correct": False,
        "corrected_text": "I would like to check in.",
        "errors": [{"fragment": "I want check in", "correction": "I would like to check in", "explanation": "Use 'would like to' for polite requests."}],
    })
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, feedback_json) VALUES (?, ?, ?, ?)",
        (900, "user", "I want check in.", feedback),
    )
    await test_db.commit()

    res = await client.get("/api/conversation/random-grammar-mistake")
    assert res.status_code == 200
    data = res.json()
    assert data["original_text"] == "I want check in."
    assert data["corrected_text"] == "I would like to check in."
    assert data["error_fragment"] == "I want check in"
    assert data["explanation"] == "Use 'would like to' for polite requests."


@pytest.mark.integration
async def test_random_grammar_mistake_skips_correct(client, test_db):
    import json
    await test_db.execute(
        "INSERT INTO conversations (id, topic, status) VALUES (?, ?, ?)",
        (901, "hotel_checkin", "ended"),
    )
    feedback = json.dumps({"is_correct": True, "corrected_text": "Hello!", "errors": []})
    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content, feedback_json) VALUES (?, ?, ?, ?)",
        (901, "user", "Hello!", feedback),
    )
    await test_db.commit()

    res = await client.get("/api/conversation/random-grammar-mistake")
    assert res.status_code == 404


@pytest.mark.integration
async def test_topic_warmup_success(client, mock_copilot):
    mock_copilot.ask_json = AsyncMock(return_value={
        "phrases": [
            {"phrase": "I'd like to check in, please.", "hint": "when arriving"},
            {"phrase": "Do you have any rooms available?", "hint": "asking about availability"},
            {"phrase": "Could I get a room with a view?", "hint": "requesting preferences"},
            {"phrase": "What time is checkout?", "hint": "departure info"},
        ]
    })
    res = await client.post(
        "/api/conversation/topic-warmup",
        json={"topic": "hotel_checkin", "difficulty": "intermediate"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["topic"] == "hotel_checkin"
    assert len(data["phrases"]) == 4
    assert data["phrases"][0]["phrase"] == "I'd like to check in, please."
    assert data["phrases"][0]["hint"] == "when arriving"


@pytest.mark.integration
async def test_topic_warmup_invalid_topic(client):
    res = await client.post(
        "/api/conversation/topic-warmup",
        json={"topic": "nonexistent_topic", "difficulty": "intermediate"},
    )
    assert res.status_code == 404


@pytest.mark.integration
async def test_topic_progress_no_previous(client, test_db):
    """Topic progress returns has_previous=False when only one conversation on topic."""
    import json as _json
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()
    perf = {"grammar_accuracy_rate": 80, "avg_words_per_message": 10, "vocabulary_diversity": 55, "total_user_messages": 6}
    summary = _json.dumps({"performance": perf})
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "ended", now_iso, now_iso, summary),
    )
    await test_db.commit()
    row = await test_db.execute_fetchall("SELECT id FROM conversations ORDER BY id DESC LIMIT 1")
    cid = row[0]["id"]

    res = await client.get(f"/api/conversation/{cid}/topic-progress")
    assert res.status_code == 200
    data = res.json()
    assert data["has_previous"] is False
    assert data["current"]["grammar_accuracy_rate"] == 80


@pytest.mark.integration
async def test_topic_progress_with_previous(client, test_db):
    """Topic progress returns deltas when a previous conversation on same topic exists."""
    import json as _json
    from datetime import datetime as dt, timezone

    now_iso = dt.now(timezone.utc).isoformat()
    perf1 = {"grammar_accuracy_rate": 70, "avg_words_per_message": 8, "vocabulary_diversity": 45, "total_user_messages": 5}
    perf2 = {"grammar_accuracy_rate": 85, "avg_words_per_message": 12, "vocabulary_diversity": 60, "total_user_messages": 8}
    summary1 = _json.dumps({"performance": perf1})
    summary2 = _json.dumps({"performance": perf2})
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "ended", now_iso, now_iso, summary1),
    )
    await test_db.execute(
        "INSERT INTO conversations (topic, difficulty, status, started_at, ended_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("hotel_checkin", "intermediate", "ended", now_iso, now_iso, summary2),
    )
    await test_db.commit()
    row = await test_db.execute_fetchall("SELECT id FROM conversations ORDER BY id DESC LIMIT 1")
    cid = row[0]["id"]

    res = await client.get(f"/api/conversation/{cid}/topic-progress")
    assert res.status_code == 200
    data = res.json()
    assert data["has_previous"] is True
    assert data["deltas"]["grammar_accuracy_rate"] == 15.0
    assert data["deltas"]["avg_words_per_message"] == 4.0
    assert data["current"]["grammar_accuracy_rate"] == 85


@pytest.mark.integration
async def test_topic_progress_not_found(client):
    """Topic progress returns 404 for nonexistent conversation."""
    res = await client.get("/api/conversation/999999/topic-progress")
    assert res.status_code == 404


@pytest.mark.integration
async def test_custom_topic_crud(client):
    """Create, list, and delete a custom conversation topic."""
    # Create
    res = await client.post("/api/conversation/custom-topics", json={
        "label": "Bank Visit",
        "description": "Open an account",
        "scenario": "You are a bank teller. The user is opening an account.",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["label"] == "Bank Visit"
    topic_id = data["id"]

    # List
    res = await client.get("/api/conversation/custom-topics")
    assert res.status_code == 200
    assert any(t["id"] == topic_id for t in res.json())

    # Appears in merged topics
    res = await client.get("/api/conversation/topics")
    assert res.status_code == 200
    merged = res.json()
    custom_item = next((t for t in merged if t["id"] == topic_id), None)
    assert custom_item is not None
    assert custom_item.get("is_custom") is True

    # Delete
    res = await client.delete(f"/api/conversation/custom-topics/{topic_id}")
    assert res.status_code == 200

    # Verify deleted
    res = await client.get("/api/conversation/custom-topics")
    assert not any(t["id"] == topic_id for t in res.json())


@pytest.mark.integration
async def test_custom_topic_duplicate_returns_409(client):
    """Creating a custom topic with duplicate label returns 409."""
    payload = {"label": "Duplicate Test", "scenario": "You are a test agent."}
    await client.post("/api/conversation/custom-topics", json=payload)
    res = await client.post("/api/conversation/custom-topics", json=payload)
    assert res.status_code == 409
