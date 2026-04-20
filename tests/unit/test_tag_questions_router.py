"""Unit tests for the Tag Question Drill router helpers + endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.routers.tag_questions import (
    _FALLBACK_BANK,
    build_fallback_session,
    coerce_session_payload,
    grade_attempt,
    normalize_intonation,
    normalize_tag,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestNormalizeTag:
    def test_lowercase_and_strip(self):
        assert normalize_tag("  Aren't You?  ") == "aren't you"

    def test_strips_trailing_punctuation(self):
        assert normalize_tag("isn't it!!") == "isn't it"

    def test_handles_missing_apostrophe(self):
        assert normalize_tag("arent you") == "aren't you"
        assert normalize_tag("doesnt she") == "doesn't she"

    def test_empty_returns_empty(self):
        assert normalize_tag("") == ""
        assert normalize_tag("   ") == ""

    def test_collapses_whitespace(self):
        assert normalize_tag("don't    they") == "don't they"


@pytest.mark.unit
class TestNormalizeIntonation:
    def test_direct_values(self):
        assert normalize_intonation("rising") == "rising"
        assert normalize_intonation("Falling") == "falling"

    def test_arrows(self):
        assert normalize_intonation("↗") == "rising"
        assert normalize_intonation("↘") == "falling"

    def test_synonyms(self):
        assert normalize_intonation("rise") == "rising"
        assert normalize_intonation("down") == "falling"


@pytest.mark.unit
class TestGradeAttempt:
    def test_correct_tag_and_intonation(self):
        r = grade_attempt("aren't you", "falling", "aren't you", "falling")
        assert r["tag_correct"] is True
        assert r["intonation_correct"] is True
        assert r["score"] == 100

    def test_wrong_tag_right_intonation(self):
        r = grade_attempt("aren't you", "falling", "isn't it", "falling")
        assert r["tag_correct"] is False
        assert r["intonation_correct"] is True
        assert r["score"] == 30
        assert "aren't you" in r["feedback"]

    def test_right_tag_wrong_intonation(self):
        r = grade_attempt("aren't you", "falling", "aren't you", "rising")
        assert r["tag_correct"] is True
        assert r["intonation_correct"] is False
        assert r["score"] == 70
        assert "falling" in r["feedback"]

    def test_both_wrong(self):
        r = grade_attempt("aren't you", "falling", "", "rising")
        assert r["tag_correct"] is False
        assert r["intonation_correct"] is False
        assert r["score"] == 0

    def test_normalization_accepts_typo_variant(self):
        # "arent you?" should count as correct vs "aren't you"
        r = grade_attempt("aren't you", "falling", "Arent you?", "falling")
        assert r["tag_correct"] is True
        assert r["intonation_correct"] is True
        assert r["score"] == 100

    def test_arrow_intonation_accepted(self):
        r = grade_attempt("do they", "rising", "do they", "↗")
        assert r["tag_correct"] is True
        assert r["intonation_correct"] is True


@pytest.mark.unit
class TestCoerceSessionPayload:
    def test_valid_payload(self):
        raw = {
            "items": [
                {
                    "statement": "You're coming,",
                    "expected_tag": "aren't you",
                    "expected_intonation": "falling",
                    "context_hint": "You already expect yes.",
                    "explanation": "Positive → negative tag.",
                }
            ]
        }
        items = coerce_session_payload(raw, "beginner")
        assert items is not None
        assert len(items) == 1
        assert items[0]["difficulty"] == "beginner"
        assert items[0]["expected_intonation"] == "falling"

    def test_missing_fields_rejected(self):
        assert coerce_session_payload({"items": [{}]}, "beginner") is None

    def test_bad_intonation_item_dropped(self):
        raw = {
            "items": [
                {
                    "statement": "S,",
                    "expected_tag": "is it",
                    "expected_intonation": "sideways",
                    "context_hint": "",
                    "explanation": "",
                },
                {
                    "statement": "You're here,",
                    "expected_tag": "aren't you",
                    "expected_intonation": "falling",
                    "context_hint": "",
                    "explanation": "",
                },
            ]
        }
        items = coerce_session_payload(raw, "beginner")
        assert items is not None
        assert len(items) == 1

    def test_non_dict_returns_none(self):
        assert coerce_session_payload("nope", "beginner") is None
        assert coerce_session_payload({"items": []}, "beginner") is None


@pytest.mark.unit
class TestFallbackBank:
    def test_bank_has_at_least_eight_total(self):
        assert len(_FALLBACK_BANK) >= 8

    def test_fallback_session_returns_requested_count(self):
        s = build_fallback_session("beginner", 8, seed=1)
        assert len(s) == 8
        for it in s:
            assert it["expected_intonation"] in {"rising", "falling"}

    def test_fallback_for_unknown_difficulty_still_works(self):
        s = build_fallback_session("expert", 5, seed=1)
        assert len(s) == 5


# ---------------------------------------------------------------------------
# Endpoint tests with mocked Copilot
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestSessionEndpoint:
    async def test_returns_copilot_items_on_valid_payload(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={
            "items": [
                {
                    "statement": "You're listening,",
                    "expected_tag": "aren't you",
                    "expected_intonation": "falling",
                    "context_hint": "You can see them nodding.",
                    "explanation": "Positive → negative tag, falling = agreement.",
                }
            ] * 8
        })
        with patch(
            "app.routers.tag_questions.get_copilot_service", return_value=mock
        ):
            resp = await client.get(
                "/api/tag-questions/session?difficulty=beginner&count=8"
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty"] == "beginner"
        assert len(data["items"]) == 8
        assert data["items"][0]["expected_tag"] == "aren't you"

    async def test_falls_back_when_copilot_raises(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch(
            "app.routers.tag_questions.get_copilot_service", return_value=mock
        ):
            resp = await client.get(
                "/api/tag-questions/session?difficulty=intermediate&count=8"
            )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 8
        assert data["difficulty"] == "intermediate"

    async def test_falls_back_on_invalid_payload(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={"bogus": True})
        with patch(
            "app.routers.tag_questions.get_copilot_service", return_value=mock
        ):
            resp = await client.get(
                "/api/tag-questions/session?difficulty=advanced&count=5"
            )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 5

    async def test_unknown_difficulty_normalizes_to_beginner(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("x"))
        with patch(
            "app.routers.tag_questions.get_copilot_service", return_value=mock
        ):
            resp = await client.get(
                "/api/tag-questions/session?difficulty=wizard&count=3"
            )
        assert resp.status_code == 200
        assert resp.json()["difficulty"] == "beginner"


@pytest.mark.unit
class TestAttemptEndpoint:
    async def test_correct_attempt(self, client: AsyncClient):
        resp = await client.post(
            "/api/tag-questions/attempt",
            json={
                "statement": "You're coming,",
                "expected_tag": "aren't you",
                "expected_intonation": "falling",
                "user_tag": "aren't you",
                "user_intonation": "falling",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["tag_correct"] is True
        assert data["intonation_correct"] is True
        assert data["score"] == 100

    async def test_wrong_tag(self, client: AsyncClient):
        resp = await client.post(
            "/api/tag-questions/attempt",
            json={
                "statement": "She likes tea,",
                "expected_tag": "doesn't she",
                "expected_intonation": "falling",
                "user_tag": "isn't she",
                "user_intonation": "falling",
            },
        )
        data = resp.json()
        assert data["tag_correct"] is False
        assert data["intonation_correct"] is True
        assert data["score"] == 30

    async def test_wrong_intonation(self, client: AsyncClient):
        resp = await client.post(
            "/api/tag-questions/attempt",
            json={
                "statement": "You don't smoke,",
                "expected_tag": "do you",
                "expected_intonation": "rising",
                "user_tag": "do you",
                "user_intonation": "falling",
            },
        )
        data = resp.json()
        assert data["tag_correct"] is True
        assert data["intonation_correct"] is False
        assert data["score"] == 70

    async def test_normalization_accepts_missing_apostrophe(self, client: AsyncClient):
        resp = await client.post(
            "/api/tag-questions/attempt",
            json={
                "statement": "It's cold today,",
                "expected_tag": "isn't it",
                "expected_intonation": "falling",
                "user_tag": "isnt it?",
                "user_intonation": "falling",
            },
        )
        data = resp.json()
        assert data["tag_correct"] is True
        assert data["score"] == 100
