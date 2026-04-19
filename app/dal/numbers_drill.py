"""DAL for the Quick Numbers & Dates listening drill."""

from __future__ import annotations

import aiosqlite


async def record_attempt(
    db: aiosqlite.Connection,
    kind: str,
    expected: str,
    user_answer: str,
    is_correct: bool,
) -> int:
    """Insert a single drill attempt; return the new row id."""
    cur = await db.execute(
        """INSERT INTO numbers_drill_attempts
               (kind, expected, user_answer, is_correct)
           VALUES (?, ?, ?, ?)""",
        (kind, expected, user_answer, 1 if is_correct else 0),
    )
    await db.commit()
    return cur.lastrowid or 0


async def count_attempts(db: aiosqlite.Connection) -> int:
    """Return total number of recorded attempts (for tests / dashboards)."""
    rows = await db.execute_fetchall("SELECT COUNT(*) AS n FROM numbers_drill_attempts")
    return int(rows[0]["n"]) if rows else 0
