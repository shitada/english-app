"""DAL for the Elastic Sentence drill (progressive expansion)."""

from __future__ import annotations

import json
from typing import Any

import aiosqlite


async def create_session(
    db: aiosqlite.Connection,
    difficulty: str,
    target_sentence: str,
    chain: list[str],
    max_reached: int,
    accuracy: float,
    longest_words: int,
) -> int:
    """Insert a new elastic-sentence session and return its row id."""
    cur = await db.execute(
        """INSERT INTO elastic_sentence_sessions
               (difficulty, target_sentence, chain_json, chain_len,
                max_reached, accuracy, longest_words)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            str(difficulty),
            str(target_sentence),
            json.dumps(list(chain), ensure_ascii=False),
            int(len(chain)),
            int(max_reached),
            float(accuracy),
            int(longest_words),
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def recent_sessions(
    db: aiosqlite.Connection, limit: int = 20
) -> list[dict[str, Any]]:
    """Return up to `limit` most recent sessions as dicts (newest first)."""
    rows = await db.execute_fetchall(
        """SELECT id, difficulty, target_sentence, chain_json, chain_len,
                  max_reached, accuracy, longest_words, created_at
             FROM elastic_sentence_sessions
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        try:
            d["chain"] = json.loads(d.pop("chain_json") or "[]")
        except Exception:
            d["chain"] = []
        out.append(d)
    return out


async def get_stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Aggregate stats for the elastic-sentence drill."""
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS n FROM elastic_sentence_sessions"
    )
    total = int(rows[0]["n"]) if rows else 0
    if total == 0:
        return {
            "total_sessions": 0,
            "avg_accuracy_last_20": 0.0,
            "longest_words": 0,
            "last_session_at": None,
        }

    recent = await db.execute_fetchall(
        """SELECT accuracy FROM elastic_sentence_sessions
            ORDER BY created_at DESC, id DESC LIMIT 20"""
    )
    avg_acc = (
        sum(float(r["accuracy"]) for r in recent) / len(recent) if recent else 0.0
    )

    best_rows = await db.execute_fetchall(
        "SELECT MAX(longest_words) AS best FROM elastic_sentence_sessions"
    )
    best = int(best_rows[0]["best"]) if best_rows and best_rows[0]["best"] is not None else 0

    last = await db.execute_fetchall(
        """SELECT created_at FROM elastic_sentence_sessions
            ORDER BY created_at DESC, id DESC LIMIT 1"""
    )
    last_at = last[0]["created_at"] if last else None

    return {
        "total_sessions": total,
        "avg_accuracy_last_20": round(avg_acc, 1),
        "longest_words": best,
        "last_session_at": last_at,
    }
