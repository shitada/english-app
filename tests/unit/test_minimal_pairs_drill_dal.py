"""Unit tests for app.dal.minimal_pairs (phoneme-contrast drill DAL)."""

from __future__ import annotations

import pytest

from app.dal import minimal_pairs as mp_dal


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_inserts_row(test_db):
    new_id = await mp_dal.record_attempt(
        test_db,
        item_id="iy-ih-01",
        contrast="IY_vs_IH",
        word_a="ship",
        word_b="sheep",
        target="a",
        chosen="a",
        is_correct=True,
    )
    assert isinstance(new_id, int) and new_id > 0

    rows = await test_db.execute_fetchall(
        "SELECT item_id, contrast, target, chosen, is_correct FROM minimal_pairs_attempts"
    )
    assert len(rows) == 1
    assert rows[0]["item_id"] == "iy-ih-01"
    assert rows[0]["contrast"] == "IY_vs_IH"
    assert rows[0]["is_correct"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_rejects_invalid_target(test_db):
    with pytest.raises(ValueError):
        await mp_dal.record_attempt(
            test_db,
            item_id="x",
            contrast="X",
            word_a="a",
            word_b="b",
            target="c",  # type: ignore[arg-type]
            chosen="a",
            is_correct=False,
        )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_contrast_stats_empty(test_db):
    stats = await mp_dal.get_contrast_stats(test_db)
    assert stats == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_contrast_stats_aggregates(test_db):
    # 3 attempts for IY_vs_IH: 2 correct
    for ok in (True, True, False):
        await mp_dal.record_attempt(
            test_db, item_id="iy-ih-01", contrast="IY_vs_IH",
            word_a="ship", word_b="sheep",
            target="a", chosen="a" if ok else "b", is_correct=ok,
        )
    # 2 attempts for L_vs_R: 0 correct
    for _ in range(2):
        await mp_dal.record_attempt(
            test_db, item_id="l-r-01", contrast="L_vs_R",
            word_a="light", word_b="right",
            target="a", chosen="b", is_correct=False,
        )

    stats = await mp_dal.get_contrast_stats(test_db, lookback_days=30)
    by_c = {s["contrast"]: s for s in stats}
    assert by_c["IY_vs_IH"]["attempts"] == 3
    assert by_c["IY_vs_IH"]["correct"] == 2
    assert by_c["IY_vs_IH"]["accuracy"] == pytest.approx(2 / 3, abs=1e-4)
    assert by_c["L_vs_R"]["attempts"] == 2
    assert by_c["L_vs_R"]["correct"] == 0
    assert by_c["L_vs_R"]["accuracy"] == 0.0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_weakest_contrasts_filters_and_sorts(test_db):
    # Contrast A: 4/4 correct (100%)
    for _ in range(4):
        await mp_dal.record_attempt(
            test_db, item_id="a-01", contrast="A",
            word_a="x", word_b="y", target="a", chosen="a", is_correct=True,
        )
    # Contrast B: 1/3 correct (33%)
    for ok in (True, False, False):
        await mp_dal.record_attempt(
            test_db, item_id="b-01", contrast="B",
            word_a="x", word_b="y", target="a",
            chosen="a" if ok else "b", is_correct=ok,
        )
    # Contrast C: 1 attempt — should be filtered out by min_attempts=3
    await mp_dal.record_attempt(
        test_db, item_id="c-01", contrast="C",
        word_a="x", word_b="y", target="a", chosen="b", is_correct=False,
    )

    weakest = await mp_dal.get_weakest_contrasts(test_db, min_attempts=3, limit=5)
    names = [w["contrast"] for w in weakest]
    assert "C" not in names  # filtered out (only 1 attempt)
    assert names[0] == "B"  # lowest accuracy first
    assert weakest[0]["accuracy"] == pytest.approx(1 / 3, abs=1e-4)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_count_attempts(test_db):
    assert await mp_dal.count_attempts(test_db) == 0
    await mp_dal.record_attempt(
        test_db, item_id="x", contrast="X", word_a="a", word_b="b",
        target="a", chosen="a", is_correct=True,
    )
    assert await mp_dal.count_attempts(test_db) == 1
