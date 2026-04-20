"""DAL for the Intonation Arrow Drill.

Loads curated intonation items from a JSON bank (cached in memory) and
persists learner attempts to the ``intonation_arrow_attempts`` table.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import aiosqlite

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "intonation_arrow.json"

VALID_PATTERNS = {"rising", "falling", "rise_fall"}


@lru_cache(maxsize=1)
def load_items() -> list[dict[str, Any]]:
    """Load intonation items from the JSON bank (cached)."""
    with _DATA_PATH.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)

    items: list[dict[str, Any]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        pattern = str(it.get("pattern") or "").strip().lower()
        text = str(it.get("text") or "").strip()
        item_id = str(it.get("id") or "").strip()
        if not item_id or not text or pattern not in VALID_PATTERNS:
            continue
        items.append(
            {
                "id": item_id,
                "text": text,
                "pattern": pattern,
                "explanation": str(it.get("explanation") or "").strip(),
                "category": str(it.get("category") or "").strip(),
            }
        )
    return items


def get_item(item_id: str) -> dict[str, Any] | None:
    """Return a single item by id, or None."""
    for it in load_items():
        if it["id"] == item_id:
            return it
    return None


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    item_id: str,
    chosen: str,
    correct: bool,
    latency_ms: int | None = None,
) -> int:
    """Insert one attempt row. Returns the new row id."""
    cur = await db.execute(
        """INSERT INTO intonation_arrow_attempts
               (item_id, chosen, correct, latency_ms)
           VALUES (?, ?, ?, ?)""",
        (
            str(item_id),
            str(chosen),
            1 if correct else 0,
            int(latency_ms) if latency_ms is not None else None,
        ),
    )
    await db.commit()
    return int(cur.lastrowid or 0)


async def get_stats(
    db: aiosqlite.Connection,
    lookback_days: int = 30,
) -> dict[str, Any]:
    """Return overall accuracy plus per-pattern accuracy over recent attempts."""
    days = max(1, int(lookback_days))

    overall = await db.execute_fetchall(
        f"""SELECT COUNT(*) AS attempts, COALESCE(SUM(correct), 0) AS correct
              FROM intonation_arrow_attempts
             WHERE created_at >= datetime('now', '-{days} days')"""
    )
    total = int(overall[0]["attempts"] or 0) if overall else 0
    correct_total = int(overall[0]["correct"] or 0) if overall else 0
    accuracy = round(correct_total / total, 4) if total > 0 else 0.0

    pattern_rows = await db.execute_fetchall(
        f"""SELECT item_id, chosen, correct
              FROM intonation_arrow_attempts
             WHERE created_at >= datetime('now', '-{days} days')"""
    )

    # Resolve pattern from item_id using bank
    bank = {it["id"]: it["pattern"] for it in load_items()}
    buckets: dict[str, dict[str, int]] = {p: {"attempts": 0, "correct": 0} for p in VALID_PATTERNS}
    for r in pattern_rows:
        pid = str(r["item_id"])
        pattern = bank.get(pid)
        if pattern is None:
            continue
        b = buckets[pattern]
        b["attempts"] += 1
        if int(r["correct"] or 0) == 1:
            b["correct"] += 1

    per_pattern = [
        {
            "pattern": p,
            "attempts": buckets[p]["attempts"],
            "correct": buckets[p]["correct"],
            "accuracy": round(
                buckets[p]["correct"] / buckets[p]["attempts"], 4
            ) if buckets[p]["attempts"] > 0 else 0.0,
        }
        for p in ("rising", "falling", "rise_fall")
    ]

    return {
        "attempts": total,
        "correct": correct_total,
        "accuracy": accuracy,
        "per_pattern": per_pattern,
    }
