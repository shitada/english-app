"""DAL for the inline 'Type what you hear' dictation mini-drill."""

from __future__ import annotations

import aiosqlite


async def record_attempt(
    db: aiosqlite.Connection,
    conversation_id: str | None,
    message_id: str | None,
    accuracy: float,
    word_count: int,
    missed_word_count: int,
) -> int:
    """Insert a dictation attempt; return the new row id.

    `accuracy` is a float in [0, 100] representing the percentage of words
    typed correctly compared to the original message.
    """
    cur = await db.execute(
        """INSERT INTO dictation_attempts
               (conversation_id, message_id, accuracy, word_count, missed_word_count)
           VALUES (?, ?, ?, ?, ?)""",
        (
            conversation_id,
            message_id,
            float(accuracy),
            int(word_count),
            int(missed_word_count),
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def recent_avg_accuracy(
    db: aiosqlite.Connection,
    days: int = 7,
) -> float:
    """Return the average accuracy across attempts in the last `days` days.

    Returns 0.0 if there are no attempts in the window.
    """
    days = max(1, int(days))
    rows = await db.execute_fetchall(
        f"""SELECT AVG(accuracy) AS avg_acc
              FROM dictation_attempts
             WHERE created_at >= datetime('now', '-{days} days')"""
    )
    if not rows:
        return 0.0
    val = rows[0]["avg_acc"]
    return float(val) if val is not None else 0.0


async def count_attempts(db: aiosqlite.Connection) -> int:
    """Return the total number of recorded dictation attempts."""
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS n FROM dictation_attempts"
    )
    return int(rows[0]["n"]) if rows else 0
