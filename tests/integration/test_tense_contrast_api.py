"""Integration tests for the Tense Contrast Drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestTenseContrastAPI:
    async def test_session_uses_fallback_when_copilot_fails(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.tense_contrast.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/tense-contrast/session", json={"count": 8}
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"].startswith("tc-")
        assert len(body["items"]) == 8
        for it in body["items"]:
            assert "____" in it["sentence_with_blank"]
            assert it["tense_label"] in {
                "past_simple",
                "present_perfect",
                "present_perfect_continuous",
            }
            assert it["correct_form"]

    async def test_submit_persists_attempts_then_stats_reflects(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.tense_contrast.get_copilot_service",
            return_value=mock,
        ):
            sess = await client.post(
                "/api/tense-contrast/session", json={"count": 8}
            )
        assert sess.status_code == 200
        body = sess.json()
        session_id = body["session_id"]
        items = body["items"]

        # Mark every-other answer correct, using the first accepted form
        answers = []
        for i, it in enumerate(items):
            correct = i % 2 == 0
            answers.append({
                "item_id": it["id"],
                "user_answer": it["correct_form"][0] if correct else "nope",
                "correct": correct,
                "tense_label": it["tense_label"],
                "elapsed_ms": 1500,
            })
        submit = await client.post(
            "/api/tense-contrast/submit",
            json={"session_id": session_id, "answers": answers},
        )
        assert submit.status_code == 200
        assert submit.json()["inserted"] == len(answers)

        stats = await client.get("/api/tense-contrast/stats?days=30")
        assert stats.status_code == 200
        data = stats.json()
        assert data["days"] == 30
        assert data["total"] == len(answers)
        assert data["correct"] == sum(1 for a in answers if a["correct"])
        assert set(data["by_tense"].keys()) >= {
            "past_simple", "present_perfect", "present_perfect_continuous"
        }

    async def test_session_count_query_param_works(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.tense_contrast.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post("/api/tense-contrast/session?count=5")
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 5
