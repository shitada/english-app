"""Integration tests for the Listen & Summarize listening endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestListenSummarizePassageAPI:

    async def test_returns_valid_llm_passage(self, client: AsyncClient):
        passage_text = (
            "Last weekend a small town held its yearly tomato festival. "
            "Thousands of visitors threw ripe tomatoes at each other for "
            "one hour in the main square. Organizers used many kilos of "
            "overripe fruit donated by local farmers. Cleanup crews washed "
            "the streets afterward and reported no serious injuries."
        )
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={
            "text": passage_text,
            "key_points": [
                "A town held its yearly tomato festival",
                "People threw tomatoes for one hour",
                "Local farmers donated overripe fruit",
                "No serious injuries were reported",
            ],
            "target_min_words": 15,
            "target_max_words": 35,
            "genre": "news",
        })
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.post(
                "/api/listening/summarize/passage",
                json={"level": "intermediate", "genre": "news"},
            )
        assert res.status_code == 200
        data = res.json()
        assert data["passage_id"]
        assert data["text"] == passage_text
        assert len(data["key_points"]) == 4
        assert data["target_min_words"] < data["target_max_words"]
        assert data["level"] == "intermediate"
        assert data["genre"] == "news"

    async def test_falls_back_on_malformed_llm(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={"foo": "bar"})
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.post(
                "/api/listening/summarize/passage",
                json={"level": "advanced"},
            )
        assert res.status_code == 200
        data = res.json()
        assert data["text"]
        assert 3 <= len(data["key_points"]) <= 5
        assert data["level"] == "advanced"

    async def test_falls_back_on_llm_exception(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.post(
                "/api/listening/summarize/passage",
                json={"level": "beginner"},
            )
        assert res.status_code == 200
        assert res.json()["text"]

    async def test_invalid_level_normalized(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.post(
                "/api/listening/summarize/passage",
                json={"level": "expert"},
            )
        assert res.status_code == 200
        assert res.json()["level"] == "intermediate"

    async def test_passage_id_is_deterministic(self, client: AsyncClient):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("boom"))
        # Force the same fallback by pinning random.choice
        with patch("app.routers.listening.get_copilot_service", return_value=mock), \
             patch("app.routers.listening.random.choice",
                   side_effect=lambda seq: seq[0]):
            r1 = await client.post(
                "/api/listening/summarize/passage", json={"level": "intermediate"}
            )
            r2 = await client.post(
                "/api/listening/summarize/passage", json={"level": "intermediate"}
            )
        assert r1.status_code == r2.status_code == 200
        assert r1.json()["passage_id"] == r2.json()["passage_id"]


@pytest.mark.integration
class TestListenSummarizeGradeAPI:

    BASE_BODY = {
        "passage_id": "abc123",
        "passage_text": (
            "Maya bought an old bicycle at a garage sale for ten dollars. "
            "Over two weekends she repaired it. On Monday she rode it to "
            "work and saved time and bus fare."
        ),
        "key_points": [
            "Maya bought a cheap old bicycle",
            "She spent two weekends repairing it",
            "She rode it to work on Monday",
        ],
        "summary": "Maya bought a cheap old bicycle, fixed it over two weekends, and rode it to work.",
        "used_voice": True,
        "plays_used": 2,
        "level": "intermediate",
        "target_min_words": 12,
        "target_max_words": 30,
    }

    async def test_grade_with_llm_response_and_records_attempt(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(return_value={
            "coverage": [
                {"point": "Maya bought a cheap old bicycle",
                 "covered": True, "evidence": "bought a cheap old bicycle"},
                {"point": "She spent two weekends repairing it",
                 "covered": True, "evidence": "fixed it over two weekends"},
                {"point": "She rode it to work on Monday",
                 "covered": False, "evidence": ""},
            ],
            "conciseness_score": 0.9,
            "accuracy_score": 1.0,
            "overall": 0.78,
            "feedback": "Nice — try to mention Monday next time.",
        })
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.post(
                "/api/listening/summarize/grade", json=self.BASE_BODY
            )
        assert res.status_code == 200
        data = res.json()
        assert len(data["coverage"]) == 3
        assert data["coverage"][0]["covered"] is True
        assert data["coverage_ratio"] == pytest.approx(2 / 3, rel=1e-3)
        assert data["conciseness_score"] == pytest.approx(0.9)
        assert data["accuracy_score"] == pytest.approx(1.0)
        assert data["overall"] == pytest.approx(0.78)
        assert "Monday" in data["feedback"]
        assert data["summary_word_count"] > 0

        # Stats endpoint should now report one attempt
        stats_res = await client.get("/api/listening/summarize/stats")
        assert stats_res.status_code == 200
        s = stats_res.json()
        assert s["total"] == 1
        assert s["average"] == pytest.approx(0.78)

    async def test_grade_falls_back_to_heuristic_on_llm_failure(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        mock.ask_json = AsyncMock(side_effect=RuntimeError("nope"))
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            res = await client.post(
                "/api/listening/summarize/grade", json=self.BASE_BODY
            )
        assert res.status_code == 200
        data = res.json()
        assert len(data["coverage"]) == 3
        # Heuristic should mark the first two key points as covered (the
        # learner summary contains "bicycle", "weekends", "repairing"-ish via
        # tokens) and miss the Monday/work one.
        covered = [c["covered"] for c in data["coverage"]]
        assert covered[0] is True
        assert covered[1] is True
        # overall is the heuristic blended score.
        assert 0.0 <= data["overall"] <= 1.0
        assert data["feedback"]

    async def test_grade_rejects_empty_summary_via_validation(
        self, client: AsyncClient
    ):
        body = dict(self.BASE_BODY)
        body["summary"] = ""
        res = await client.post("/api/listening/summarize/grade", json=body)
        assert res.status_code == 422

    async def test_grade_rejects_empty_key_points(
        self, client: AsyncClient
    ):
        body = dict(self.BASE_BODY)
        body["key_points"] = []
        res = await client.post("/api/listening/summarize/grade", json=body)
        # min_length=1 on the field raises 422 before reaching handler.
        assert res.status_code == 422


@pytest.mark.integration
class TestListenSummarizeStatsAPI:

    async def test_stats_empty_initial_state(self, client: AsyncClient):
        res = await client.get("/api/listening/summarize/stats?days=7")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 0
        assert data["average"] == 0.0
        assert data["best"] == 0.0
        assert data["streak"] == 0
        assert data["threshold"] == pytest.approx(0.7)
        assert data["sparkline"] == []

    async def test_stats_reflects_recorded_attempts_and_streak(
        self, client: AsyncClient
    ):
        mock = MagicMock()
        # Force overall=0.9 on each grade call so attempts are above threshold.
        mock.ask_json = AsyncMock(return_value={
            "coverage": [
                {"point": "kp1", "covered": True, "evidence": "x"},
                {"point": "kp2", "covered": True, "evidence": "y"},
            ],
            "conciseness_score": 1.0,
            "accuracy_score": 1.0,
            "overall": 0.9,
            "feedback": "Great",
        })
        body = {
            "passage_id": "p1",
            "passage_text": "Some passage text used for grading purposes.",
            "key_points": ["kp1", "kp2"],
            "summary": "kp1 and kp2 covered well.",
            "used_voice": False,
            "plays_used": 1,
            "level": "intermediate",
            "target_min_words": 5,
            "target_max_words": 20,
        }
        with patch("app.routers.listening.get_copilot_service", return_value=mock):
            for _ in range(3):
                r = await client.post(
                    "/api/listening/summarize/grade", json=body
                )
                assert r.status_code == 200

        res = await client.get(
            "/api/listening/summarize/stats?days=7&threshold=0.7"
        )
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 3
        assert data["average"] == pytest.approx(0.9)
        assert data["best"] == pytest.approx(0.9)
        assert data["streak"] == 3
        assert len(data["sparkline"]) == 1
        assert data["sparkline"][0]["attempts"] == 3
