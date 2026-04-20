"""Unit tests for the Quick Contrastive Stress router."""

from __future__ import annotations

import pytest

from app.routers.contrastive_stress import (
    coerce_payload,
    split_words,
    _FALLBACK_ITEMS,
)


@pytest.mark.unit
class TestSplitWords:
    def test_basic(self):
        assert split_words("I didn't say he broke it.") == [
            "I", "didn't", "say", "he", "broke", "it.",
        ]

    def test_strips_and_collapses(self):
        assert split_words("  hello   world  ") == ["hello", "world"]


@pytest.mark.unit
class TestCoercePayload:
    def test_valid_minimum_three_options(self):
        raw = {
            "sentence": "She gave him the red book yesterday.",
            "options": [
                {"word_index": 0, "meaning": "She gave it, not someone else."},
                {"word_index": 4, "meaning": "The red one, not another color."},
                {"word_index": 6, "meaning": "Yesterday, not another day."},
            ],
        }
        out = coerce_payload(raw)
        assert out is not None
        assert len(out["options"]) == 3
        assert out["words"][0] == "She"
        assert out["options"][0]["word"] == "She"
        assert out["options"][1]["word"] == "red"

    def test_caps_at_four_options(self):
        raw = {
            "sentence": "She gave him the red book yesterday.",
            "options": [
                {"word_index": 0, "meaning": "a"},
                {"word_index": 1, "meaning": "b"},
                {"word_index": 2, "meaning": "c"},
                {"word_index": 4, "meaning": "d"},
                {"word_index": 6, "meaning": "e"},
            ],
        }
        out = coerce_payload(raw)
        assert out is not None
        assert len(out["options"]) == 4

    def test_rejects_not_dict(self):
        assert coerce_payload([]) is None
        assert coerce_payload(None) is None
        assert coerce_payload("nope") is None

    def test_rejects_short_sentence(self):
        raw = {
            "sentence": "Too short.",
            "options": [
                {"word_index": 0, "meaning": "a"},
                {"word_index": 1, "meaning": "b"},
                {"word_index": 0, "meaning": "c"},
            ],
        }
        assert coerce_payload(raw) is None

    def test_rejects_too_long_sentence(self):
        raw = {
            "sentence": " ".join(["word"] * 13) + ".",
            "options": [
                {"word_index": 0, "meaning": "a"},
                {"word_index": 1, "meaning": "b"},
                {"word_index": 2, "meaning": "c"},
            ],
        }
        assert coerce_payload(raw) is None

    def test_drops_out_of_range_indices(self):
        raw = {
            "sentence": "She gave him the red book yesterday.",
            "options": [
                {"word_index": 0, "meaning": "a"},
                {"word_index": 99, "meaning": "b"},  # out of range
                {"word_index": -1, "meaning": "c"},  # out of range
                {"word_index": 4, "meaning": "d"},
                {"word_index": 6, "meaning": "e"},
            ],
        }
        out = coerce_payload(raw)
        assert out is not None
        assert all(0 <= o["word_index"] < len(out["words"]) for o in out["options"])

    def test_dedupes_indices(self):
        raw = {
            "sentence": "She gave him the red book yesterday.",
            "options": [
                {"word_index": 0, "meaning": "a"},
                {"word_index": 0, "meaning": "duplicate"},
                {"word_index": 4, "meaning": "c"},
                {"word_index": 6, "meaning": "d"},
            ],
        }
        out = coerce_payload(raw)
        assert out is not None
        idxs = [o["word_index"] for o in out["options"]]
        assert len(idxs) == len(set(idxs))

    def test_rejects_missing_meaning(self):
        raw = {
            "sentence": "She gave him the red book yesterday.",
            "options": [
                {"word_index": 0, "meaning": ""},
                {"word_index": 1, "meaning": ""},
                {"word_index": 2, "meaning": ""},
            ],
        }
        assert coerce_payload(raw) is None

    def test_rejects_no_options_field(self):
        raw = {"sentence": "She gave him the red book yesterday."}
        assert coerce_payload(raw) is None


@pytest.mark.unit
class TestFallbackBank:
    def test_all_items_have_valid_indices(self):
        assert len(_FALLBACK_ITEMS) >= 5
        for item in _FALLBACK_ITEMS:
            words = split_words(item["sentence"])
            n = len(words)
            assert 5 <= n <= 12, item["sentence"]
            assert 3 <= len(item["options"]) <= 4
            seen = set()
            for opt in item["options"]:
                wi = opt["word_index"]
                assert 0 <= wi < n
                assert wi not in seen
                seen.add(wi)
                assert opt["meaning"].strip()
