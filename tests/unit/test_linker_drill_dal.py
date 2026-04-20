"""Unit tests for linker_drill DAL + helper functions."""

from __future__ import annotations

import pytest

from app.dal import linker_drill as dal
from app.routers.linker_drill import (
    CATEGORIES,
    CATEGORY_CONNECTORS,
    build_round,
)


@pytest.mark.unit
def test_build_round_returns_requested_count_and_unique_ids():
    round_items = build_round(count=5, seed=42)
    assert len(round_items) == 5
    ids = [it["id"] for it in round_items]
    assert len(set(ids)) == 5


@pytest.mark.unit
def test_build_round_options_contain_correct_linker():
    for it in build_round(count=10, seed=7):
        assert it["correct_linker"] in it["options"]
        assert len(it["options"]) == 4
        # all options unique
        assert len(set(it["options"])) == 4
        # category is valid
        assert it["category"] in CATEGORIES


@pytest.mark.unit
def test_build_round_balanced_across_categories():
    items = build_round(count=5, seed=1)
    cats = {it["category"] for it in items}
    # Round-robin across 5 categories with count=5 → all distinct
    assert cats == set(CATEGORIES)


@pytest.mark.unit
def test_category_connectors_cover_taxonomy():
    assert set(CATEGORY_CONNECTORS.keys()) == set(CATEGORIES)
    for opts in CATEGORY_CONNECTORS.values():
        assert len(opts) >= 4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_persists_row(test_db):
    rid = await dal.record_attempt(
        test_db,
        item_id="c01",
        chosen_linker="however",
        correct_linker="however",
        is_correct=True,
        category="contrast",
        spoken_similarity=82.5,
    )
    assert rid > 0
    rows = await test_db.execute_fetchall(
        "SELECT * FROM linker_drill_attempts WHERE id = ?", (rid,)
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["item_id"] == "c01"
    assert row["is_correct"] == 1
    assert row["category"] == "contrast"
    assert float(row["spoken_similarity"]) == 82.5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_recent_stats_aggregates_correctly(test_db):
    # Insert a mix of attempts
    await dal.record_attempt(test_db, item_id="c01", chosen_linker="however",
                             correct_linker="however", is_correct=True,
                             category="contrast", spoken_similarity=80.0)
    await dal.record_attempt(test_db, item_id="c02", chosen_linker="so",
                             correct_linker="although", is_correct=False,
                             category="contrast", spoken_similarity=40.0)
    await dal.record_attempt(test_db, item_id="r01", chosen_linker="so",
                             correct_linker="so", is_correct=True,
                             category="result", spoken_similarity=None)

    stats = await dal.get_recent_stats(test_db)
    assert stats["total"] == 3
    assert stats["overall_accuracy"] == pytest.approx(2 / 3)
    # avg_similarity averages only non-null values
    assert stats["avg_similarity"] == pytest.approx(60.0)
    assert "contrast" in stats["by_category"]
    contrast = stats["by_category"]["contrast"]
    assert contrast["total"] == 2
    assert contrast["accuracy"] == pytest.approx(0.5)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_weakest_category_picks_lowest_accuracy(test_db):
    # contrast: 0/3 correct, result: 3/3 correct
    for _ in range(3):
        await dal.record_attempt(test_db, item_id="c01",
                                 chosen_linker="x", correct_linker="however",
                                 is_correct=False, category="contrast")
        await dal.record_attempt(test_db, item_id="r01",
                                 chosen_linker="so", correct_linker="so",
                                 is_correct=True, category="result")
    weakest = await dal.get_weakest_category(test_db, min_attempts=3)
    assert weakest == "contrast"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_weakest_category_none_when_insufficient(test_db):
    await dal.record_attempt(test_db, item_id="c01",
                             chosen_linker="x", correct_linker="however",
                             is_correct=False, category="contrast")
    weakest = await dal.get_weakest_category(test_db, min_attempts=3)
    assert weakest is None
