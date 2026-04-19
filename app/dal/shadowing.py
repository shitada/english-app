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
