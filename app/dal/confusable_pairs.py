"""DAL for the Confusable Word Pair picker drill.

Persists sessions (with the generated items as a JSON blob) and per-item
attempts. Provides per-pair accuracy aggregation for dashboard reuse.
"""

from __future__ import annotations

import json
from typing import Any

import aiosqlite


async def create_session(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    difficulty: str | None,
    pair_filter: str | None,
    items: list[dict[str, Any]],
) -> None:
    """Insert a new session row with the items payload serialised to JSON."""
    await db.execute(
        """INSERT INTO confusable_pair_sessions
               (id, difficulty, pair_filter, item_count, items_json)
           VALUES (?, ?, ?, ?, ?)""",
        (
            str(session_id),
            str(difficulty) if difficulty else None,
            str(pair_filter) if pair_filter else None,
            int(len(items)),
            json.dumps(items, ensure_ascii=False),
        ),
    )
    await db.commit()


async def get_session(
    db: aiosqlite.Connection, session_id: str
) -> dict[str, Any] | None:
    """Load a session by id. Returns None if not found."""
    row = await (
        await db.execute(
            "SELECT id, difficulty, pair_filter, item_count, items_json, created_at "
            "FROM confusable_pair_sessions WHERE id = ?",
            (str(session_id),),
        )
    ).fetchone()
    if row is None:
        return None
    try:
        items = json.loads(row["items_json"] or "[]")
    except Exception:  # noqa: BLE001
        items = []
    return {
        "id": row["id"],
        "difficulty": row["difficulty"],
        "pair_filter": row["pair_filter"],
        "item_count": row["item_count"],
        "items": items,
        "created_at": row["created_at"],
    }


async def get_item(
    db: aiosqlite.Connection, session_id: str, item_id: str
) -> dict[str, Any] | None:
    """Return a single item dict within a session, or None."""
    sess = await get_session(db, session_id)
    if sess is None:
        return None
    for it in sess["items"]:
        if str(it.get("id")) == str(item_id):
            return it
    return None


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    item_id: str,
    pair_key: str,
    choice: str,
    correct_word: str,
    is_correct: bool,
) -> int:
    """Insert one attempt row, returning its new id."""
    cur = await db.execute(
        """INSERT INTO confusable_pair_attempts
               (session_id, item_id, pair_key, choice, correct_word, is_correct)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            str(session_id),
            str(item_id),
            str(pair_key),
            str(choice),
            str(correct_word),
            1 if is_correct else 0,
        ),
    )
    await db.commit()
    return int(cur.lastrowid or 0)


async def get_session_summary(
    db: aiosqlite.Connection, session_id: str
) -> dict[str, Any]:
    """Return {total, correct, per_pair_accuracy, weakest_pair} for a session."""
    rows = await db.execute_fetchall(
        "SELECT pair_key, is_correct FROM confusable_pair_attempts "
        "WHERE session_id = ?",
        (str(session_id),),
    )
    total = len(rows)
    correct = 0
    per_pair: dict[str, dict[str, int]] = {}
    for r in rows:
        pk = r["pair_key"] or "unknown"
        ok = bool(r["is_correct"])
        bucket = per_pair.setdefault(pk, {"total": 0, "correct": 0})
        bucket["total"] += 1
        if ok:
            correct += 1
            bucket["correct"] += 1

    per_pair_accuracy: dict[str, float] = {
        pk: (b["correct"] / b["total"]) if b["total"] else 0.0
        for pk, b in per_pair.items()
    }

    weakest_pair: str | None = None
    if per_pair_accuracy:
        # Pair with lowest accuracy; tie-break on most attempts then lexical.
        weakest_pair = min(
            per_pair_accuracy.keys(),
            key=lambda pk: (
                per_pair_accuracy[pk],
                -per_pair[pk]["total"],
                pk,
            ),
        )

    return {
        "total": total,
        "correct": correct,
        "per_pair_accuracy": per_pair_accuracy,
        "weakest_pair": weakest_pair,
    }


async def get_pair_accuracy(
    db: aiosqlite.Connection, *, days: int = 30
) -> dict[str, dict[str, Any]]:
    """Return per-pair accuracy over the last ``days`` days (dashboard reuse)."""
    days = max(1, int(days))
    rows = await db.execute_fetchall(
        f"""SELECT pair_key, is_correct
              FROM confusable_pair_attempts
             WHERE created_at >= datetime('now', '-{days} days')""",
    )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        pk = r["pair_key"] or "unknown"
        bucket = out.setdefault(pk, {"total": 0, "correct": 0})
        bucket["total"] += 1
        if r["is_correct"]:
            bucket["correct"] += 1
    for pk, b in out.items():
        b["accuracy"] = (b["correct"] / b["total"]) if b["total"] else 0.0
    return out
