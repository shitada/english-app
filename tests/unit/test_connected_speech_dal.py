"""Unit tests for Connected Speech Decoder DAL + normalize_answer."""

from __future__ import annotations

import pytest

from app.dal import connected_speech as cs_dal


# ---------------------------------------------------------------------------
# normalize_answer — pure function, no DB needed
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_normalize_empty_and_none_like():
    assert cs_dal.normalize_answer("") == ""
    assert cs_dal.normalize_answer("   ") == ""


@pytest.mark.unit
def test_normalize_lowercases_and_strips_punctuation():
    assert cs_dal.normalize_answer("Hello, World!") == "hello world"
    assert cs_dal.normalize_answer("What?!?") == "what"


@pytest.mark.unit
def test_normalize_collapses_whitespace():
    assert cs_dal.normalize_answer("  hi   there\n\tfriend  ") == "hi there friend"


@pytest.mark.unit
def test_normalize_expands_contractions():
    assert cs_dal.normalize_answer("I'm happy.") == "i am happy"
    assert cs_dal.normalize_answer("Don't go.") == "do not go"
    assert cs_dal.normalize_answer("It's fine.") == "it is fine"
    # cannot and can't collapse identically
    assert cs_dal.normalize_answer("cannot") == cs_dal.normalize_answer("can't")


@pytest.mark.unit
def test_normalize_expands_reductions():
    # going to == gonna
    assert cs_dal.normalize_answer("I am going to call her.") == \
        cs_dal.normalize_answer("I'm gonna call her.")
    # want to == wanna
    assert cs_dal.normalize_answer("Do you want to eat?") == \
        cs_dal.normalize_answer("Do you wanna eat?")
    # let me == lemme
    assert cs_dal.normalize_answer("Let me see.") == cs_dal.normalize_answer("Lemme see.")
    # kind of == kinda
    assert cs_dal.normalize_answer("It is kind of cold.") == \
        cs_dal.normalize_answer("It's kinda cold.")


@pytest.mark.unit
def test_grade_helper():
    assert cs_dal.grade("I am going to call her.", "I'm gonna call her.") is True
    assert cs_dal.grade("I am going to call her.", "I am going to call him.") is False


# ---------------------------------------------------------------------------
# insert_attempt + stats_by_category + recent_streak
# ---------------------------------------------------------------------------

@pytest.mark.unit
@pytest.mark.asyncio
async def test_stats_empty_db(test_db):
    stats = await cs_dal.stats_by_category(test_db)
    assert stats == []
    streak = await cs_dal.recent_streak(test_db)
    assert streak == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_insert_and_count(test_db):
    new_id = await cs_dal.insert_attempt(
        test_db,
        reduced="I'm gonna go.",
        expanded="I am going to go.",
        user_answer="I am going to go.",
        correct=True,
        category="gonna",
        time_ms=1500,
    )
    assert new_id > 0
    assert await cs_dal.count_attempts(test_db) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stats_by_category_multi(test_db):
    # gonna: 2 correct / 1 wrong
    for ok in (True, True, False):
        await cs_dal.insert_attempt(
            test_db,
            reduced="I'm gonna go.",
            expanded="I am going to go.",
            user_answer="x",
            correct=ok,
            category="gonna",
        )
    # wanna: 1 correct
    await cs_dal.insert_attempt(
        test_db,
        reduced="I wanna eat.",
        expanded="I want to eat.",
        user_answer="I want to eat.",
        correct=True,
        category="wanna",
    )

    stats = await cs_dal.stats_by_category(test_db)
    by = {s["category"]: s for s in stats}
    assert by["gonna"]["attempts"] == 3
    assert by["gonna"]["correct"] == 2
    assert by["gonna"]["accuracy"] == pytest.approx(2 / 3, abs=1e-4)
    assert by["wanna"]["attempts"] == 1
    assert by["wanna"]["correct"] == 1
    assert by["wanna"]["accuracy"] == 1.0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_null_category_grouped_as_other(test_db):
    await cs_dal.insert_attempt(
        test_db,
        reduced="X",
        expanded="Y",
        user_answer="Y",
        correct=True,
        category=None,
    )
    stats = await cs_dal.stats_by_category(test_db)
    assert any(s["category"] == "other" for s in stats)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_recent_streak(test_db):
    # Insert: correct, correct, wrong, correct, correct, correct (oldest -> newest)
    pattern = [True, True, False, True, True, True]
    for ok in pattern:
        await cs_dal.insert_attempt(
            test_db,
            reduced="r",
            expanded="e",
            user_answer="u",
            correct=ok,
            category="gonna",
        )
    # Newest-first, streak stops at first False — so last 3 are consecutive wins.
    assert await cs_dal.recent_streak(test_db) == 3
