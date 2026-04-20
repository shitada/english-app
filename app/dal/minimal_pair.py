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


async def aggregate_contrast_accuracy(
    db: aiosqlite.Connection,
    lookback: int = 30,
    min_attempts: int = 3,
) -> list[dict[str, Any]]:
    """Aggregate per-contrast accuracy across the most recent sessions.

    Reads the most recent ``lookback`` rows from ``minimal_pair_sessions``,
    parses the ``contrast_summary`` JSON ({contrast: {correct, total}}),
    sums per-contrast counts, filters out contrasts with fewer than
    ``min_attempts`` total attempts, and returns up to 3 entries sorted
    ascending by accuracy then descending by total attempts (i.e. the
    weakest contrasts first, with most-practiced as tiebreaker).
    """
    lookback = max(1, min(int(lookback), 200))
    min_attempts = max(1, int(min_attempts))

    rows = await db.execute_fetchall(
        """SELECT contrast_summary FROM minimal_pair_sessions
           ORDER BY created_at DESC, id DESC
           LIMIT ?""",
        (lookback,),
    )
    totals: dict[str, dict[str, int]] = {}
    for r in rows:
        raw = r["contrast_summary"]
        if not raw:
            continue
        try:
            summary = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if not isinstance(summary, dict):
            continue
        for contrast, vals in summary.items():
            if not isinstance(contrast, str) or not isinstance(vals, dict):
                continue
            try:
                c = int(vals.get("correct", 0))
                t = int(vals.get("total", 0))
            except (ValueError, TypeError):
                continue
            if t <= 0 or c < 0:
                continue
            agg = totals.setdefault(contrast, {"correct": 0, "total": 0})
            agg["correct"] += c
            agg["total"] += t

    results: list[dict[str, Any]] = []
    for contrast, agg in totals.items():
        total = agg["total"]
        if total < min_attempts:
            continue
        correct = min(agg["correct"], total)
        accuracy = correct / total if total > 0 else 0.0
        results.append({
            "contrast": contrast,
            "correct": correct,
            "total": total,
            "accuracy": round(accuracy, 4),
        })

    results.sort(key=lambda x: (x["accuracy"], -x["total"]))
    return results[:3]
