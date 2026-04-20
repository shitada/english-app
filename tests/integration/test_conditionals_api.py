"""Integration tests for the Conditional Transform Drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


def _mock_copilot(ask_json_side_effect=None, ask_json_return=None):
    mock = MagicMock()
    if ask_json_side_effect is not None:
        mock.ask_json = AsyncMock(side_effect=ask_json_side_effect)
    else:
        mock.ask_json = AsyncMock(return_value=ask_json_return or {})
    return mock


@pytest.mark.integration
class TestConditionalsAPI:
    async def test_prompt_falls_back_when_llm_fails(self, client: AsyncClient):
        mock = _mock_copilot(ask_json_side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.conditionals.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.get(
                "/api/conditionals/prompt?type=2&level=beginner"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["prompt_id"].startswith("cond-")
        assert body["target_type"] == 2
        assert body["level"] == "beginner"
        assert body["base_sentence"]

    async def test_prompt_uses_llm_when_payload_valid(self, client: AsyncClient):
        mock = _mock_copilot(ask_json_return={
            "base_sentence": "I don't know her number, so I can't call.",
            "hint": "Rewrite as Type-2 (unreal present).",
        })
        with patch(
            "app.routers.conditionals.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.get(
                "/api/conditionals/prompt?type=2&level=intermediate"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "I don't know her number" in body["base_sentence"]
        assert "Type-2" in body["hint"]

    async def test_prompt_invalid_type_returns_422(self, client: AsyncClient):
        resp = await client.get("/api/conditionals/prompt?type=9&level=beginner")
        assert resp.status_code == 422

    async def test_prompt_invalid_level_returns_422(self, client: AsyncClient):
        resp = await client.get(
            "/api/conditionals/prompt?type=1&level=expert"
        )
        assert resp.status_code == 422

    async def test_grade_unknown_prompt_id_404(self, client: AsyncClient):
        resp = await client.post(
            "/api/conditionals/grade",
            json={"prompt_id": "does-not-exist", "user_answer": "x"},
        )
        assert resp.status_code == 404

    async def test_grade_empty_user_answer_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/conditionals/grade",
            json={"prompt_id": "x", "user_answer": ""},
        )
        assert resp.status_code == 422

    async def test_full_flow_prompt_then_grade_persists_attempt(
        self, client: AsyncClient
    ):
        # Step 1: offline prompt
        offline = _mock_copilot(ask_json_side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.conditionals.get_copilot_service",
            return_value=offline,
        ):
            pr = await client.get(
                "/api/conditionals/prompt?type=2&level=intermediate"
            )
        assert pr.status_code == 200
        prompt_id = pr.json()["prompt_id"]

        # Step 2: grade via LLM (mocked to return a good response)
        grade_mock = _mock_copilot(ask_json_return={
            "correct": True,
            "score": 92,
            "model_answer": "If I had more time, I would travel.",
            "feedback": "Clean Type-2 structure.",
            "detected_type": 2,
            "issues": [],
        })
        with patch(
            "app.routers.conditionals.get_copilot_service",
            return_value=grade_mock,
        ):
            gr = await client.post(
                "/api/conditionals/grade",
                json={
                    "prompt_id": prompt_id,
                    "user_answer": "If I had more time, I would travel.",
                },
                headers={"X-User-Id": "alice"},
            )
        assert gr.status_code == 200
        body = gr.json()
        assert body["correct"] is True
        assert body["score"] == 92
        assert body["detected_type"] == 2
        assert body["model_answer"].startswith("If I had")

        # Step 3: history scoped by X-User-Id
        hist = await client.get(
            "/api/conditionals/history?limit=20",
            headers={"X-User-Id": "alice"},
        )
        assert hist.status_code == 200
        items = hist.json()["items"]
        assert len(items) == 1
        assert items[0]["target_type"] == 2
        assert items[0]["correct"] is True

        # Different user → empty history
        other = await client.get(
            "/api/conditionals/history",
            headers={"X-User-Id": "bob"},
        )
        assert other.status_code == 200
        assert other.json()["items"] == []

    async def test_grade_fallback_when_llm_fails(self, client: AsyncClient):
        # Create prompt with offline LLM (fallback)
        offline = _mock_copilot(ask_json_side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.conditionals.get_copilot_service",
            return_value=offline,
        ):
            pr = await client.get(
                "/api/conditionals/prompt?type=2&level=beginner"
            )
            prompt_id = pr.json()["prompt_id"]
            gr = await client.post(
                "/api/conditionals/grade",
                json={
                    "prompt_id": prompt_id,
                    "user_answer": "If I had money, I would buy it.",
                },
            )
        assert gr.status_code == 200
        body = gr.json()
        # heuristic detects Type-2 structure → correct
        assert body["detected_type"] == 2
        assert body["correct"] is True
        assert 0 <= body["score"] <= 100

    async def test_grade_llm_wrong_answer_returns_issues(
        self, client: AsyncClient
    ):
        offline = _mock_copilot(ask_json_side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.conditionals.get_copilot_service",
            return_value=offline,
        ):
            pr = await client.get(
                "/api/conditionals/prompt?type=3&level=beginner"
            )
        prompt_id = pr.json()["prompt_id"]

        grade_mock = _mock_copilot(ask_json_return={
            "correct": False,
            "score": 35,
            "model_answer": "If I had studied, I would have passed.",
            "feedback": "Use past perfect in the if-clause.",
            "detected_type": 2,
            "issues": ["wrong target type", "missing past perfect"],
        })
        with patch(
            "app.routers.conditionals.get_copilot_service",
            return_value=grade_mock,
        ):
            gr = await client.post(
                "/api/conditionals/grade",
                json={
                    "prompt_id": prompt_id,
                    "user_answer": "If I studied, I would pass.",
                },
            )
        assert gr.status_code == 200
        body = gr.json()
        assert body["correct"] is False
        assert body["score"] == 35
        assert body["detected_type"] == 2
        assert "missing past perfect" in body["issues"]
