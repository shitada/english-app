"""DAL for the Sentence Stress Spotlight drill."""

from __future__ import annotations

import json
from typing import Any

import aiosqlite


async def record_attempt(
    db: aiosqlite.Connection,
    sentence: str,
    words: list[str],
    expected_indices: list[int],
    user_indices: list[int],
    precision: float,
    recall: float,
    f1: float,
    difficulty: str = "intermediate",
) -> int:
    """Insert a stress-spotlight attempt; return the new row id."""
    cur = await db.execute(
        """INSERT INTO stress_spotlight_attempts
               (sentence, words_json, expected_indices_json,
                user_indices_json, precision_score, recall_score,
                f1_score, difficulty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            sentence,
            json.dumps(list(words)),
            json.dumps([int(i) for i in expected_indices]),
            json.dumps([int(i) for i in user_indices]),
            float(precision),
            float(recall),
            float(f1),
            difficulty,
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def list_recent(
    db: aiosqlite.Connection, limit: int = 10
) -> list[dict[str, Any]]:
    """Return up to `limit` most recent attempts as dicts (decoded JSON)."""
    rows = await db.execute_fetchall(
        """SELECT id, sentence, words_json, expected_indices_json,
                  user_indices_json, precision_score, recall_score,
                  f1_score, difficulty, created_at
             FROM stress_spotlight_attempts
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        try:
            d["words"] = json.loads(d.pop("words_json") or "[]")
        except (TypeError, ValueError):
            d["words"] = []
        try:
            d["expected_indices"] = json.loads(d.pop("expected_indices_json") or "[]")
        except (TypeError, ValueError):
            d["expected_indices"] = []
        try:
            d["user_indices"] = json.loads(d.pop("user_indices_json") or "[]")
        except (TypeError, ValueError):
            d["user_indices"] = []
        out.append(d)
    return out


async def count_attempts(db: aiosqlite.Connection) -> int:
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS n FROM stress_spotlight_attempts"
    )
    return int(rows[0]["n"]) if rows else 0
