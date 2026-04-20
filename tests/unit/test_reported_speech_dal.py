"""Unit tests for the Reported Speech drill DAL + helpers."""

from __future__ import annotations

import pytest

from app.dal import reported_speech as dal
from app.routers.reported_speech import (
    VALID_FOCUS_TAGS,
    _coerce_grade_payload,
    build_fallback_session,
    coerce_session_payload,
    compute_diff_highlights,
    matches_any,
    normalize_text,
    token_overlap_score,
    tokenize,
    _FALLBACK_BANK,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_normalize_text_lowercases_collapses_and_strips_punctuation():
    assert normalize_text('She said THAT she "was" tired.') == (
        "she said that she was tired"
    )
    assert normalize_text("  Hello,   World!  ") == "hello world"
    assert normalize_text("") == ""
    assert normalize_text("She said, 'I will come.'") == "she said i will come"


@pytest.mark.unit
def test_tokenize_splits_on_punctuation_and_case():
    assert tokenize("She said that she WAS tired.") == [
        "she", "said", "that", "she", "was", "tired"
    ]
    assert tokenize("") == []
    assert tokenize("don't stop") == ["don't", "stop"]


@pytest.mark.unit
def test_matches_any_exact_and_normalized():
    reference = "She said that she was tired that day."
    variants = ["She said she was tired that day."]
    assert matches_any("She said that she was tired that day.", [reference]) is True
    # different capitalisation + punctuation still matches
    assert matches_any(
        '  she SAID that she was tired that day!  ', [reference]
    ) is True
    # matches a variant
    assert matches_any(
        "She said she was tired that day",
        [reference, *variants],
    ) is True
    # mismatch
    assert matches_any("She says she is tired today", [reference]) is False
    assert matches_any("", [reference]) is False


@pytest.mark.unit
def test_token_overlap_score_jaccard():
    ref = "She said that she was tired that day"
    # Perfect overlap → 100
    assert token_overlap_score(ref, ref) == 100
    # Partial overlap
    s = token_overlap_score("She said she was tired", ref)
    assert 0 < s < 100
    # No overlap at all
    assert token_overlap_score("foo bar baz", "alpha beta") == 0
    # Empty inputs
    assert token_overlap_score("", ref) == 0
    assert token_overlap_score("", "") == 0


@pytest.mark.unit
def test_compute_diff_highlights_reports_missing_and_extra():
    ref = "She said that she was tired that day"
    attempt = "She said she was tired today"
    diffs = compute_diff_highlights(attempt, ref)
    kinds = {(d["kind"], d["text"]) for d in diffs}
    assert ("missing", "that") in kinds
    assert ("missing", "day") in kinds
    assert ("extra", "today") in kinds
    # No false positives for shared tokens
    assert not any(d["text"] == "she" for d in diffs)


# ---------------------------------------------------------------------------
# Session payload coercion + fallback bank
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_fallback_bank_has_enough_items_and_covers_all_tags():
    assert len(_FALLBACK_BANK) >= 15
    seen: set[str] = set()
    for it in _FALLBACK_BANK:
        for tag in it["focus_tags"]:
            seen.add(tag)
    assert VALID_FOCUS_TAGS.issubset(seen)


@pytest.mark.unit
def test_build_fallback_session_returns_requested_count():
    items = build_fallback_session(count=5, seed=42)
    assert len(items) == 5
    for it in items:
        assert it["direct"]
        assert it["reference"]
        assert it["focus_tags"]
        for tag in it["focus_tags"]:
            assert tag in VALID_FOCUS_TAGS


@pytest.mark.unit
def test_build_fallback_session_unique_ids_preferred():
    items = build_fallback_session(count=5, seed=7)
    ids = [it["id"] for it in items]
    # 5 items picked — no duplicates should appear when bank is large enough.
    assert len(set(ids)) == 5


@pytest.mark.unit
def test_coerce_session_payload_rejects_malformed():
    assert coerce_session_payload(None) is None
    assert coerce_session_payload({}) is None
    assert coerce_session_payload({"items": []}) is None
    # Missing reference
    assert coerce_session_payload(
        {"items": [{"direct": "x", "focus_tags": ["backshift"]}]}
    ) is None
    # Unknown tag filtered out → no tags → rejected
    assert coerce_session_payload(
        {"items": [{
            "direct": "x", "reference": "y", "focus_tags": ["nope"],
        }]}
    ) is None


@pytest.mark.unit
def test_coerce_session_payload_accepts_valid_and_assigns_id():
    raw = {
        "items": [
            {
                "direct": 'She said, "I am here."',
                "reference": "She said that she was there.",
                "accepted_variants": ["She said she was there."],
                "focus_tags": ["backshift", "time_adverb", "BOGUS"],
                "context_hint": "",
            }
        ]
    }
    coerced = coerce_session_payload(raw)
    assert coerced is not None
    assert len(coerced) == 1
    it = coerced[0]
    assert it["id"]  # auto-filled
    assert "backshift" in it["focus_tags"]
    assert "BOGUS" not in it["focus_tags"]
    assert it["context_hint"]  # default filled


# ---------------------------------------------------------------------------
# Grade payload coercion
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_coerce_grade_payload_clips_and_defaults():
    out = _coerce_grade_payload({
        "correct": True,
        "score": 250,
        "feedback": "Nice",
        "diff_highlights": [
            {"kind": "missing", "text": "that"},
            {"kind": "bogus", "text": "x"},  # filtered
            {"text": "no-kind"},  # filtered
        ],
    })
    assert out is not None
    assert out["correct"] is True
    assert out["score"] == 100
    assert out["feedback"] == "Nice"
    assert out["diff_highlights"] == [{"kind": "missing", "text": "that"}]


@pytest.mark.unit
def test_coerce_grade_payload_rejects_non_dict():
    assert _coerce_grade_payload(None) is None
    assert _coerce_grade_payload("nope") is None
    assert _coerce_grade_payload([1, 2, 3]) is None


# ---------------------------------------------------------------------------
# DAL (requires test_db)
# ---------------------------------------------------------------------------

@pytest.mark.unit
@pytest.mark.asyncio
async def test_save_attempt_persists_row_and_serializes_tags(test_db):
    row_id = await dal.save_attempt(
        test_db,
        user_id="local",
        item_id="rs01",
        direct='She said, "I am tired."',
        reference="She said that she was tired.",
        user_answer="She said she was tired.",
        correct=True,
        score=95,
        focus_tags=["backshift", "pronoun"],
    )
    assert row_id > 0

    recent = await dal.recent_attempts(test_db, user_id="local", limit=5)
    assert len(recent) == 1
    r = recent[0]
    assert r["item_id"] == "rs01"
    assert r["correct"] is True
    assert r["score"] == 95
    assert set(r["focus_tags"]) == {"backshift", "pronoun"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_save_attempt_clips_score_to_range(test_db):
    await dal.save_attempt(
        test_db, user_id="local", item_id="x", direct="a",
        reference="b", user_answer="c", correct=False, score=999,
        focus_tags=["backshift"],
    )
    await dal.save_attempt(
        test_db, user_id="local", item_id="x", direct="a",
        reference="b", user_answer="c", correct=False, score=-5,
        focus_tags=["backshift"],
    )
    recent = await dal.recent_attempts(test_db, user_id="local")
    scores = [r["score"] for r in recent]
    assert 100 in scores
    assert 0 in scores


@pytest.mark.unit
@pytest.mark.asyncio
async def test_recent_attempts_scoped_by_user(test_db):
    await dal.save_attempt(
        test_db, user_id="alice", item_id="rs01", direct="d",
        reference="r", user_answer="u", correct=True, score=90,
        focus_tags=["pronoun"],
    )
    await dal.save_attempt(
        test_db, user_id="bob", item_id="rs02", direct="d",
        reference="r", user_answer="u", correct=False, score=40,
        focus_tags=["question"],
    )
    alice = await dal.recent_attempts(test_db, user_id="alice")
    bob = await dal.recent_attempts(test_db, user_id="bob")
    assert len(alice) == 1 and alice[0]["item_id"] == "rs01"
    assert len(bob) == 1 and bob[0]["item_id"] == "rs02"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_recent_focus_weakness_flags_sub_threshold_tags(test_db):
    # backshift: 1/3 correct → weak
    # pronoun:   2/2 correct → strong
    # question:  0/2 correct → weak
    data = [
        ("backshift", True),
        ("backshift", False),
        ("backshift", False),
        ("pronoun", True),
        ("pronoun", True),
        ("question", False),
        ("question", False),
    ]
    for tag, ok in data:
        await dal.save_attempt(
            test_db, user_id="local", item_id="i", direct="d",
            reference="r", user_answer="u", correct=ok, score=80 if ok else 20,
            focus_tags=[tag],
        )
    weak = await dal.get_recent_focus_weakness(
        test_db, user_id="local", limit=50, threshold=0.7
    )
    tags = {w["tag"] for w in weak}
    assert "backshift" in tags
    assert "question" in tags
    assert "pronoun" not in tags
    # Sorted weakest first
    assert weak[0]["accuracy"] <= weak[-1]["accuracy"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_recent_focus_weakness_empty_when_no_rows(test_db):
    weak = await dal.get_recent_focus_weakness(
        test_db, user_id="local", limit=20
    )
    assert weak == []
