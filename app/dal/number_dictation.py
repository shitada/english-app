"""DAL for the Number & Date Dictation drill.

Persists per-session summary rows and provides simple aggregations.
"""

from __future__ import annotations

from typing import Any

import aiosqlite


async def record_session(
    db: aiosqlite.Connection,
    *,
    category: str,
    total: int,
    correct: int,
) -> int:
    """Insert one session summary row; return the new id."""
    total_i = max(0, int(total))
    correct_i = max(0, min(int(correct), total_i))
    accuracy = (correct_i / total_i) if total_i > 0 else 0.0
    cur = await db.execute(
        """INSERT INTO number_dictation_sessions
               (category, total, correct, accuracy)
           VALUES (?, ?, ?, ?)""",
        (str(category), total_i, correct_i, float(accuracy)),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_recent_stats(
    db: aiosqlite.Connection, limit: int = 50
) -> dict[str, Any]:
    """Return overall + per-category accuracy over recent session rows."""
    rows = await db.execute_fetchall(
        """SELECT category, total, correct, accuracy
             FROM number_dictation_sessions
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    total_sessions = len(rows)
    if not total_sessions:
        return {
            "sessions": 0,
            "overall_accuracy": 0.0,
            "by_category": {},
        }

    total_items = 0
    total_correct = 0
    by_cat: dict[str, dict[str, int]] = {}
    for r in rows:
        cat = r["category"]
        t = int(r["total"])
        c = int(r["correct"])
        total_items += t
        total_correct += c
        bucket = by_cat.setdefault(cat, {"total": 0, "correct": 0})
        bucket["total"] += t
        bucket["correct"] += c

    by_category = {
        cat: {
            "total": b["total"],
            "correct": b["correct"],
            "accuracy": (b["correct"] / b["total"]) if b["total"] else 0.0,
        }
        for cat, b in by_cat.items()
    }
    return {
        "sessions": total_sessions,
        "overall_accuracy": (total_correct / total_items) if total_items else 0.0,
        "by_category": by_category,
    }
