"""Unit tests for the Shadow Phrase micro-drill word-matching logic.

These tests validate the normalizeText, wordDiff, and computeAccuracy algorithms
used in HighlightedMessage.tsx's InlineShadowDrill component.
The Python implementations mirror the TypeScript originals exactly.
"""

import re
import pytest


# ---- Python mirrors of the TS functions in HighlightedMessage.tsx ----

def normalize_text(text: str) -> str:
    """Mirror of normalizeText() in HighlightedMessage.tsx."""
    text = text.strip().lower()
    text = re.sub(r"[.,!?;:'\"]+", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def word_diff(expected: str, spoken: str) -> list[dict]:
    """Mirror of wordDiff() in HighlightedMessage.tsx."""
    expected_words = [w for w in normalize_text(expected).split(" ") if w]
    spoken_words = [w for w in normalize_text(spoken).split(" ") if w]
    max_len = max(len(expected_words), len(spoken_words))
    result = []
    for i in range(max_len):
        e_word = expected_words[i] if i < len(expected_words) else ""
        s_word = spoken_words[i] if i < len(spoken_words) else ""
        result.append({"word": s_word or "___", "match": e_word == s_word})
    return result


def compute_accuracy(expected: str, spoken: str) -> int:
    """Mirror of computeAccuracy() in HighlightedMessage.tsx."""
    expected_words = [w for w in normalize_text(expected).split(" ") if w]
    spoken_words = [w for w in normalize_text(spoken).split(" ") if w]
    if len(expected_words) == 0:
        return 0
    matches = sum(1 for i, w in enumerate(expected_words) if i < len(spoken_words) and spoken_words[i] == w)
    return round((matches / len(expected_words)) * 100)


# ---- Tests ----

@pytest.mark.unit
class TestNormalizeText:
    def test_strips_and_lowercases(self):
        assert normalize_text("  Hello World  ") == "hello world"

    def test_removes_punctuation(self):
        assert normalize_text("Hello, world! How's it going?") == "hello world hows it going"

    def test_collapses_whitespace(self):
        assert normalize_text("hello   world   test") == "hello world test"

    def test_empty_string(self):
        assert normalize_text("") == ""

    def test_only_punctuation(self):
        assert normalize_text(".,!?;:'\"") == ""


@pytest.mark.unit
class TestWordDiff:
    def test_exact_match(self):
        result = word_diff("hello world", "hello world")
        assert len(result) == 2
        assert all(d["match"] for d in result)

    def test_partial_match(self):
        result = word_diff("hello world", "hello earth")
        assert result[0] == {"word": "hello", "match": True}
        assert result[1] == {"word": "earth", "match": False}

    def test_extra_spoken_words(self):
        result = word_diff("hello", "hello world")
        assert len(result) == 2
        assert result[0] == {"word": "hello", "match": True}
        assert result[1] == {"word": "world", "match": False}

    def test_missing_spoken_words(self):
        result = word_diff("hello world", "hello")
        assert len(result) == 2
        assert result[0] == {"word": "hello", "match": True}
        assert result[1] == {"word": "___", "match": False}

    def test_completely_different(self):
        result = word_diff("good morning", "bad evening")
        assert not any(d["match"] for d in result)

    def test_case_insensitive_matching(self):
        result = word_diff("Hello World", "hello world")
        assert all(d["match"] for d in result)

    def test_punctuation_ignored(self):
        result = word_diff("Hello, world!", "hello world")
        assert all(d["match"] for d in result)


@pytest.mark.unit
class TestComputeAccuracy:
    def test_perfect_match(self):
        assert compute_accuracy("hello world", "hello world") == 100

    def test_no_match(self):
        assert compute_accuracy("hello world", "foo bar") == 0

    def test_partial_match(self):
        assert compute_accuracy("the quick brown fox", "the slow brown fox") == 75

    def test_empty_expected(self):
        assert compute_accuracy("", "hello") == 0

    def test_empty_spoken(self):
        assert compute_accuracy("hello world", "") == 0

    def test_case_and_punctuation_tolerance(self):
        assert compute_accuracy("It's a beautiful day!", "its a beautiful day") == 100

    def test_extra_words_spoken(self):
        # extra words don't affect accuracy (based on expected length)
        assert compute_accuracy("hello", "hello world") == 100

    def test_threshold_80_percent(self):
        # 4 out of 5 = 80%
        assert compute_accuracy("one two three four five", "one two three four wrong") == 80

    def test_below_threshold(self):
        # 2 out of 5 = 40%
        assert compute_accuracy("one two three four five", "one wrong two wrong wrong") == 20
