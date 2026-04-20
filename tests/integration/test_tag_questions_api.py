"""Integration test for the Tag Question Drill happy path (GET + POST)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestTagQuestionsAPI:
    async def test_happy_path_session_then_attempt(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={
            "items": [
                {
                    "statement": "You're joining us,",
                    "expected_tag": "aren't you",
                    "expected_intonation": "falling",
                    "context_hint": "You already expect yes.",
                    "explanation": "Positive statement → negative tag, falling tone.",
                }
            ] * 8
        })
        with patch(
            "app.routers.tag_questions.get_copilot_service", return_value=mock
        ):
            sess = await client.get(
                "/api/tag-questions/session?difficulty=beginner&count=8"
            )

        assert sess.status_code == 200
        body = sess.json()
        assert body["difficulty"] == "beginner"
        assert len(body["items"]) == 8
        first = body["items"][0]
        assert first["statement"]
        assert first["expected_tag"]
        assert first["expected_intonation"] in {"rising", "falling"}

        # Submit a correct attempt mirroring the first item.
        attempt = await client.post(
            "/api/tag-questions/attempt",
            json={
                "statement": first["statement"],
                "expected_tag": first["expected_tag"],
                "expected_intonation": first["expected_intonation"],
                "user_tag": first["expected_tag"],
                "user_intonation": first["expected_intonation"],
            },
        )
        assert attempt.status_code == 200
        data = attempt.json()
        assert data["tag_correct"] is True
        assert data["intonation_correct"] is True
        assert data["score"] == 100

    async def test_fallback_session_then_attempt(self, client: AsyncClient):
        """When Copilot is unavailable, the static bank still yields a valid session."""
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.tag_questions.get_copilot_service", return_value=mock
        ):
            sess = await client.get(
                "/api/tag-questions/session?difficulty=intermediate&count=8"
            )

        assert sess.status_code == 200
        items = sess.json()["items"]
        assert len(items) == 8

        it = items[0]
        # Submit a wrong intonation attempt
        attempt = await client.post(
            "/api/tag-questions/attempt",
            json={
                "statement": it["statement"],
                "expected_tag": it["expected_tag"],
                "expected_intonation": it["expected_intonation"],
                "user_tag": it["expected_tag"],
                "user_intonation": (
                    "rising" if it["expected_intonation"] == "falling" else "falling"
                ),
            },
        )
        assert attempt.status_code == 200
        data = attempt.json()
        assert data["tag_correct"] is True
        assert data["intonation_correct"] is False
        assert data["score"] == 70
