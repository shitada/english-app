"""Integration tests for the WH-Question Formation drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestWhQuestionsAPI:
    async def test_start_uses_fallback_when_copilot_fails(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.wh_questions.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/wh-questions/start", json={"count": 5}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["items"]) == 5
        for it in body["items"]:
            assert it["target_wh"] in {"who", "what", "when", "where", "why", "how"}
            assert it["answer_sentence"]
            assert it["id"]

    async def test_grade_persists_attempt_and_returns_llm_verdict(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={
            "correctness": True,
            "wh_word_matches": True,
            "grammar_ok": True,
            "feedback": "Nice work.",
            "corrected": "Why did she leave at 7 a.m.?",
        })
        with patch(
            "app.routers.wh_questions.get_copilot_service",
            return_value=mock,
        ):
            grade = await client.post(
                "/api/wh-questions/grade",
                json={
                    "item_id": "wh-1",
                    "answer_sentence": "She left at 7 a.m. because she had a meeting.",
                    "target_wh": "why",
                    "user_question": "Why did she leave at 7 a.m.?",
                },
            )
        assert grade.status_code == 200
        data = grade.json()
        assert data["correctness"] is True
        assert data["corrected"].startswith("Why")
        assert data["feedback"] == "Nice work."

        # Stats should now reflect the persisted row
        stats = await client.get("/api/wh-questions/stats?limit=30")
        assert stats.status_code == 200
        s = stats.json()
        assert s["total"] == 1
        assert s["correct"] == 1
        assert s["by_wh"]["why"]["total"] == 1

    async def test_grade_falls_back_to_heuristic_on_llm_failure(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.wh_questions.get_copilot_service",
            return_value=mock,
        ):
            grade = await client.post(
                "/api/wh-questions/grade",
                json={
                    "item_id": "wh-2",
                    "answer_sentence": "They got to the airport by taxi.",
                    "target_wh": "how",
                    "user_question": "How did they get to the airport?",
                },
            )
        assert grade.status_code == 200
        data = grade.json()
        # Heuristic should accept this well-formed wh-question
        assert data["wh_word_matches"] is True
        assert data["grammar_ok"] is True
        assert data["correctness"] is True

    async def test_grade_rejects_invalid_target_wh(self, client: AsyncClient):
        resp = await client.post(
            "/api/wh-questions/grade",
            json={
                "item_id": "wh-x",
                "answer_sentence": "Some sentence.",
                "target_wh": "bogus",
                "user_question": "What is this?",
            },
        )
        assert resp.status_code == 400
