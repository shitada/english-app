"""DAL for the Preposition Cloze Drill.

Loads curated preposition items from a JSON bank (cached in memory) and
persists learner attempts to the ``preposition_attempts`` table.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import aiosqlite

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "prepositions.json"

VALID_CATEGORIES = {"time", "place", "collocation", "phrasal"}
VALID_LEVELS = {"beginner", "intermediate", "advanced"}


@lru_cache(maxsize=1)
def load_items() -> list[dict[str, Any]]:
    """Load preposition items from the JSON bank (cached)."""
    with _DATA_PATH.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)

    items: list[dict[str, Any]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        answer = str(it.get("answer") or "").strip()
        options = [str(o).strip() for o in (it.get("options") or []) if str(o).strip()]
        if not answer or answer not in options:
            # Skip malformed items rather than crash
            continue
        items.append(
            {
                "id": str(it.get("id") or "").strip(),
                "sentence_with_blank": str(it.get("sentence_with_blank") or "").strip(),
                "answer": answer,
                "options": options,
                "explanation": str(it.get("explanation") or "").strip(),
                "category": str(it.get("category") or "").strip(),
                "level": str(it.get("level") or "").strip(),
            }
        )
    return items


def get_item(item_id: str) -> dict[str, Any] | None:
    """Return a single item by id, or None."""
    for it in load_items():
        if it["id"] == item_id:
            return it
    return None


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    item_id: str,
    chosen: str,
    correct: str,
    category: str | None,
    response_ms: int | None = None,
) -> int:
    """Insert one preposition attempt; returns new row id."""
    is_correct = 1 if chosen.strip() == correct.strip() else 0
    cur = await db.execute(
        """INSERT INTO preposition_attempts
               (item_id, chosen, correct, is_correct, category, response_ms)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            str(item_id),
            str(chosen),
            str(correct),
            is_correct,
            category if category else None,
            int(response_ms) if response_ms is not None else None,
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_recent_stats(
    db: aiosqlite.Connection,
    lookback_days: int = 30,
) -> dict[str, Any]:
    """Return overall and per-category accuracy."""
    days = max(1, int(lookback_days))
    rows = await db.execute_fetchall(
        f"""SELECT COUNT(*) AS attempts, SUM(is_correct) AS correct
              FROM preposition_attempts
             WHERE created_at >= datetime('now', '-{days} days')"""
    )
    total = int(rows[0]["attempts"] or 0) if rows else 0
    correct = int(rows[0]["correct"] or 0) if rows else 0
    accuracy = round(correct / total, 4) if total > 0 else 0.0

    cat_rows = await db.execute_fetchall(
        f"""SELECT COALESCE(category, 'other') AS category,
                   COUNT(*) AS attempts, SUM(is_correct) AS correct
              FROM preposition_attempts
             WHERE created_at >= datetime('now', '-{days} days')
             GROUP BY COALESCE(category, 'other')
             ORDER BY category ASC"""
    )
    per_category = [
        {
            "category": r["category"],
            "attempts": int(r["attempts"] or 0),
            "correct": int(r["correct"] or 0),
            "accuracy": round(
                int(r["correct"] or 0) / int(r["attempts"] or 1), 4
            ) if int(r["attempts"] or 0) > 0 else 0.0,
        }
        for r in cat_rows
    ]

    return {
        "attempts": total,
        "correct": correct,
        "accuracy": accuracy,
        "per_category": per_category,
    }


async def get_confused_pairs(
    db: aiosqlite.Connection,
    lookback_days: int = 30,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Return the top confused (correct, chosen) pairs ordered by frequency."""
    days = max(1, int(lookback_days))
    rows = await db.execute_fetchall(
        f"""SELECT correct, chosen, COUNT(*) AS count
              FROM preposition_attempts
             WHERE is_correct = 0
               AND created_at >= datetime('now', '-{days} days')
             GROUP BY correct, chosen
             ORDER BY count DESC, correct ASC, chosen ASC
             LIMIT ?""",
        (max(1, int(limit)),),
    )
    return [
        {
            "correct": r["correct"],
            "chosen": r["chosen"],
            "count": int(r["count"] or 0),
        }
        for r in rows
    ]
