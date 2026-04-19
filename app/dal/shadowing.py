"""DAL for the Quick Shadowing Drill (listen-and-repeat practice)."""

from __future__ import annotations

from typing import Any

import aiosqlite


async def record_attempt(
    db: aiosqlite.Connection,
    sentence: str,
    transcript: str,
    accuracy: float,
    timing_score: float,
    duration_ms: int,
) -> int:
    """Insert a shadowing attempt; return the new row id."""
    cur = await db.execute(
        """INSERT INTO shadowing_attempts
               (sentence, transcript, accuracy, timing_score, duration_ms)
           VALUES (?, ?, ?, ?, ?)""",
        (sentence, transcript, float(accuracy), float(timing_score), int(duration_ms)),
    )
    await db.commit()
    return cur.lastrowid or 0


async def count_attempts(db: aiosqlite.Connection) -> int:
    """Return total number of recorded attempts."""
    rows = await db.execute_fetchall("SELECT COUNT(*) AS n FROM shadowing_attempts")
    return int(rows[0]["n"]) if rows else 0


async def get_stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Aggregate stats for the shadowing progress badge.

    Returns a dict with:
      - total_attempts (int)
      - avg_combined_last_20 (float, rounded to 1 decimal; 0.0 if none)
      - best_combined (float, rounded to 1 decimal; 0.0 if none)
      - last_attempt_at (ISO string or None)
    """
    total_rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS n FROM shadowing_attempts"
    )
    total = int(total_rows[0]["n"]) if total_rows else 0
    if total == 0:
        return {
            "total_attempts": 0,
            "avg_combined_last_20": 0.0,
            "best_combined": 0.0,
            "last_attempt_at": None,
        }

    recent_rows = await db.execute_fetchall(
        """SELECT (accuracy + timing_score) / 2.0 AS combined
             FROM shadowing_attempts
            ORDER BY created_at DESC, id DESC
            LIMIT 20"""
    )
    if recent_rows:
        avg_combined = sum(float(r["combined"]) for r in recent_rows) / len(recent_rows)
    else:
        avg_combined = 0.0

    best_rows = await db.execute_fetchall(
        "SELECT MAX((accuracy + timing_score) / 2.0) AS best FROM shadowing_attempts"
    )
    best = float(best_rows[0]["best"]) if best_rows and best_rows[0]["best"] is not None else 0.0

    last_rows = await db.execute_fetchall(
        """SELECT created_at FROM shadowing_attempts
            ORDER BY created_at DESC, id DESC LIMIT 1"""
    )
    last_at = last_rows[0]["created_at"] if last_rows else None

    return {
        "total_attempts": total,
        "avg_combined_last_20": round(avg_combined, 1),
        "best_combined": round(best, 1),
        "last_attempt_at": last_at,
    }


async def list_recent(
    db: aiosqlite.Connection, limit: int = 20
) -> list[dict[str, Any]]:
    """Return up to `limit` most recent attempts as dicts."""
    rows = await db.execute_fetchall(
        """SELECT id, sentence, transcript, accuracy, timing_score,
                  duration_ms, created_at
             FROM shadowing_attempts
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    return [dict(r) for r in rows]
