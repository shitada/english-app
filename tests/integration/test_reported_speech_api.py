"""Integration tests for the Reported Speech drill API."""

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
class TestReportedSpeechAPI:
    async def test_session_uses_fallback_when_copilot_fails(
        self, client: AsyncClient
    ):
        mock = _mock_copilot(ask_json_side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/reported-speech/session", json={"count": 5}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"].startswith("rs-")
        assert len(body["items"]) == 5
        for it in body["items"]:
            assert it["direct"]
            assert it["reference"]
            assert it["focus_tags"]

    async def test_session_count_query_param_works(
        self, client: AsyncClient
    ):
        mock = _mock_copilot(ask_json_side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/reported-speech/session?count=3"
            )
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 3

    async def test_session_uses_llm_when_payload_valid(
        self, client: AsyncClient
    ):
        llm_items = {
            "items": [
                {
                    "id": f"llm{i}",
                    "direct": f'She said, "Item {i}."',
                    "context_hint": "Report what she said.",
                    "reference": f"She said that item {i}.",
                    "accepted_variants": [],
                    "focus_tags": ["backshift", "pronoun"],
                }
                for i in range(5)
            ]
        }
        mock = _mock_copilot(ask_json_return=llm_items)
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/reported-speech/session", json={"count": 5}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert [it["id"] for it in body["items"]] == [
            f"llm{i}" for i in range(5)
        ]

    async def test_grade_exact_match_returns_100_and_persists(
        self, client: AsyncClient
    ):
        payload = {
            "item_id": "rs01",
            "direct": 'She said, "I am tired."',
            "reference": "She said that she was tired.",
            "accepted_variants": [],
            "focus_tags": ["backshift", "pronoun"],
            "user_answer": "She said that she was tired.",
        }
        mock = _mock_copilot(
            ask_json_side_effect=RuntimeError("should not be called")
        )
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/reported-speech/grade", json=payload
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["correct"] is True
        assert body["score"] == 100
        assert body["matched"] == "exact"
        # Weakness should still be empty (backshift/pronoun at 100%)
        w = await client.get("/api/reported-speech/weakness?limit=20")
        assert w.status_code == 200
        assert w.json()["tags"] == []

    async def test_grade_variant_match_returns_100(self, client: AsyncClient):
        payload = {
            "item_id": "rs01",
            "direct": 'She said, "I am tired."',
            "reference": "She said that she was tired.",
            "accepted_variants": ["She said she was tired."],
            "focus_tags": ["backshift"],
            "user_answer": "She said she was tired!",
        }
        mock = _mock_copilot(
            ask_json_side_effect=RuntimeError("should not be called")
        )
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/reported-speech/grade", json=payload
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["correct"] is True
        assert body["score"] == 100
        assert body["matched"] == "variant"

    async def test_grade_llm_wrong_answer_persists_and_returns_score(
        self, client: AsyncClient
    ):
        payload = {
            "item_id": "rs01",
            "direct": 'She said, "I am tired."',
            "reference": "She said that she was tired.",
            "accepted_variants": [],
            "focus_tags": ["backshift", "pronoun"],
            "user_answer": "She says she is tired.",
        }
        mock = _mock_copilot(ask_json_return={
            "correct": False,
            "score": 45,
            "feedback": "Missing backshift to past tense.",
            "diff_highlights": [
                {"kind": "missing", "text": "was"},
                {"kind": "wrong", "text": "is"},
            ],
        })
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/reported-speech/grade", json=payload
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["correct"] is False
        assert body["score"] == 45
        assert body["matched"] == "llm"
        assert any(
            d["kind"] == "missing" and d["text"] == "was"
            for d in body["diff_highlights"]
        )

    async def test_grade_fallback_when_llm_unavailable(
        self, client: AsyncClient
    ):
        payload = {
            "item_id": "rs01",
            "direct": 'She said, "I am tired."',
            "reference": "She said that she was tired.",
            "accepted_variants": [],
            "focus_tags": ["backshift"],
            "user_answer": "She said she was very tired",
        }
        mock = _mock_copilot(ask_json_side_effect=RuntimeError("offline"))
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            resp = await client.post(
                "/api/reported-speech/grade", json=payload
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] == "fallback"
        assert 0 <= body["score"] <= 100
        # Diff highlights should be computed from tokens
        assert isinstance(body["diff_highlights"], list)

    async def test_weakness_endpoint_reflects_persisted_attempts(
        self, client: AsyncClient
    ):
        mock = _mock_copilot(ask_json_return={
            "correct": False,
            "score": 20,
            "feedback": "Bad",
            "diff_highlights": [],
        })
        with patch(
            "app.routers.reported_speech.get_copilot_service",
            return_value=mock,
        ):
            # 3 wrong backshift attempts
            for _ in range(3):
                await client.post("/api/reported-speech/grade", json={
                    "item_id": "rs01",
                    "direct": "d",
                    "reference": "She said that she was tired.",
                    "accepted_variants": [],
                    "focus_tags": ["backshift"],
                    "user_answer": "something totally different",
                })
        w = await client.get("/api/reported-speech/weakness?limit=20")
        assert w.status_code == 200
        body = w.json()
        tags = {t["tag"] for t in body["tags"]}
        assert "backshift" in tags

    async def test_grade_empty_user_answer_rejected(
        self, client: AsyncClient
    ):
        resp = await client.post("/api/reported-speech/grade", json={
            "item_id": "rs01",
            "direct": "d",
            "reference": "r",
            "accepted_variants": [],
            "focus_tags": ["backshift"],
            "user_answer": "",
        })
        assert resp.status_code == 422
