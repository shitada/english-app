"""Unit tests for vocab_dal.get_leech_words."""

from __future__ import annotations

import pytest

from app.dal.vocabulary import get_leech_words


async def _add_word(db, word: str, topic: str = "hotel_checkin", meaning: str = "m", example: str = "ex.") -> int:
    cur = await db.execute(
        "INSERT INTO vocabulary_words (topic, word, meaning, example_sentence, difficulty) VALUES (?, ?, ?, ?, ?)",
        (topic, word, meaning, example, 1),
    )
    await db.commit()
    return cur.lastrowid


async def _add_progress(db, word_id: int, correct: int, incorrect: int, level: int) -> None:
    await db.execute(
        """INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, level, last_reviewed, next_review_at)
           VALUES (?, ?, ?, ?, '2024-01-01 00:00:00', '2024-01-02 00:00:00')""",
        (word_id, correct, incorrect, level),
    )
    await db.commit()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_leech_words_surfaces_qualifying_words(test_db):
    wid = await _add_word(test_db, "ephemeral")
    await _add_progress(test_db, wid, correct=1, incorrect=4, level=1)

    leeches = await get_leech_words(test_db, limit=10)

    assert len(leeches) == 1
    leech = leeches[0]
    assert leech["word"] == "ephemeral"
    assert leech["meaning"] == "m"
    assert leech["example_sentence"] == "ex."
    assert leech["topic"] == "hotel_checkin"
    assert leech["correct_count"] == 1
    assert leech["incorrect_count"] == 4
    assert leech["level"] == 1
    assert leech["miss_rate"] == pytest.approx(4 / 5)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_leech_words_skips_thresholds(test_db):
    # Below incorrect threshold (incorrect < 3)
    wid_low = await _add_word(test_db, "lowmiss")
    await _add_progress(test_db, wid_low, correct=0, incorrect=2, level=0)

    # incorrect < correct (mostly mastered)
    wid_known = await _add_word(test_db, "known")
    await _add_progress(test_db, wid_known, correct=10, incorrect=3, level=2)

    # level too high
    wid_advanced = await _add_word(test_db, "advanced")
    await _add_progress(test_db, wid_advanced, correct=0, incorrect=5, level=3)

    leeches = await get_leech_words(test_db, limit=10)
    assert leeches == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_leech_words_skips_words_without_progress_row(test_db):
    # Word has no progress row → must not appear
    await _add_word(test_db, "orphan")
    leeches = await get_leech_words(test_db, limit=10)
    assert leeches == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_leech_words_orders_by_miss_rate_then_incorrect(test_db):
    # miss_rate 5/6 ≈ 0.833
    a = await _add_word(test_db, "alpha")
    await _add_progress(test_db, a, correct=1, incorrect=5, level=0)
    # miss_rate 4/4 = 1.0 (highest)
    b = await _add_word(test_db, "bravo")
    await _add_progress(test_db, b, correct=0, incorrect=4, level=1)
    # miss_rate 6/6 = 1.0, more incorrects → comes before bravo
    c = await _add_word(test_db, "charlie")
    await _add_progress(test_db, c, correct=0, incorrect=6, level=2)

    leeches = await get_leech_words(test_db, limit=10)
    words_in_order = [l["word"] for l in leeches]
    assert words_in_order == ["charlie", "bravo", "alpha"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_leech_words_honors_limit(test_db):
    for i in range(5):
        wid = await _add_word(test_db, f"word{i}")
        await _add_progress(test_db, wid, correct=0, incorrect=3 + i, level=0)

    leeches = await get_leech_words(test_db, limit=2)
    assert len(leeches) == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_leech_words_endpoint_includes_required_fields(test_db):
    wid = await _add_word(test_db, "stubborn")
    await _add_progress(test_db, wid, correct=2, incorrect=5, level=2)
    leeches = await get_leech_words(test_db, limit=10)
    assert len(leeches) == 1
    keys = set(leeches[0].keys())
    for k in ("word", "meaning", "example_sentence", "topic", "correct_count", "incorrect_count", "level", "miss_rate"):
        assert k in keys
