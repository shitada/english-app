"""Integration tests for input validation across all routers."""

from __future__ import annotations

import pytest


@pytest.mark.integration
class TestConversationValidation:
    async def test_start_empty_topic(self, client):
        resp = await client.post("/api/conversation/start", json={"topic": ""})
        assert resp.status_code == 422

    async def test_message_empty_content(self, client):
        resp = await client.post(
            "/api/conversation/message",
            json={"conversation_id": 1, "content": ""},
        )
        assert resp.status_code == 422

    async def test_message_negative_conversation_id(self, client):
        resp = await client.post(
            "/api/conversation/message",
            json={"conversation_id": -1, "content": "Hello"},
        )
        assert resp.status_code == 422

    async def test_message_zero_conversation_id(self, client):
        resp = await client.post(
            "/api/conversation/message",
            json={"conversation_id": 0, "content": "Hello"},
        )
        assert resp.status_code == 422

    async def test_end_negative_conversation_id(self, client):
        resp = await client.post(
            "/api/conversation/end",
            json={"conversation_id": -1},
        )
        assert resp.status_code == 422

    async def test_start_missing_topic(self, client):
        resp = await client.post("/api/conversation/start", json={})
        assert resp.status_code == 422

    async def test_message_missing_content(self, client):
        resp = await client.post(
            "/api/conversation/message",
            json={"conversation_id": 1},
        )
        assert resp.status_code == 422


@pytest.mark.integration
class TestPronunciationValidation:
    async def test_check_empty_reference_text(self, client):
        resp = await client.post(
            "/api/pronunciation/check",
            json={"reference_text": "", "user_transcription": "hello"},
        )
        assert resp.status_code == 422

    async def test_check_empty_user_transcription(self, client):
        resp = await client.post(
            "/api/pronunciation/check",
            json={"reference_text": "hello", "user_transcription": ""},
        )
        assert resp.status_code == 422

    async def test_check_missing_fields(self, client):
        resp = await client.post("/api/pronunciation/check", json={})
        assert resp.status_code == 422


@pytest.mark.integration
class TestVocabularyValidation:
    async def test_answer_negative_word_id(self, client):
        resp = await client.post(
            "/api/vocabulary/answer",
            json={"word_id": -1, "is_correct": True},
        )
        assert resp.status_code == 422

    async def test_answer_zero_word_id(self, client):
        resp = await client.post(
            "/api/vocabulary/answer",
            json={"word_id": 0, "is_correct": True},
        )
        assert resp.status_code == 422

    async def test_answer_missing_fields(self, client):
        resp = await client.post("/api/vocabulary/answer", json={})
        assert resp.status_code == 422

    async def test_quiz_count_zero(self, client):
        resp = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=0")
        assert resp.status_code == 422

    async def test_quiz_count_negative(self, client):
        resp = await client.get("/api/vocabulary/quiz?topic=hotel_checkin&count=-1")
        assert resp.status_code == 422


@pytest.mark.integration
class TestPaginationBounds:
    async def test_conversation_list_negative_limit(self, client):
        res = await client.get("/api/conversation/list?limit=-1")
        assert res.status_code == 422

    async def test_conversation_list_negative_offset(self, client):
        res = await client.get("/api/conversation/list?offset=-1")
        assert res.status_code == 422

    async def test_conversation_list_limit_too_large(self, client):
        res = await client.get("/api/conversation/list?limit=999")
        assert res.status_code == 422

    async def test_bookmarks_negative_limit(self, client):
        res = await client.get("/api/conversation/bookmarks?limit=-1")
        assert res.status_code == 422

    async def test_goal_zero_daily_target(self, client):
        res = await client.post("/api/dashboard/goals", json={"goal_type": "conversations", "daily_target": 0})
        assert res.status_code == 422

    async def test_goal_negative_daily_target(self, client):
        res = await client.post("/api/dashboard/goals", json={"goal_type": "conversations", "daily_target": -5})
        assert res.status_code == 422

    async def test_pronunciation_check_invalid_difficulty(self, client):
        res = await client.post("/api/pronunciation/check", json={
            "reference_text": "Hello world.",
            "user_transcription": "Hello world.",
            "difficulty": "foobar",
        })
        assert res.status_code == 422

    async def test_vocabulary_attempts_negative_offset(self, client):
        res = await client.get("/api/vocabulary/attempts?offset=-1")
        assert res.status_code == 422

    async def test_vocabulary_favorites_negative_offset(self, client):
        res = await client.get("/api/vocabulary/favorites?offset=-1")
        assert res.status_code == 422


@pytest.mark.integration
class TestPathParameterValidation:
    """Path parameter IDs must be >= 1."""

    async def test_conversation_history_zero_id(self, client):
        res = await client.get("/api/conversation/0/history")
        assert res.status_code == 422

    async def test_conversation_delete_negative_id(self, client):
        res = await client.delete("/api/conversation/-1")
        assert res.status_code == 422

    async def test_vocabulary_delete_zero_id(self, client):
        res = await client.delete("/api/vocabulary/0")
        assert res.status_code == 422

    async def test_vocabulary_detail_negative_id(self, client):
        res = await client.get("/api/vocabulary/-5/detail")
        assert res.status_code == 422

    async def test_pronunciation_delete_zero_id(self, client):
        res = await client.delete("/api/pronunciation/0")
        assert res.status_code == 422

    async def test_bookmark_toggle_zero_id(self, client):
        res = await client.put("/api/conversation/messages/0/bookmark")
        assert res.status_code == 422


@pytest.mark.integration
class TestTextLengthLimits:
    async def test_vocabulary_search_too_long(self, client):
        res = await client.get("/api/vocabulary/words", params={"q": "x" * 201})
        assert res.status_code == 422

    async def test_conversation_keyword_too_long(self, client):
        res = await client.get("/api/conversation/list", params={"keyword": "x" * 201})
        assert res.status_code == 422

    async def test_pronunciation_sentence_history_too_long(self, client):
        res = await client.get("/api/pronunciation/sentence-history", params={"text": "x" * 1001})
        assert res.status_code == 422

    async def test_vocabulary_notes_too_long(self, client):
        res = await client.put("/api/vocabulary/1/notes", json={"notes": "x" * 2001})
        assert res.status_code == 422

    async def test_vocabulary_update_empty_meaning(self, client):
        """PUT /vocabulary/{id} with empty meaning returns 422."""
        res = await client.put("/api/vocabulary/1", json={"meaning": ""})
        assert res.status_code == 422
