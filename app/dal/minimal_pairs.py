"""DAL for the Minimal Pairs phoneme-discrimination drill.

This module tracks per-attempt results on phoneme-contrast minimal pairs
(e.g. IY_vs_IH for ship/sheep) in the ``minimal_pairs_attempts`` table.
It is independent from the older ``minimal_pair.py`` module which
persists whole-session summaries.
"""

from __future__ import annotations

from typing import Any

import aiosqlite


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    item_id: str,
    contrast: str,
    word_a: str,
    word_b: str,
    target: str,
    chosen: str,
    is_correct: bool,
) -> int:
    """Insert a single minimal-pairs attempt and return the new row id."""
    if target not in ("a", "b"):
        raise ValueError("target must be 'a' or 'b'")
    if chosen not in ("a", "b"):
        raise ValueError("chosen must be 'a' or 'b'")
    cur = await db.execute(
        """INSERT INTO minimal_pairs_attempts
               (item_id, contrast, word_a, word_b, target, chosen, is_correct)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            str(item_id),
            str(contrast),
            str(word_a),
            str(word_b),
            target,
            chosen,
            1 if is_correct else 0,
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_contrast_stats(
    db: aiosqlite.Connection,
    lookback_days: int = 30,
) -> list[dict[str, Any]]:
    """Return per-contrast accuracy over the last ``lookback_days``.

    Each entry: ``{contrast, attempts, correct, accuracy}`` where
    ``accuracy`` is in [0.0, 1.0], rounded to 4 decimals.
    Results are sorted by contrast name for deterministic output.
    """
    days = max(1, int(lookback_days))
    rows = await db.execute_fetchall(
        f"""SELECT contrast,
                   COUNT(*) AS attempts,
                   SUM(is_correct) AS correct
              FROM minimal_pairs_attempts
             WHERE created_at >= datetime('now', '-{days} days')
             GROUP BY contrast
             ORDER BY contrast ASC"""
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        attempts = int(r["attempts"] or 0)
        correct = int(r["correct"] or 0)
        accuracy = round(correct / attempts, 4) if attempts > 0 else 0.0
        out.append({
            "contrast": r["contrast"],
            "attempts": attempts,
            "correct": correct,
            "accuracy": accuracy,
        })
    return out


async def get_weakest_contrasts(
    db: aiosqlite.Connection,
    lookback_days: int = 30,
    min_attempts: int = 3,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Return the ``limit`` contrasts with lowest accuracy.

    Filters contrasts with fewer than ``min_attempts`` attempts.
    Sorted ascending by accuracy, then descending by attempt count.
    """
    stats = await get_contrast_stats(db, lookback_days=lookback_days)
    filtered = [s for s in stats if s["attempts"] >= max(1, int(min_attempts))]
    filtered.sort(key=lambda s: (s["accuracy"], -s["attempts"]))
    return filtered[: max(1, int(limit))]


async def count_attempts(db: aiosqlite.Connection) -> int:
    """Return total attempts recorded (used by tests)."""
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS n FROM minimal_pairs_attempts"
    )
    return int(rows[0]["n"]) if rows else 0
