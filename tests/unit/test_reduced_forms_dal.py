"""Unit tests for the Reduced Forms DAL: seed list, sampler, persistence."""

from __future__ import annotations

import random

import pytest

from app.dal import reduced_forms as rf_dal


@pytest.mark.unit
class TestSeedList:
    def test_minimum_size_and_diversity(self):
        assert len(rf_dal.SEED_ITEMS) >= 30, "need at least 30 seed items"
        types = rf_dal.all_reduction_types()
        assert len(types) >= 5, f"need at least 5 reduction types, got {types}"

    def test_every_item_has_required_fields(self):
        required = {"id", "reduction_type", "reduced_text", "full_text", "focus_chunks"}
        ids: set[str] = set()
        for item in rf_dal.SEED_ITEMS:
            assert required.issubset(item.keys()), f"missing keys in {item}"
            assert isinstance(item["focus_chunks"], list)
            assert item["reduced_text"].strip()
            assert item["full_text"].strip()
            assert item["id"] not in ids, f"duplicate id {item['id']}"
            ids.add(item["id"])


@pytest.mark.unit
class TestSampleRound:
    def test_returns_5_unique_items(self):
        round_ = rf_dal.sample_round(rng=random.Random(42))
        assert len(round_) == 5
        ids = [it["id"] for it in round_]
        assert len(set(ids)) == 5

    def test_prioritizes_weakest_type_first(self):
        # Make 'gonna' the weakest by giving every other type a high score.
        types = rf_dal.all_reduction_types()
        weakness = {t: 95.0 for t in types if t != "gonna"}
        weakness["gonna"] = 10.0
        round_ = rf_dal.sample_round(weakness=weakness, n=5, rng=random.Random(1))
        assert round_[0]["reduction_type"] == "gonna"

    def test_handles_unknown_types_as_weakest(self):
        # All known types have stats — but a brand new type with no stats
        # should still appear in the sample (treated as 0).
        weakness = {"gonna": 80.0, "wanna": 80.0}
        round_ = rf_dal.sample_round(weakness=weakness, n=5, rng=random.Random(2))
        assert len(round_) == 5

    def test_n_clamped_by_pool_size(self):
        round_ = rf_dal.sample_round(n=3, rng=random.Random(3))
        assert len(round_) == 3


@pytest.mark.unit
class TestExpandGrader:
    def setup_method(self):
        from app.routers.reduced_forms import grade_expand, normalize_for_grading
        self.grade = grade_expand
        self.norm = normalize_for_grading

    def test_case_insensitive(self):
        assert self.grade("I am going to leave.", "i AM going to leave")

    def test_punctuation_insensitive(self):
        assert self.grade("I am going to leave.", "I am going to leave!!!")

    def test_whitespace_insensitive(self):
        assert self.grade("I am going to leave.", "  I  am   going to    leave  ")

    def test_contraction_equivalence(self):
        assert self.grade("I am going to leave.", "I'm going to leave.")
        assert self.grade("She is here.", "She's here.")
        assert self.grade("We would have gone.", "We would've gone.")

    def test_dont_equals_do_not(self):
        assert self.grade("I do not know.", "I don't know.")

    def test_cannot_equals_can_not(self):
        assert self.grade("I cannot help you.", "I can't help you.")

    def test_wrong_answer_rejected(self):
        assert not self.grade("I am going to leave.", "I am staying.")

    def test_normalize_strips_punct_and_lowers(self):
        assert self.norm("Hello, World!") == "hello world"


@pytest.mark.unit
class TestRecordAttempt:
    async def test_insert_and_count(self, test_db):
        new_id = await rf_dal.record_attempt(
            test_db,
            item_id="gonna-01",
            reduction_type="gonna",
            reduced_text="I'm gonna go",
            full_text="I am going to go",
            user_expand="I am going to go",
            expand_correct=True,
            shadow_accuracy=88.0,
        )
        assert new_id > 0
        assert await rf_dal.count_attempts(test_db) == 1

    async def test_weakness_stats_grouped(self, test_db):
        await rf_dal.record_attempt(
            test_db, item_id="gonna-01", reduction_type="gonna",
            reduced_text="x", full_text="x", user_expand="x",
            expand_correct=True, shadow_accuracy=80.0,
        )
        await rf_dal.record_attempt(
            test_db, item_id="lemme-01", reduction_type="lemme",
            reduced_text="x", full_text="x", user_expand="",
            expand_correct=False, shadow_accuracy=20.0,
        )
        stats = await rf_dal.get_weakness_stats(test_db)
        # gonna: (100 + 80)/2 = 90
        assert stats["gonna"] == pytest.approx(90.0, rel=0.01)
        # lemme: (0 + 20)/2 = 10
        assert stats["lemme"] == pytest.approx(10.0, rel=0.01)
