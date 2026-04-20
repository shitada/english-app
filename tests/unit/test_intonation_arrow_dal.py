"""Unit tests for the Intonation Arrow DAL."""

from __future__ import annotations

import pytest

from app.dal import intonation_arrow as dal


@pytest.mark.unit
def test_load_items_returns_at_least_20_items():
    items = dal.load_items()
    assert len(items) >= 20
    # every item has required fields
    for it in items:
        assert it["id"]
        assert it["text"]
        assert it["pattern"] in dal.VALID_PATTERNS
        assert it["category"]


@pytest.mark.unit
def test_load_items_balanced_across_patterns():
    items = dal.load_items()
    counts = {"rising": 0, "falling": 0, "rise_fall": 0}
    for it in items:
        counts[it["pattern"]] += 1
    # Each pattern should have at least a handful of items.
    for p, n in counts.items():
        assert n >= 5, f"pattern {p} only has {n} items"


@pytest.mark.unit
def test_get_item_found_and_missing():
    items = dal.load_items()
    assert dal.get_item(items[0]["id"]) is not None
    assert dal.get_item("does-not-exist") is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_persists(test_db):
    items = dal.load_items()
    item = items[0]
    row_id = await dal.record_attempt(
        test_db,
        item_id=item["id"],
        chosen=item["pattern"],
        correct=True,
        latency_ms=1200,
    )
    assert row_id > 0

    rows = await test_db.execute_fetchall(
        "SELECT item_id, chosen, correct, latency_ms FROM intonation_arrow_attempts"
    )
    assert len(rows) == 1
    assert rows[0]["item_id"] == item["id"]
    assert rows[0]["chosen"] == item["pattern"]
    assert rows[0]["correct"] == 1
    assert rows[0]["latency_ms"] == 1200


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_with_null_latency(test_db):
    items = dal.load_items()
    item = items[0]
    await dal.record_attempt(
        test_db,
        item_id=item["id"],
        chosen="rising",
        correct=False,
        latency_ms=None,
    )
    rows = await test_db.execute_fetchall(
        "SELECT latency_ms FROM intonation_arrow_attempts"
    )
    assert rows[0]["latency_ms"] is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_stats_empty(test_db):
    stats = await dal.get_stats(test_db)
    assert stats["attempts"] == 0
    assert stats["correct"] == 0
    assert stats["accuracy"] == 0.0
    patterns = {p["pattern"]: p for p in stats["per_pattern"]}
    assert set(patterns.keys()) == {"rising", "falling", "rise_fall"}
    for p in patterns.values():
        assert p["attempts"] == 0 and p["accuracy"] == 0.0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_stats_by_pattern(test_db):
    items = dal.load_items()
    # Find one of each pattern
    by_pat: dict[str, dict] = {}
    for it in items:
        by_pat.setdefault(it["pattern"], it)
    rising = by_pat["rising"]
    falling = by_pat["falling"]
    rise_fall = by_pat["rise_fall"]

    # 2 correct rising, 1 wrong rising
    await dal.record_attempt(test_db, item_id=rising["id"], chosen="rising", correct=True)
    await dal.record_attempt(test_db, item_id=rising["id"], chosen="rising", correct=True)
    await dal.record_attempt(test_db, item_id=rising["id"], chosen="falling", correct=False)
    # 1 correct falling
    await dal.record_attempt(test_db, item_id=falling["id"], chosen="falling", correct=True)
    # 1 wrong rise_fall
    await dal.record_attempt(test_db, item_id=rise_fall["id"], chosen="rising", correct=False)

    stats = await dal.get_stats(test_db)
    assert stats["attempts"] == 5
    assert stats["correct"] == 3
    assert stats["accuracy"] == pytest.approx(3 / 5, abs=1e-4)

    per = {p["pattern"]: p for p in stats["per_pattern"]}
    assert per["rising"]["attempts"] == 3
    assert per["rising"]["correct"] == 2
    assert per["rising"]["accuracy"] == pytest.approx(2 / 3, abs=1e-4)
    assert per["falling"]["attempts"] == 1
    assert per["falling"]["correct"] == 1
    assert per["falling"]["accuracy"] == 1.0
    assert per["rise_fall"]["attempts"] == 1
    assert per["rise_fall"]["correct"] == 0
    assert per["rise_fall"]["accuracy"] == 0.0
