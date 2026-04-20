"""DAL for the WH-Question Formation speaking drill.

Persists per-attempt rows (question word + correctness + grammar) and
aggregates recent accuracy broken down by wh-word.
"""

from __future__ import annotations

from typing import Any

import aiosqlite


WH_WORDS = ("who", "what", "when", "where", "why", "how")


def _norm_wh(raw: str) -> str:
    return str(raw or "").strip().lower()


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    user_id: str,
    target_wh: str,
    is_correct: bool,
    grammar_ok: bool,
) -> int:
    """Insert one attempt row. Returns the new row id."""
    cursor = await db.execute(
        """INSERT INTO wh_question_attempts
               (user_id, target_wh, is_correct, grammar_ok)
           VALUES (?, ?, ?, ?)""",
        (
            str(user_id or "local"),
            _norm_wh(target_wh),
            1 if is_correct else 0,
            1 if grammar_ok else 0,
        ),
    )
    await db.commit()
    return int(cursor.lastrowid or 0)


async def get_recent_stats(
    db: aiosqlite.Connection,
    *,
    user_id: str,
    limit: int = 30,
) -> dict[str, Any]:
    """Return accuracy broken down by wh-word over the latest `limit` attempts.

    Returns a dict of the shape::

        {
            "total": int,
            "correct": int,
            "grammar_ok": int,
            "overall_accuracy": float,
            "by_wh": {
                "who":  {"total": N, "correct": C, "accuracy": A},
                ...
            }
        }
    """
    limit = max(1, int(limit))
    rows = await db.execute_fetchall(
        """SELECT target_wh, is_correct, grammar_ok
             FROM wh_question_attempts
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?""",
        (str(user_id or "local"), limit),
    )
    total = len(rows)
    correct = 0
    grammar_ok_count = 0
    by_wh: dict[str, dict[str, int]] = {w: {"total": 0, "correct": 0} for w in WH_WORDS}
    for r in rows:
        wh = _norm_wh(r["target_wh"]) or "other"
        ok = bool(r["is_correct"])
        if ok:
            correct += 1
        if bool(r["grammar_ok"]):
            grammar_ok_count += 1
        bucket = by_wh.setdefault(wh, {"total": 0, "correct": 0})
        bucket["total"] += 1
        if ok:
            bucket["correct"] += 1

    by_wh_out: dict[str, dict[str, Any]] = {}
    for wh, b in by_wh.items():
        by_wh_out[wh] = {
            "total": b["total"],
            "correct": b["correct"],
            "accuracy": (b["correct"] / b["total"]) if b["total"] else 0.0,
        }
    return {
        "total": total,
        "correct": correct,
        "grammar_ok": grammar_ok_count,
        "overall_accuracy": (correct / total) if total else 0.0,
        "by_wh": by_wh_out,
    }
