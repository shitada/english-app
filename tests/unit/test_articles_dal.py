"""Unit tests for the Article Drill DAL + pure helpers."""

from __future__ import annotations

import pytest

from app.dal import articles as dal
from app.routers.articles import (
    VALID_ANSWERS,
    build_fallback_session,
    coerce_session_payload,
    normalize_article_answer,
    score_submission,
)


@pytest.mark.unit
def test_normalize_article_answer_canonicalises_zero():
    assert normalize_article_answer("A") == "a"
    assert normalize_article_answer(" AN ") == "an"
    assert normalize_article_answer("The") == "the"
    assert normalize_article_answer("none") == "none"
    assert normalize_article_answer("—") == "none"
    assert normalize_article_answer("-") == "none"
    assert normalize_article_answer("∅") == "none"
    assert normalize_article_answer(None) == ""


@pytest.mark.unit
def test_build_fallback_session_returns_8_items():
    items = build_fallback_session("medium", count=8, seed=1)
    assert len(items) == 8
    for it in items:
        assert it["id"]
        assert "__1__" in it["sentence_template"]
        assert it["blanks"]
        for b in it["blanks"]:
            assert b["answer"] in VALID_ANSWERS
            assert b["rule_category"]


@pytest.mark.unit
def test_build_fallback_session_supports_all_levels():
    for diff in ("easy", "medium", "hard"):
        items = build_fallback_session(diff, count=8, seed=7)
        assert len(items) == 8


@pytest.mark.unit
def test_coerce_session_payload_rejects_malformed():
    assert coerce_session_payload(None) is None
    assert coerce_session_payload({}) is None
    assert coerce_session_payload({"items": []}) is None
    # missing blanks
    assert coerce_session_payload(
        {"items": [{"sentence_template": "I saw __1__ cat."}]}
    ) is None
    # invalid answer value
    bad = {
        "items": [
            {
                "id": "x1",
                "sentence_template": "I saw __1__ cat.",
                "blanks": [
                    {"index": 1, "answer": "bogus",
                     "rule_category": "x", "hint": "x"}
                ],
            }
        ]
    }
    assert coerce_session_payload(bad) is None


@pytest.mark.unit
def test_coerce_session_payload_accepts_valid():
    raw = {
        "items": [
            {
                "id": "a1",
                "sentence_template": "I saw __1__ umbrella.",
                "blanks": [
                    {"index": 1, "answer": "an",
                     "rule_category": "indefinite_vowel_sound",
                     "hint": "vowel sound"}
                ],
            }
        ]
    }
    coerced = coerce_session_payload(raw)
    assert coerced is not None
    assert len(coerced) == 1
    assert coerced[0]["blanks"][0]["answer"] == "an"


@pytest.mark.unit
def test_score_submission_mixed_correctness():
    items = [
        {
            "id": "a1",
            "sentence_template": "I saw __1__ cat.",
            "blanks": [{"index": 1, "answer": "a",
                        "rule_category": "indefinite_consonant", "hint": ""}],
            "user_answers": ["a"],
        },
        {
            "id": "a2",
            "sentence_template": "__1__ sun is bright.",
            "blanks": [{"index": 1, "answer": "the",
                        "rule_category": "definite_unique", "hint": ""}],
            "user_answers": ["a"],
        },
        {
            "id": "a3",
            "sentence_template": "I bought __1__ apple and __2__ banana.",
            "blanks": [
                {"index": 1, "answer": "an",
                 "rule_category": "indefinite_vowel_sound", "hint": ""},
                {"index": 2, "answer": "a",
                 "rule_category": "indefinite_consonant", "hint": ""},
            ],
            "user_answers": ["an", "the"],
        },
    ]
    scored = score_submission(items)
    assert scored["total_count"] == 4
    assert scored["correct_count"] == 2
    cats = scored["category_breakdown"]
    assert cats["indefinite_consonant"]["total"] == 2
    assert cats["indefinite_consonant"]["correct"] == 1
    assert cats["definite_unique"]["correct"] == 0
    assert cats["indefinite_vowel_sound"]["correct"] == 1
    assert len(scored["per_blank_results"]) == 4
    assert scored["per_blank_results"][0]["correct"] is True
    assert scored["per_blank_results"][1]["correct"] is False


@pytest.mark.unit
def test_score_submission_treats_dash_as_none():
    items = [
        {
            "id": "z1",
            "sentence_template": "He plays __1__ football.",
            "blanks": [{"index": 1, "answer": "none",
                        "rule_category": "zero_sports", "hint": ""}],
            "user_answers": ["—"],
        }
    ]
    scored = score_submission(items)
    assert scored["correct_count"] == 1
    assert scored["total_count"] == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_insert_attempt_and_stats(test_db):
    categories = {
        "indefinite_consonant": {"correct": 1, "total": 2},
        "definite_unique": {"correct": 0, "total": 1},
    }
    row_id = await dal.insert_attempt(
        test_db,
        difficulty="medium",
        total_count=3,
        correct_count=1,
        blanks=[{"id": "x", "sentence_template": "t", "blanks": []}],
        answers=[["a"]],
        categories=categories,
    )
    assert row_id > 0

    recent = await dal.recent_attempts(test_db, limit=10)
    assert len(recent) == 1
    assert recent[0]["difficulty"] == "medium"
    assert recent[0]["total_count"] == 3

    stats = await dal.category_stats(test_db, days=30)
    assert stats["total"] == 3
    assert stats["correct"] == 1
    assert stats["per_category"]["definite_unique"]["total"] == 1
    assert stats["per_category"]["definite_unique"]["accuracy"] == 0.0
    # indefinite_consonant has 2 attempts, 50% -> should be weakest vs. 0% ties
    # weakest picks lowest accuracy with total>=2 => indefinite_consonant
    assert stats["weakest_category"] == "indefinite_consonant"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stats_empty_db(test_db):
    stats = await dal.category_stats(test_db, days=30)
    assert stats["total"] == 0
    assert stats["correct"] == 0
    assert stats["accuracy"] == 0.0
    assert stats["per_category"] == {}
    assert stats["weakest_category"] is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stats_filters_old_rows(test_db):
    # Insert recent row via DAL
    await dal.insert_attempt(
        test_db,
        difficulty="easy",
        total_count=2,
        correct_count=2,
        blanks=[],
        answers=[],
        categories={"indefinite_consonant": {"correct": 2, "total": 2}},
    )
    # Insert old row bypassing default timestamp
    await test_db.execute(
        """INSERT INTO article_attempts
             (created_at, difficulty, total_count, correct_count,
              blanks_json, answers_json, categories_json)
           VALUES (datetime('now', '-90 days'), 'easy', 4, 0, '[]', '[]',
                   '{"definite_unique": {"correct": 0, "total": 4}}')""",
    )
    await test_db.commit()

    stats = await dal.category_stats(test_db, days=30)
    assert stats["total"] == 2
    assert stats["correct"] == 2
    assert "definite_unique" not in stats["per_category"]
