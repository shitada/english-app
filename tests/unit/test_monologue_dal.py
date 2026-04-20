"""Unit tests for the Monologue Drill DAL."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.dal import monologue as dal


@pytest.mark.unit
class TestMonologueScenarios:

    def test_get_scenarios_returns_curated_bank(self):
        scenarios = dal.get_scenarios()
        assert len(scenarios) >= 5
        for s in scenarios:
            assert s["id"]
            assert s["title"]
            assert s["prompt"]
            assert 15 <= s["target_seconds"] <= 120
            assert len(s["content_beats"]) >= 2

    def test_get_scenario_known(self):
        s = dal.get_scenario("networking-intro")
        assert s is not None
        assert s["id"] == "networking-intro"

    def test_get_scenario_unknown(self):
        assert dal.get_scenario("does-not-exist") is None

    def test_get_scenarios_returns_independent_copy(self):
        first = dal.get_scenarios()
        first[0]["content_beats"].append("mutation")
        second = dal.get_scenarios()
        assert "mutation" not in second[0]["content_beats"]


@pytest.mark.unit
class TestMonologueMetrics:

    def test_count_words(self):
        assert dal.count_words("") == 0
        assert dal.count_words("hello world") == 2
        assert dal.count_words("  one, two;  three! ") == 3

    def test_count_filler_words(self):
        t = "Um, so like, I basically, you know, wanted to try it."
        assert dal.count_filler_words(t) >= 3

    def test_count_filler_words_empty(self):
        assert dal.count_filler_words("") == 0

    def test_compute_wpm(self):
        assert dal.compute_wpm(60, 30) == 120.0
        assert dal.compute_wpm(0, 30) == 0.0
        assert dal.compute_wpm(10, 0) == 0.0

    def test_filler_ratio(self):
        assert dal.filler_ratio(0, 0) == 0.0
        assert dal.filler_ratio(100, 5) == 0.05
        assert dal.filler_ratio(10, 99) == 1.0


@pytest.mark.unit
class TestMonologueNormalizeResponse:

    def _scenario(self):
        return dal.get_scenario("networking-intro")

    def test_handles_non_dict(self):
        out = dal.normalize_llm_response(None, self._scenario())
        assert out["fluency_score"] == 0
        assert out["beats_covered"] == []
        assert out["suggested_rewrite_opening"]

    def test_clamps_scores_and_filters_beats(self):
        scenario = self._scenario()
        raw = {
            "beats_covered": [
                "Your name",
                "not-a-real-beat",
                "Your role or field",
            ],
            "fluency_score": 150,
            "structure_score": -20,
            "overall_score": 77,
            "one_line_feedback": "Great pace.",
            "suggested_rewrite_opening": "Hi, I'm Alex.",
        }
        out = dal.normalize_llm_response(raw, scenario)
        assert out["fluency_score"] == 100
        assert out["structure_score"] == 0
        assert out["overall_score"] == 77
        assert "not-a-real-beat" not in out["beats_covered"]
        assert "Your name" in out["beats_covered"]
        assert "Your role or field" in out["beats_covered"]
        assert out["one_line_feedback"] == "Great pace."
        assert out["suggested_rewrite_opening"] == "Hi, I'm Alex."

    def test_overall_falls_back_to_average(self):
        scenario = self._scenario()
        raw = {
            "fluency_score": 80,
            "structure_score": 60,
            "one_line_feedback": "ok",
        }
        out = dal.normalize_llm_response(raw, scenario)
        assert out["overall_score"] == 70

    def test_beats_are_deduplicated_case_insensitively(self):
        scenario = self._scenario()
        raw = {
            "beats_covered": ["your name", "Your Name", "YOUR NAME"],
            "fluency_score": 50, "structure_score": 50, "overall_score": 50,
            "one_line_feedback": "x", "suggested_rewrite_opening": "y",
        }
        out = dal.normalize_llm_response(raw, scenario)
        assert out["beats_covered"] == ["Your name"]


@pytest.mark.unit
class TestMonologueScoreAttempt:

    async def test_returns_safe_defaults_on_error(self):
        copilot = AsyncMock()
        copilot.ask_json.side_effect = RuntimeError("boom")
        scenario = dal.get_scenario("networking-intro")
        out = await dal.score_attempt(
            copilot,
            scenario=scenario,
            transcript="hello",
            duration_seconds=30,
            wpm=20.0,
            filler_count=0,
            word_count=1,
        )
        assert out["fluency_score"] == 0
        assert out["overall_score"] == 0
        assert out["beats_covered"] == []

    async def test_passes_through_valid_response(self):
        copilot = AsyncMock()
        copilot.ask_json.return_value = {
            "beats_covered": ["Your name"],
            "fluency_score": 85,
            "structure_score": 70,
            "overall_score": 80,
            "one_line_feedback": "Clear pace.",
            "suggested_rewrite_opening": "Hi — I'm Alex.",
        }
        scenario = dal.get_scenario("networking-intro")
        out = await dal.score_attempt(
            copilot,
            scenario=scenario,
            transcript="Hi, I'm Alex.",
            duration_seconds=20,
            wpm=140.0,
            filler_count=0,
            word_count=4,
        )
        assert out["overall_score"] == 80
        assert out["beats_covered"] == ["Your name"]


@pytest.mark.unit
class TestMonologueDbAccess:

    async def test_record_and_fetch_history(self, test_db):
        new_id = await dal.record_attempt(
            test_db,
            scenario_id="networking-intro",
            transcript="Hi there.",
            duration_seconds=30.0,
            word_count=2,
            filler_count=0,
            wpm=4.0,
            coverage_ratio=0.4,
            fluency_score=70,
            structure_score=65,
            overall_score=68,
            feedback={"beats_covered": ["Your name"], "one_line_feedback": "ok"},
        )
        assert new_id > 0

        rows = await dal.get_history(test_db, scenario_id="networking-intro")
        assert len(rows) == 1
        row = rows[0]
        assert row["scenario_id"] == "networking-intro"
        assert row["overall_score"] == 68
        assert row["feedback"]["one_line_feedback"] == "ok"

    async def test_history_filters_by_scenario(self, test_db):
        for sid, score in [
            ("networking-intro", 50),
            ("weekend-hobby-pitch", 80),
            ("networking-intro", 60),
        ]:
            await dal.record_attempt(
                test_db,
                scenario_id=sid, transcript="x", duration_seconds=10.0,
                word_count=1, filler_count=0, wpm=6.0, coverage_ratio=0.0,
                fluency_score=score, structure_score=score, overall_score=score,
                feedback={},
            )
        only = await dal.get_history(test_db, scenario_id="networking-intro")
        assert len(only) == 2
        all_rows = await dal.get_history(test_db)
        assert len(all_rows) == 3

    async def test_personal_best(self, test_db):
        for score in [45, 92, 60, 80]:
            await dal.record_attempt(
                test_db,
                scenario_id="interview-strength", transcript="x",
                duration_seconds=10.0, word_count=1, filler_count=0, wpm=6.0,
                coverage_ratio=0.0, fluency_score=score, structure_score=score,
                overall_score=score, feedback={},
            )
        best = await dal.get_personal_best(
            test_db, scenario_id="interview-strength"
        )
        assert best is not None
        assert best["overall_score"] == 92

    async def test_personal_best_none_when_empty(self, test_db):
        best = await dal.get_personal_best(test_db, scenario_id="nothing-here")
        assert best is None
