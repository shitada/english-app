"""Integration tests for the Speed Ladder API."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.integration
class TestSpeedLadderAPI:

    async def test_start_returns_three_questions_with_distinct_speeds(
        self, client: AsyncClient
    ):
        resp = await client.post("/api/speed-ladder/start", json={})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["session_id"]
        assert isinstance(data["passage_text"], str) and len(data["passage_text"]) > 10
        questions = data["questions"]
        assert len(questions) == 3
        speeds = [q["speed"] for q in questions]
        assert speeds == [0.8, 1.0, 1.25]
        for q in questions:
            assert len(q["choices"]) == 4
            assert 0 <= q["correct_index"] < 4
            assert q["id"]

    async def test_start_uses_static_fallback_when_llm_fails(
        self, client: AsyncClient
    ):
        failing = AsyncMock(side_effect=RuntimeError("boom"))
        with patch(
            "app.routers.speed_ladder.get_copilot_service"
        ) as svc:
            svc.return_value.ask_json = failing
            resp = await client.post("/api/speed-ladder/start", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["questions"]) == 3
        assert [q["speed"] for q in data["questions"]] == [0.8, 1.0, 1.25]

    async def test_answer_records_attempt_and_returns_correctness(
        self, client: AsyncClient
    ):
        start = await client.post("/api/speed-ladder/start", json={})
        session = start.json()
        q = session["questions"][0]

        payload = {
            "session_id": session["session_id"],
            "question_id": q["id"],
            "choice_index": q["correct_index"],
            "speed": q["speed"],
            "correct_index": q["correct_index"],
            "explanation": q["explanation"],
        }
        resp = await client.post("/api/speed-ladder/answer", json=payload)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["correct"] is True
        assert body["correct_index"] == q["correct_index"]

        # Wrong answer
        wrong_choice = (q["correct_index"] + 1) % 4
        payload_wrong = {**payload, "choice_index": wrong_choice}
        resp2 = await client.post("/api/speed-ladder/answer", json=payload_wrong)
        assert resp2.status_code == 200
        assert resp2.json()["correct"] is False

    async def test_history_returns_per_speed_accuracy(self, client: AsyncClient):
        start = await client.post("/api/speed-ladder/start", json={})
        session = start.json()
        sid = session["session_id"]

        # Submit answers: correct at 0.8, wrong at 1.0, correct at 1.25.
        for idx, q in enumerate(session["questions"]):
            chosen = q["correct_index"] if idx != 1 else (q["correct_index"] + 1) % 4
            await client.post(
                "/api/speed-ladder/answer",
                json={
                    "session_id": sid,
                    "question_id": q["id"],
                    "choice_index": chosen,
                    "speed": q["speed"],
                    "correct_index": q["correct_index"],
                    "explanation": q["explanation"],
                },
            )

        resp = await client.get("/api/speed-ladder/history?limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sessions"]) == 1
        sess = data["sessions"][0]
        assert sess["session_id"] == sid
        assert sess["total"] == 3
        assert sess["correct"] == 2
        assert sess["by_speed"]["0.8"]["accuracy"] == pytest.approx(1.0)
        assert sess["by_speed"]["1"]["accuracy"] == pytest.approx(0.0)
        assert sess["by_speed"]["1.25"]["accuracy"] == pytest.approx(1.0)
        # overall_by_speed should reflect the same aggregate.
        assert data["overall_by_speed"]["0.8"]["total"] == 1

    async def test_history_empty_initially(self, client: AsyncClient):
        resp = await client.get("/api/speed-ladder/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sessions"] == []
        assert data["overall_by_speed"] == {}
