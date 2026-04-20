"""Unit tests for the Number & Date Dictation DAL + helpers."""

from __future__ import annotations

import pytest

from app.dal import number_dictation as dal
from app.routers.number_dictation import (
    CATEGORIES,
    SESSION_SIZE,
    compare_answer,
    generate_session,
    normalize_answer,
)


@pytest.mark.unit
class TestGenerator:
    def test_default_session_size(self):
        items = generate_session(category="mixed", seed=42)
        assert len(items) == SESSION_SIZE
        for it in items:
            assert it["id"]
            assert it["category"] in CATEGORIES
            assert it["category"] != "mixed"
            assert it["expected_text"]
            assert it["spoken_form"]
            assert it["audio_url"].startswith("speech:")
            assert it["hint"]

    def test_specific_category_only_yields_that_category(self):
        items = generate_session(category="prices", count=4, seed=1)
        assert len(items) == 4
        assert {it["category"] for it in items} == {"prices"}
        for it in items:
            assert it["expected_text"].startswith("$")

    def test_unknown_category_falls_back_to_default(self):
        items = generate_session(category="nonsense", count=2, seed=3)
        assert len(items) == 2

    def test_seed_is_deterministic(self):
        a = generate_session(category="mixed", seed=99)
        b = generate_session(category="mixed", seed=99)
        a_keys = [(i["category"], i["expected_text"], i["spoken_form"]) for i in a]
        b_keys = [(i["category"], i["expected_text"], i["spoken_form"]) for i in b]
        assert a_keys == b_keys


@pytest.mark.unit
class TestNormalization:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("$3.49", "349"),
            ("3.49", "349"),
            ("  3 . 49 ", "349"),
            ("$1,299.00", "129900"),
            ("7:45", "745"),
            ("7 45", "745"),
            ("745", "745"),
            ("FIFTEEN", "15"),
            ("Fifty", "50"),
            ("two thousand", "2thousand"),
            ("415-555-1234", "4155551234"),
            ("415 555 1234", "4155551234"),
            ("", ""),
            (None, ""),
        ],
    )
    def test_normalize(self, raw, expected):
        assert normalize_answer(raw) == expected

    def test_compare_price_accepts_dollar_or_no_dollar(self):
        ok, en, un = compare_answer("prices", "$3.49", "3.49")
        assert ok and en == un == "349"
        ok2, _, _ = compare_answer("prices", "$3.49", "$3.49")
        assert ok2

    def test_compare_time_accepts_colon_space_or_concat(self):
        for user in ["7:45", "7 45", "745"]:
            ok, _, _ = compare_answer("times", "7:45", user)
            assert ok, f"failed for {user!r}"

    def test_compare_phone_ignores_separators(self):
        ok, _, _ = compare_answer("phone", "415-555-1234", "(415) 555 1234")
        assert ok

    def test_compare_year(self):
        assert compare_answer("years", "2019", "2019")[0]
        assert not compare_answer("years", "2019", "1919")[0]

    def test_compare_date_word_form(self):
        ok, _, _ = compare_answer("dates", "March 3rd", "march third")
        assert ok
        ok2, _, _ = compare_answer("dates", "March 3rd", "3/3")
        assert ok2
        ok3, _, _ = compare_answer("dates", "March 3rd", "Mar 3")
        assert ok3
        bad, _, _ = compare_answer("dates", "March 3rd", "April 3rd")
        assert not bad

    def test_compare_empty_user_is_wrong(self):
        ok, _, _ = compare_answer("years", "2019", "")
        assert not ok

    def test_compare_teens_vs_tens(self):
        ok, _, _ = compare_answer("teens_vs_tens", "15", "fifteen")
        assert ok
        bad, _, _ = compare_answer("teens_vs_tens", "15", "fifty")
        assert not bad


@pytest.mark.unit
class TestDAL:
    async def test_record_session_and_get_stats(self, test_db):
        sid = await dal.record_session(test_db, category="prices", total=6, correct=4)
        assert sid > 0
        await dal.record_session(test_db, category="prices", total=6, correct=2)
        await dal.record_session(test_db, category="years", total=6, correct=6)

        stats = await dal.get_recent_stats(test_db, limit=10)
        assert stats["sessions"] == 3
        assert 0 < stats["overall_accuracy"] <= 1
        by_cat = stats["by_category"]
        assert "prices" in by_cat and "years" in by_cat
        assert by_cat["prices"]["total"] == 12
        assert by_cat["prices"]["correct"] == 6
        assert by_cat["years"]["accuracy"] == 1.0

    async def test_get_stats_empty(self, test_db):
        stats = await dal.get_recent_stats(test_db, limit=10)
        assert stats["sessions"] == 0
        assert stats["overall_accuracy"] == 0.0
        assert stats["by_category"] == {}

    async def test_record_clamps_correct_to_total(self, test_db):
        await dal.record_session(test_db, category="times", total=4, correct=999)
        stats = await dal.get_recent_stats(test_db)
        assert stats["by_category"]["times"]["correct"] == 4
        assert stats["by_category"]["times"]["accuracy"] == 1.0
