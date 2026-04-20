"""Integration tests for the Article Chip Drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


FIXED_PAYLOAD = {
    "items": [
        {
            "id": f"f{i:02d}",
            "sentence_template": "I saw __1__ cat.",
            "blanks": [
                {
                    "index": 1,
                    "answer": "a",
                    "rule_category": "indefinite_consonant",
                    "hint": "consonant sound → a",
                }
            ],
        }
        for i in range(1, 9)
    ]
}


@pytest.mark.integration
class TestArticleDrillAPI:
    async def test_session_uses_fallback_when_copilot_fails(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.articles.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.get("/api/articles/session?difficulty=medium")

        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"].startswith("art-")
        assert body["difficulty"] == "medium"
        assert len(body["items"]) == 8
        for it in body["items"]:
            assert "__1__" in it["sentence_template"]
            assert it["blanks"]
            for b in it["blanks"]:
                assert b["answer"] in {"a", "an", "the", "none"}
                assert b["rule_category"]

    async def test_session_uses_llm_payload_when_valid(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value=FIXED_PAYLOAD)
        with patch(
            "app.routers.articles.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.get("/api/articles/session?difficulty=easy")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["items"]) == 8
        assert body["items"][0]["blanks"][0]["answer"] == "a"

    async def test_invalid_difficulty_returns_422(self, client: AsyncClient):
        resp = await client.get("/api/articles/session?difficulty=impossible")
        assert resp.status_code == 422

    async def test_submit_scores_and_persists(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value=FIXED_PAYLOAD)
        with patch(
            "app.routers.articles.get_copilot_service",
            return_value=mock,
        ):
            sess = await client.get("/api/articles/session?difficulty=easy")
        assert sess.status_code == 200
        items = sess.json()["items"]

        # Mark half correct, half wrong
        submit_items = []
        for i, it in enumerate(items):
            correct = i % 2 == 0
            submit_items.append(
                {
                    "id": it["id"],
                    "sentence_template": it["sentence_template"],
                    "blanks": it["blanks"],
                    "user_answers": ["a" if correct else "the"],
                }
            )
        resp = await client.post(
            "/api/articles/submit",
            json={"difficulty": "easy", "items": submit_items},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_count"] == 8
        assert data["correct_count"] == 4
        assert abs(data["accuracy"] - 0.5) < 1e-6
        assert len(data["per_blank_results"]) == 8
        assert "indefinite_consonant" in data["category_breakdown"]
        assert data["category_breakdown"]["indefinite_consonant"]["total"] == 8

        # Stats should reflect persisted row
        stats = await client.get("/api/articles/stats?days=30")
        assert stats.status_code == 200
        sd = stats.json()
        assert sd["total"] == 8
        assert sd["correct"] == 4

    async def test_submit_rejects_empty_items(self, client: AsyncClient):
        resp = await client.post(
            "/api/articles/submit",
            json={"difficulty": "easy", "items": []},
        )
        assert resp.status_code == 422

    async def test_submit_rejects_invalid_difficulty(
        self, client: AsyncClient
    ):
        resp = await client.post(
            "/api/articles/submit",
            json={
                "difficulty": "impossible",
                "items": [
                    {
                        "id": "x",
                        "sentence_template": "I saw __1__ cat.",
                        "blanks": [
                            {
                                "index": 1,
                                "answer": "a",
                                "rule_category": "indefinite_consonant",
                                "hint": "",
                            }
                        ],
                        "user_answers": ["a"],
                    }
                ],
            },
        )
        assert resp.status_code == 422

    async def test_all_correct_scoring(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value=FIXED_PAYLOAD)
        with patch(
            "app.routers.articles.get_copilot_service",
            return_value=mock,
        ):
            sess = await client.get("/api/articles/session?difficulty=easy")
        items = sess.json()["items"]
        submit_items = [
            {
                "id": it["id"],
                "sentence_template": it["sentence_template"],
                "blanks": it["blanks"],
                "user_answers": ["a"],
            }
            for it in items
        ]
        resp = await client.post(
            "/api/articles/submit",
            json={"difficulty": "easy", "items": submit_items},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["correct_count"] == 8
        assert data["total_count"] == 8
        assert data["accuracy"] == 1.0

    async def test_stats_empty_returns_zero(self, client: AsyncClient):
        resp = await client.get("/api/articles/stats?days=30")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["correct"] == 0
        assert data["weakest_category"] is None
