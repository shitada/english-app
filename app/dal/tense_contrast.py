"""DAL for the Tense Contrast Drill.

Persists per-item attempts and aggregates per-tense accuracy over a rolling
window (default 30 days).
"""

from __future__ import annotations

from typing import Any, Iterable

import aiosqlite


TENSE_LABELS = (
    "past_simple",
    "present_perfect",
    "present_perfect_continuous",
)


async def create_attempts(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    attempts: Iterable[dict[str, Any]],
) -> int:
    """Insert one row per attempt.

    Each attempt dict should have keys:
        item_id, tense_label, user_answer, correct, elapsed_ms
    Returns the number of rows inserted.
    """
    rows: list[tuple[Any, ...]] = []
    for a in attempts:
        rows.append(
            (
                str(session_id),
                str(a.get("item_id") or ""),
                str(a.get("tense_label") or ""),
                str(a.get("user_answer") or ""),
                1 if a.get("correct") else 0,
                int(a.get("elapsed_ms") or 0),
            )
        )
    if not rows:
        return 0
    await db.executemany(
        """INSERT INTO tense_contrast_attempts
               (session_id, item_id, tense_label, user_answer, correct, elapsed_ms)
           VALUES (?, ?, ?, ?, ?, ?)""",
        rows,
    )
    await db.commit()
    return len(rows)


async def get_stats(
    db: aiosqlite.Connection, days: int = 30
) -> dict[str, Any]:
    """Return per-tense accuracy over the last `days` days + overall totals."""
    days = max(1, int(days))
    rows = await db.execute_fetchall(
        f"""SELECT tense_label, correct
              FROM tense_contrast_attempts
             WHERE created_at >= datetime('now', '-{days} days')""",
    )
    total = len(rows)
    correct = 0
    by_tense: dict[str, dict[str, int]] = {
        t: {"total": 0, "correct": 0} for t in TENSE_LABELS
    }
    for r in rows:
        tense = r["tense_label"] or ""
        ok = bool(r["correct"])
        if ok:
            correct += 1
        bucket = by_tense.setdefault(tense, {"total": 0, "correct": 0})
        bucket["total"] += 1
        if ok:
            bucket["correct"] += 1

    by_tense_out: dict[str, dict[str, Any]] = {}
    for tense, b in by_tense.items():
        by_tense_out[tense] = {
            "total": b["total"],
            "correct": b["correct"],
            "accuracy": (b["correct"] / b["total"]) if b["total"] else 0.0,
        }
    return {
        "days": days,
        "total": total,
        "correct": correct,
        "overall_accuracy": (correct / total) if total else 0.0,
        "by_tense": by_tense_out,
    }
