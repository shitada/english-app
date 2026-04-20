"""Unit tests for sentence_echo DAL & token-level scoring helpers."""

import pytest

from app.dal import sentence_echo as se


@pytest.mark.unit
def test_tokenize_words_lowercases_and_strips_punctuation():
    assert se.tokenize_words("Hello, World!") == ["hello", "world"]
    assert se.tokenize_words("It's a TEST.") == ["it's", "a", "test"]
    assert se.tokenize_words("") == []


@pytest.mark.unit
def test_word_levenshtein_basic():
    assert se.word_levenshtein(["a", "b", "c"], ["a", "b", "c"]) == 0
    assert se.word_levenshtein(["a", "b", "c"], ["a", "x", "c"]) == 1
    assert se.word_levenshtein([], ["a", "b"]) == 2
    assert se.word_levenshtein(["a", "b"], []) == 2


@pytest.mark.unit
def test_word_accuracy_perfect_and_partial():
    assert se.word_accuracy("the cat sat", "the cat sat") == 1.0
    acc = se.word_accuracy("the cat sat on the mat", "the cat sat on the mat")
    assert acc == 1.0
    partial = se.word_accuracy("the cat sat on the mat", "the cat sat on a mat")
    # one substitution / 6 -> 5/6
    assert pytest.approx(partial, rel=1e-3) == 5 / 6


@pytest.mark.unit
def test_word_accuracy_empty_target_returns_zero():
    assert se.word_accuracy("", "anything") == 0.0


@pytest.mark.unit
def test_next_span_advances_only_when_passed():
    assert se.next_span(6, True) == 9
    assert se.next_span(6, False) == 6
    assert se.next_span(15, True) == 18
    # Already at top stays at top
    assert se.next_span(18, True) == 18


@pytest.mark.unit
@pytest.mark.asyncio
async def test_record_attempt_and_get_best_span(test_db):
    rid = await se.record_attempt(test_db, span=6, accuracy=0.95, passed=True)
    assert rid > 0
    await se.record_attempt(test_db, span=9, accuracy=0.92, passed=True)
    await se.record_attempt(test_db, span=12, accuracy=0.6, passed=False)
    assert await se.get_best_span(test_db) == 9
    assert await se.count_attempts(test_db) == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_recent_span_trend_returns_daily_points(test_db):
    await se.record_attempt(test_db, span=6, accuracy=1.0, passed=True)
    await se.record_attempt(test_db, span=9, accuracy=0.8, passed=False)
    points = await se.get_recent_span_trend(test_db, days=14)
    assert len(points) >= 1
    today = points[-1]
    assert today["max_span"] == 6  # only the passed one counts
    assert today["attempts"] == 2
    assert 0 <= today["avg_accuracy"] <= 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_best_span_zero_when_empty(test_db):
    assert await se.get_best_span(test_db) == 0
