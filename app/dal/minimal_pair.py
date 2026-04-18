"""Data access layer for minimal pair listening sessions."""

from __future__ import annotations

import json
from typing import Any

import aiosqlite


async def save_session(
    db: aiosqlite.Connection,
    correct: int,
    total: int,
    contrast_summary: dict[str, Any],
) -> int:
    """Persist a completed minimal-pair session and return its row id."""
    if total < 0 or correct < 0 or correct > total:
        raise ValueError("invalid correct/total values")
    cursor = await db.execute(
        """INSERT INTO minimal_pair_sessions (correct, total, contrast_summary)
           VALUES (?, ?, ?)""",
        (correct, total, json.dumps(contrast_summary or {})),
    )
    await db.commit()
    return cursor.lastrowid or 0


async def get_recent_sessions(
    db: aiosqlite.Connection, limit: int = 20
) -> list[dict[str, Any]]:
    """Return most recent minimal-pair sessions, newest first."""
    rows = await db.execute_fetchall(
        """SELECT id, created_at, correct, total, contrast_summary
           FROM minimal_pair_sessions
           ORDER BY created_at DESC, id DESC
           LIMIT ?""",
        (max(1, min(limit, 200)),),
    )
    sessions: list[dict[str, Any]] = []
    for r in rows:
        try:
            summary = json.loads(r["contrast_summary"]) if r["contrast_summary"] else {}
        except (ValueError, TypeError):
            summary = {}
        sessions.append({
            "id": r["id"],
            "created_at": r["created_at"],
            "correct": r["correct"],
            "total": r["total"],
            "contrast_summary": summary,
        })
    return sessions
