"""Integration tests for the Confusable Pairs picker drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


FIXED_PAYLOAD = {
    "items": [
        {
            "id": f"f{i:02d}",
            "sentence_with_blank": "Can I ____ your pen?",
            "options": ["borrow", "lend"],
            "correct_word": "borrow",
            "pair_key": "borrow_lend",
            "difficulty": "easy",
            "explanation": "borrow = take temporarily from someone",
            "example_sentence": "Can I borrow your pen?",
        }
        for i in range(1, 9)
    ]
}


@pytest.mark.integration
class TestConfusablePairsAPI:
    async def test_start_uses_fallback_when_copilot_fails(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.confusable_pairs.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post("/api/confusable-pairs/start", json={})

        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"].startswith("cp-")
        assert len(body["items"]) == 8
        for it in body["items"]:
            assert "____" in it["sentence_with_blank"]
            assert len(it["options"]) == 2
            assert it["pair_key"]

    async def test_start_uses_llm_payload_when_valid(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value=FIXED_PAYLOAD)
        with patch(
            "app.routers.confusable_pairs.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/confusable-pairs/start",
                json={"count": 8, "difficulty": "easy"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["items"]) == 8
        assert body["items"][0]["options"] == ["borrow", "lend"]

    async def test_start_invalid_pair_key_returns_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/confusable-pairs/start",
            json={"pair_key": "not_a_pair"},
        )
        assert resp.status_code == 422

    async def test_answer_persists_and_returns_feedback(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.confusable_pairs.get_copilot_service",
            return_value=mock,
        ):
            start = await client.post("/api/confusable-pairs/start", json={})
        sid = start.json()["session_id"]
        first = start.json()["items"][0]

        # Pick the wrong option to exercise explanation path.
        wrong = next(o for o in first["options"])
        # actually pick a guaranteed value: the first option, which may or may
        # not be correct depending on the item — we just check the API shape.
        resp = await client.post(
            "/api/confusable-pairs/answer",
            json={
                "session_id": sid,
                "item_id": first["id"],
                "choice": wrong,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "correct" in body
        assert body["correct_word"]
        assert body["explanation"]
        assert body["example_sentence"]
        assert "____" not in body["example_sentence"]

    async def test_answer_unknown_session_returns_404(self, client: AsyncClient):
        resp = await client.post(
            "/api/confusable-pairs/answer",
            json={
                "session_id": "cp-does-not-exist",
                "item_id": "x",
                "choice": "affect",
            },
        )
        assert resp.status_code == 404

    async def test_answer_unknown_item_returns_404(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.confusable_pairs.get_copilot_service",
            return_value=mock,
        ):
            start = await client.post("/api/confusable-pairs/start", json={})
        sid = start.json()["session_id"]
        resp = await client.post(
            "/api/confusable-pairs/answer",
            json={"session_id": sid, "item_id": "no-such-item", "choice": "x"},
        )
        assert resp.status_code == 404

    async def test_summary_reports_weakest_pair(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.confusable_pairs.get_copilot_service",
            return_value=mock,
        ):
            start = await client.post(
                "/api/confusable-pairs/start",
                json={"count": 4},
            )
        body = start.json()
        sid = body["session_id"]

        # Answer every item deliberately wrong by picking the NON-correct option.
        # We know the full item from the server-side store, so we infer by
        # picking the first option; it's fine if some happen to be correct —
        # the summary endpoint should still return a dict + a weakest_pair.
        for it in body["items"]:
            choice = it["options"][0]
            r = await client.post(
                "/api/confusable-pairs/answer",
                json={
                    "session_id": sid,
                    "item_id": it["id"],
                    "choice": choice,
                },
            )
            assert r.status_code == 200

        summary = await client.get(f"/api/confusable-pairs/summary/{sid}")
        assert summary.status_code == 200
        s = summary.json()
        assert s["total"] == 4
        assert isinstance(s["per_pair_accuracy"], dict)
        assert s["weakest_pair"] is not None

    async def test_summary_null_weakest_when_no_attempts(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.confusable_pairs.get_copilot_service",
            return_value=mock,
        ):
            start = await client.post("/api/confusable-pairs/start", json={})
        sid = start.json()["session_id"]
        resp = await client.get(f"/api/confusable-pairs/summary/{sid}")
        assert resp.status_code == 200
        s = resp.json()
        assert s["total"] == 0
        assert s["weakest_pair"] is None
        assert s["per_pair_accuracy"] == {}

    async def test_summary_unknown_session_returns_404(self, client: AsyncClient):
        resp = await client.get("/api/confusable-pairs/summary/cp-missing")
        assert resp.status_code == 404
