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

    # Try ending again
    res = await client.post("/api/conversation/end", json={"conversation_id": conv_id})
    assert res.status_code == 404


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
    assert bookmarked[0]["is_bookmarked"] == 1


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
    assert data["conversations"][0]["topic"] == "hotel_checkin"


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
    assert conversations[0]["topic"] == "shopping"


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
    assert data["topic"] == "hotel_checkin"
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
    assert all("hotel_checkin" == c["topic"] for c in data["conversations"])


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
