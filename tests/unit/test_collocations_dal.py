"""Unit tests for collocations DAL."""

from __future__ import annotations

import pytest

from app.dal import collocations as dal


@pytest.mark.unit
class TestCollocationsDAL:

    async def test_save_attempt_returns_id(self, test_db):
        new_id = await dal.save_attempt(
            test_db,
            item_id="e01",
            sentence="I need to ___ a decision.",
            correct_verb="make",
            chosen_verb="make",
            is_correct=True,
            response_ms=1200,
        )
        assert new_id > 0

    async def test_save_attempt_persists_row(self, test_db):
        await dal.save_attempt(
            test_db,
            item_id="e02",
            sentence="Let's ___ a break.",
            correct_verb="Take",
            chosen_verb="Make",
            is_correct=False,
            response_ms=None,
        )
        rows = await test_db.execute_fetchall(
            "SELECT * FROM collocation_attempts"
        )
        assert len(rows) == 1
        row = rows[0]
        # verbs are lowercased
        assert row["correct_verb"] == "take"
        assert row["chosen_verb"] == "make"
        assert row["is_correct"] == 0
        assert row["response_ms"] is None

    async def test_get_per_verb_accuracy(self, test_db):
        for verb, ok in [("make", True), ("make", True), ("make", False),
                         ("take", False), ("take", False), ("do", True)]:
            await dal.save_attempt(
                test_db,
                item_id="x",
                sentence="S",
                correct_verb=verb,
                chosen_verb=verb if ok else "give",
                is_correct=ok,
                response_ms=100,
            )
        per_verb = await dal.get_per_verb_accuracy(test_db)
        assert per_verb["make"]["total"] == 3
        assert per_verb["make"]["correct"] == 2
        assert per_verb["make"]["accuracy"] == pytest.approx(2 / 3)
        assert per_verb["take"]["total"] == 2
        assert per_verb["take"]["accuracy"] == 0.0
        assert per_verb["do"]["accuracy"] == 1.0

    async def test_get_stats_empty(self, test_db):
        stats = await dal.get_stats(test_db)
        assert stats["total_attempts"] == 0
        assert stats["accuracy"] == 0.0
        assert stats["per_verb_accuracy"] == {}
        assert stats["weakest_verbs"] == []
        assert stats["recent_sessions"] == []

    async def test_get_stats_identifies_weakest_verbs(self, test_db):
        # make: 2/2 correct (100%), take: 0/2 (0%), have: 1/2 (50%)
        scenarios = [
            ("make", True), ("make", True),
            ("take", False), ("take", False),
            ("have", True), ("have", False),
        ]
        for verb, ok in scenarios:
            await dal.save_attempt(
                test_db,
                item_id="x", sentence="S",
                correct_verb=verb, chosen_verb=verb if ok else "do",
                is_correct=ok, response_ms=500,
            )
        stats = await dal.get_stats(test_db, weakest_min_attempts=2)
        assert stats["total_attempts"] == 6
        assert stats["accuracy"] == pytest.approx(3 / 6)
        assert stats["per_verb_accuracy"]["take"] == 0.0
        assert stats["per_verb_accuracy"]["make"] == 1.0
        # weakest sort: take (0%) before have (50%) before make (100%)
        assert stats["weakest_verbs"][0] == "take"
        assert "have" in stats["weakest_verbs"]

    async def test_get_stats_recent_sessions_limited(self, test_db):
        for i in range(15):
            await dal.save_attempt(
                test_db,
                item_id=f"i{i}", sentence=f"S{i}",
                correct_verb="make", chosen_verb="make",
                is_correct=True, response_ms=100 + i,
            )
        stats = await dal.get_stats(test_db, recent_session_limit=5)
        assert stats["total_attempts"] == 15
        assert len(stats["recent_sessions"]) == 5
        # Most-recent first
        assert stats["recent_sessions"][0]["item_id"] == "i14"
