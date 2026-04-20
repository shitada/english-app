"""Integration tests for the Error Correction Drill API."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


def _fallback_mock():
    mock = MagicMock()
    mock.ask_json = AsyncMock(side_effect=RuntimeError("offline"))
    return mock


@pytest.mark.integration
class TestErrorCorrectionAPI:
    async def test_start_uses_fallback_and_persists_items(
        self, client: AsyncClient
    ):
        with patch(
            "app.routers.error_correction.get_copilot_service",
            return_value=_fallback_mock(),
        ):
            resp = await client.post(
                "/api/error-correction/start",
                json={"category": "tense", "level": "beginner", "count": 5},
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["category"] == "tense"
        assert body["level"] == "beginner"
        assert body["session_id"].startswith("ec-")
        assert len(body["items"]) == 5
        for it in body["items"]:
            assert it["id"] and it["wrong"] and it["error_type"]
            # the reference should NOT leak to the client
            assert "reference" not in it

    async def test_grade_correct_and_wrong_then_finish(self, client: AsyncClient):
        # Deterministic start via fallback
        with patch(
            "app.routers.error_correction.get_copilot_service",
            return_value=_fallback_mock(),
        ):
            start = await client.post(
                "/api/error-correction/start",
                json={"category": "tense", "level": "beginner", "count": 2},
            )
        body = start.json()
        sid = body["session_id"]
        first, second = body["items"][0], body["items"][1]

        # Fetch references directly from DB via a second call to avoid mock
        # dependency. We instead POST the reference that we know is stored.
        # For fallback items we can read the wrong->reference mapping via
        # error_correction._FALLBACK_BANK — but easier to just submit the
        # wrong sentence itself to get an INCORRECT, and whatever reference
        # the stored item has via a "correct" submission from the DB.
        # Instead: the fallback ITEM's wrong text uniquely maps to a known
        # reference, so we use the bank.
        from app.routers.error_correction import _FALLBACK_BANK

        def _ref_for(wrong: str) -> str:
            for it in _FALLBACK_BANK:
                if it["wrong"] == wrong:
                    return it["reference"]
            raise AssertionError(f"Unknown wrong sentence: {wrong}")

        # --- correct grade ---
        correct_ref = _ref_for(first["wrong"])
        with patch(
            "app.routers.error_correction.get_copilot_service",
            return_value=_fallback_mock(),
        ):
            g1 = await client.post(
                "/api/error-correction/grade",
                json={
                    "session_id": sid,
                    "item_id": first["id"],
                    "user_answer": correct_ref,
                },
            )
        assert g1.status_code == 200, g1.text
        d1 = g1.json()
        assert d1["is_correct"] is True
        assert d1["reference"] == correct_ref
        assert isinstance(d1["diff"], list) and d1["diff"]
        # All diff tokens should be 'same' when exact match.
        assert all(tok["status"] == "same" for tok in d1["diff"])

        # --- wrong grade (borderline grader says False) ---
        wrong_mock = MagicMock()
        wrong_mock.ask_json = AsyncMock(return_value={
            "is_correct": False, "explanation_ja": "まだ文法が違います",
        })
        with patch(
            "app.routers.error_correction.get_copilot_service",
            return_value=wrong_mock,
        ):
            g2 = await client.post(
                "/api/error-correction/grade",
                json={
                    "session_id": sid,
                    "item_id": second["id"],
                    "user_answer": "completely different text here",
                },
            )
        assert g2.status_code == 200, g2.text
        d2 = g2.json()
        assert d2["is_correct"] is False
        assert d2["explanation_ja"] == "まだ文法が違います"
        # Diff should flag at least some tokens as insert or delete.
        statuses = {tok["status"] for tok in d2["diff"]}
        assert statuses & {"insert", "delete"}

        # --- finish ---
        fin = await client.post(
            "/api/error-correction/finish",
            json={"session_id": sid},
        )
        assert fin.status_code == 200, fin.text
        summary = fin.json()
        assert summary["total"] == 2
        assert summary["attempted"] == 2
        assert summary["correct"] == 1
        assert summary["score"] == 50
        assert len(summary["mistakes"]) == 1
        m = summary["mistakes"][0]
        assert m["id"] == second["id"]
        assert m["reference"] == _ref_for(second["wrong"])
        assert m["explanation_ja"] == "まだ文法が違います"

    async def test_grade_accepts_alternative_via_llm(self, client: AsyncClient):
        with patch(
            "app.routers.error_correction.get_copilot_service",
            return_value=_fallback_mock(),
        ):
            start = await client.post(
                "/api/error-correction/start",
                json={"category": "tense", "level": "beginner", "count": 1},
            )
        body = start.json()
        sid = body["session_id"]
        item = body["items"][0]

        # LLM says the alternative is valid.
        alt_mock = MagicMock()
        alt_mock.ask_json = AsyncMock(return_value={
            "is_correct": True, "explanation_ja": "",
        })
        with patch(
            "app.routers.error_correction.get_copilot_service",
            return_value=alt_mock,
        ):
            g = await client.post(
                "/api/error-correction/grade",
                json={
                    "session_id": sid,
                    "item_id": item["id"],
                    "user_answer": "an alternative valid correction sentence",
                },
            )
        assert g.status_code == 200, g.text
        assert g.json()["is_correct"] is True

    async def test_invalid_category_rejected(self, client: AsyncClient):
        resp = await client.post(
            "/api/error-correction/start",
            json={"category": "bogus", "level": "beginner", "count": 3},
        )
        assert resp.status_code == 400

    async def test_grade_unknown_item_404(self, client: AsyncClient):
        resp = await client.post(
            "/api/error-correction/grade",
            json={"session_id": "nope", "item_id": "nope", "user_answer": "x"},
        )
        assert resp.status_code == 404
