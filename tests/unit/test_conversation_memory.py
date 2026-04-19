"""Tests for Conversation AI Memory endpoints."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from app.dal import preferences as pref_dal


# ---------------------------------------------------------------------------
# Unit tests — DAL level
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_memory_empty(test_db):
    """GET memory returns empty list when no memory stored."""
    raw = await pref_dal.get_preference(test_db, "conversation_memory")
    assert raw is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_set_and_get_memory(test_db):
    """Memory facts can be stored and retrieved via preferences."""
    facts = ["Works as an engineer", "Lives in Tokyo", "Likes hiking"]
    await pref_dal.set_preference(test_db, "conversation_memory", json.dumps(facts))
    raw = await pref_dal.get_preference(test_db, "conversation_memory")
    assert raw is not None
    loaded = json.loads(raw)
    assert loaded == facts


@pytest.mark.unit
@pytest.mark.asyncio
async def test_delete_memory(test_db):
    """Deleting memory clears the stored facts."""
    facts = ["Enjoys cooking"]
    await pref_dal.set_preference(test_db, "conversation_memory", json.dumps(facts))
    deleted = await pref_dal.delete_preference(test_db, "conversation_memory")
    assert deleted is True
    raw = await pref_dal.get_preference(test_db, "conversation_memory")
    assert raw is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_delete_memory_when_empty(test_db):
    """Deleting memory when none exists returns False."""
    deleted = await pref_dal.delete_preference(test_db, "conversation_memory")
    assert deleted is False


# ---------------------------------------------------------------------------
# Integration tests — API level
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_memory_endpoint_empty(client):
    """GET /api/conversation/memory returns empty facts array."""
    resp = await client.get("/api/conversation/memory")
    assert resp.status_code == 200
    data = resp.json()
    assert data == {"facts": []}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_memory_endpoint_with_facts(client):
    """GET /api/conversation/memory returns stored facts."""
    # Pre-seed memory via preferences endpoint
    facts = ["Has two cats", "Studies at night"]
    await client.put(
        "/api/preferences/conversation_memory",
        json={"value": json.dumps(facts)},
    )
    resp = await client.get("/api/conversation/memory")
    assert resp.status_code == 200
    data = resp.json()
    assert data["facts"] == facts


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_memory_endpoint(client):
    """DELETE /api/conversation/memory clears stored facts."""
    # Pre-seed
    facts = ["Loves sushi"]
    await client.put(
        "/api/preferences/conversation_memory",
        json={"value": json.dumps(facts)},
    )
    # Verify facts exist
    resp = await client.get("/api/conversation/memory")
    assert resp.json()["facts"] == facts

    # Delete
    resp = await client.delete("/api/conversation/memory")
    assert resp.status_code == 200
    assert resp.json()["cleared"] is True

    # Verify cleared
    resp = await client.get("/api/conversation/memory")
    assert resp.json()["facts"] == []


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_memory_endpoint_when_empty(client):
    """DELETE /api/conversation/memory when empty returns cleared=false."""
    resp = await client.delete("/api/conversation/memory")
    assert resp.status_code == 200
    assert resp.json()["cleared"] is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_memory_extraction_on_end_conversation(client, mock_copilot):
    """Ending a conversation extracts and stores personal facts."""
    # Configure mock to return facts when extracting
    original_ask_json = mock_copilot.ask_json

    call_count = 0
    async def smart_ask_json(system, prompt, **kwargs):
        nonlocal call_count
        call_count += 1
        # First ask_json call is the summary, second is memory extraction
        if "extract" in prompt.lower() or "personal facts" in prompt.lower():
            return {"facts": ["Works as a software developer", "Has a dog named Max"]}
        return {
            "summary": "Good conversation about hotel check-in",
            "key_vocabulary": ["reservation", "check-in"],
            "communication_level": "intermediate",
            "tip": "Try using more complex sentences",
        }

    mock_copilot.ask_json = AsyncMock(side_effect=smart_ask_json)

    # Start a conversation
    start_resp = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin",
        "difficulty": "intermediate",
    })
    assert start_resp.status_code == 200
    conv_id = start_resp.json()["conversation_id"]

    # Send a message
    msg_resp = await client.post("/api/conversation/message", json={
        "conversation_id": conv_id,
        "content": "I work as a software developer and my dog Max is waiting at home.",
    })
    assert msg_resp.status_code == 200

    # End the conversation
    end_resp = await client.post("/api/conversation/end", json={
        "conversation_id": conv_id,
    })
    assert end_resp.status_code == 200

    # Check that memory was stored
    mem_resp = await client.get("/api/conversation/memory")
    assert mem_resp.status_code == 200
    facts = mem_resp.json()["facts"]
    assert len(facts) > 0
    assert any("software developer" in f.lower() for f in facts)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_memory_merge_deduplication(client, mock_copilot):
    """Memory extraction merges new facts with existing ones, deduplicating."""
    # Pre-seed existing memory
    existing = ["Lives in Tokyo"]
    await client.put(
        "/api/preferences/conversation_memory",
        json={"value": json.dumps(existing)},
    )

    # Mock extraction to return one duplicate and one new fact
    async def extract_facts(system, prompt, **kwargs):
        if "extract" in prompt.lower() or "personal facts" in prompt.lower():
            return {"facts": ["Lives in Tokyo", "Enjoys reading sci-fi"]}
        return {
            "summary": "Nice conversation",
            "key_vocabulary": [],
            "communication_level": "intermediate",
            "tip": "",
        }

    mock_copilot.ask_json = AsyncMock(side_effect=extract_facts)

    # Start, message, end
    start = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin", "difficulty": "beginner",
    })
    conv_id = start.json()["conversation_id"]
    await client.post("/api/conversation/message", json={
        "conversation_id": conv_id, "content": "Hello, I want to check in.",
    })
    await client.post("/api/conversation/end", json={"conversation_id": conv_id})

    # Check memory — should have 2 facts (no duplicate)
    mem = await client.get("/api/conversation/memory")
    facts = mem.json()["facts"]
    assert len(facts) == 2
    assert "Lives in Tokyo" in facts
    assert "Enjoys reading sci-fi" in facts


@pytest.mark.integration
@pytest.mark.asyncio
async def test_skip_summary_skips_memory_extraction(client, mock_copilot):
    """When skip_summary is true, memory extraction is skipped."""
    start = await client.post("/api/conversation/start", json={
        "topic": "hotel_checkin", "difficulty": "beginner",
    })
    conv_id = start.json()["conversation_id"]

    end = await client.post("/api/conversation/end", json={
        "conversation_id": conv_id, "skip_summary": True,
    })
    assert end.status_code == 200

    # Memory should be empty
    mem = await client.get("/api/conversation/memory")
    assert mem.json()["facts"] == []
