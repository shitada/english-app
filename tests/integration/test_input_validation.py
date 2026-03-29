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
