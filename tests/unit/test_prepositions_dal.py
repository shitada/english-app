"""Unit tests for the Preposition Cloze Drill DAL."""

from __future__ import annotations

import pytest

from app.dal import prepositions as pdal


# ---------------------------------------------------------------------------
# load_items — JSON bank validation
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_load_items_returns_at_least_50():
    items = pdal.load_items()
    assert len(items) >= 50


@pytest.mark.unit
def test_every_item_has_answer_in_options():
    items = pdal.load_items()
    assert items, "bank should not be empty"
    for it in items:
        assert it["answer"], f"missing answer for {it.get('id')}"
        assert 4 <= len(it["options"]) <= 6, (
            f"options count out of range for {it['id']}: {len(it['options'])}"
        )
        assert it["answer"] in it["options"], (
            f"answer not in options for {it['id']}"
        )
        assert "___" in it["sentence_with_blank"], (
            f"blank marker missing for {it['id']}"
        )
        assert it["category"] in pdal.VALID_CATEGORIES
        assert it["level"] in pdal.VALID_LEVELS


@pytest.mark.unit
def test_all_categories_represented():
    items = pdal.load_items()
    cats = {it["category"] for it in items}
    assert cats == pdal.VALID_CATEGORIES


@pytest.mark.unit
def test_get_item_roundtrip():
    items = pdal.load_items()
    first = items[0]
    got = pdal.get_item(first["id"])
    assert got is not None
    assert got["answer"] == first["answer"]
    assert pdal.get_item("does-not-exist") is None


# ---------------------------------------------------------------------------
# record_attempt + get_recent_stats + get_confused_pairs
# ---------------------------------------------------------------------------

@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_persists(test_db):
    rid = await pdal.record_attempt(
        test_db,
        item_id="prep-001",
        chosen="in",
        correct="in",
        category="time",
        response_ms=1500,
    )
    assert rid > 0

    stats = await pdal.get_recent_stats(test_db)
    assert stats["attempts"] == 1
    assert stats["correct"] == 1
    assert stats["accuracy"] == 1.0
    assert any(c["category"] == "time" for c in stats["per_category"])


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stats_mixed(test_db):
    # 2 correct + 1 wrong = 2/3 accuracy
    await pdal.record_attempt(
        test_db, item_id="a", chosen="in", correct="in", category="time"
    )
    await pdal.record_attempt(
        test_db, item_id="b", chosen="at", correct="at", category="place"
    )
    await pdal.record_attempt(
        test_db, item_id="c", chosen="on", correct="at", category="place"
    )

    stats = await pdal.get_recent_stats(test_db)
    assert stats["attempts"] == 3
    assert stats["correct"] == 2
    assert stats["accuracy"] == pytest.approx(2 / 3, abs=1e-4)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confused_pairs_top_3_ranking(test_db):
    # Confused pair (at, on) x3  — top
    for _ in range(3):
        await pdal.record_attempt(
            test_db, item_id="x", chosen="on", correct="at", category="place"
        )
    # Confused pair (in, on) x2  — 2nd
    for _ in range(2):
        await pdal.record_attempt(
            test_db, item_id="y", chosen="on", correct="in", category="time"
        )
    # Confused pair (for, since) x1 — 3rd
    await pdal.record_attempt(
        test_db, item_id="z", chosen="since", correct="for", category="time"
    )
    # Confused pair (of, about) x1 — should be excluded from top 3 (tie break; bumped)
    # Add a 4th pair to ensure trimming works
    await pdal.record_attempt(
        test_db, item_id="q", chosen="about", correct="of", category="collocation"
    )
    # Plus one correct answer (should NOT appear in confused pairs)
    await pdal.record_attempt(
        test_db, item_id="c", chosen="in", correct="in", category="time"
    )

    pairs = await pdal.get_confused_pairs(test_db, limit=3)
    assert len(pairs) == 3
    assert pairs[0] == {"correct": "at", "chosen": "on", "count": 3}
    assert pairs[1] == {"correct": "in", "chosen": "on", "count": 2}
    # 3rd spot — tie between (for, since) & (of, about), both count=1.
    # Ordering falls back to alpha on correct then chosen.
    assert pairs[2]["count"] == 1
    assert pairs[2]["correct"] in {"for", "of"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confused_pairs_empty_when_all_correct(test_db):
    await pdal.record_attempt(
        test_db, item_id="a", chosen="in", correct="in", category="time"
    )
    pairs = await pdal.get_confused_pairs(test_db)
    assert pairs == []
