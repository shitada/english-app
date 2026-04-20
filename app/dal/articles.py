"""DAL for the Article Chip Drill (a/an/the/∅).

Persists one row per completed article-drill session. Each row carries
denormalised JSON blobs so the router can compute per-category accuracy
without a second table.
"""

from __future__ import annotations

import json
from typing import Any

import aiosqlite


VALID_ARTICLE_ANSWERS = ("a", "an", "the", "none")
VALID_DIFFICULTIES = ("easy", "medium", "hard")


async def insert_attempt(
    db: aiosqlite.Connection,
    *,
    difficulty: str,
    total_count: int,
    correct_count: int,
    blanks: list[dict[str, Any]],
    answers: list[dict[str, Any]],
    categories: dict[str, dict[str, int]],
    user_id: int | None = None,
) -> int:
    """Insert a single article-drill session row.

    Returns the new row id.
    """
    cur = await db.execute(
        """INSERT INTO article_attempts
               (user_id, difficulty, total_count, correct_count,
                blanks_json, answers_json, categories_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            user_id,
            str(difficulty or "medium"),
            int(total_count),
            int(correct_count),
            json.dumps(blanks),
            json.dumps(answers),
            json.dumps(categories),
        ),
    )
    await db.commit()
    return int(cur.lastrowid or 0)


async def recent_attempts(
    db: aiosqlite.Connection, *, limit: int = 20
) -> list[dict[str, Any]]:
    """Return the most recent article-drill attempts (most recent first)."""
    limit = max(1, min(int(limit), 200))
    rows = await db.execute_fetchall(
        f"""SELECT id, user_id, created_at, difficulty, total_count,
                   correct_count, categories_json
              FROM article_attempts
             ORDER BY id DESC
             LIMIT {limit}""",
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            cats = json.loads(r["categories_json"] or "{}")
        except (ValueError, TypeError):
            cats = {}
        out.append(
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "created_at": r["created_at"],
                "difficulty": r["difficulty"],
                "total_count": r["total_count"],
                "correct_count": r["correct_count"],
                "categories": cats,
            }
        )
    return out


async def category_stats(
    db: aiosqlite.Connection, *, days: int = 30
) -> dict[str, Any]:
    """Aggregate per-rule-category accuracy over the last N days."""
    days = max(1, int(days))
    rows = await db.execute_fetchall(
        f"""SELECT total_count, correct_count, categories_json
              FROM article_attempts
             WHERE created_at >= datetime('now', '-{days} days')""",
    )
    total = 0
    correct = 0
    per_cat: dict[str, dict[str, int]] = {}
    for r in rows:
        total += int(r["total_count"] or 0)
        correct += int(r["correct_count"] or 0)
        try:
            cats = json.loads(r["categories_json"] or "{}")
        except (ValueError, TypeError):
            cats = {}
        if not isinstance(cats, dict):
            continue
        for cat, info in cats.items():
            if not isinstance(info, dict):
                continue
            bucket = per_cat.setdefault(cat, {"total": 0, "correct": 0})
            bucket["total"] += int(info.get("total") or 0)
            bucket["correct"] += int(info.get("correct") or 0)

    per_cat_out: dict[str, dict[str, Any]] = {}
    weakest: str | None = None
    weakest_acc = 2.0
    for cat, b in per_cat.items():
        acc = (b["correct"] / b["total"]) if b["total"] else 0.0
        per_cat_out[cat] = {
            "total": b["total"],
            "correct": b["correct"],
            "accuracy": acc,
        }
        if b["total"] >= 2 and acc < weakest_acc:
            weakest_acc = acc
            weakest = cat

    return {
        "days": days,
        "total": total,
        "correct": correct,
        "accuracy": (correct / total) if total else 0.0,
        "per_category": per_cat_out,
        "weakest_category": weakest,
    }
