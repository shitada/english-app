"""DAL for Collocation Chef drill (verb+noun collocation attempts)."""

from __future__ import annotations

from typing import Any

import aiosqlite


async def save_attempt(
    db: aiosqlite.Connection,
    *,
    item_id: str,
    sentence: str,
    correct_verb: str,
    chosen_verb: str,
    is_correct: bool,
    response_ms: int | None = None,
) -> int:
    """Insert one collocation attempt row; return new id."""
    cur = await db.execute(
        """INSERT INTO collocation_attempts
               (item_id, sentence, correct_verb, chosen_verb,
                is_correct, response_ms)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            str(item_id),
            str(sentence),
            str(correct_verb).lower(),
            str(chosen_verb).lower(),
            1 if is_correct else 0,
            None if response_ms is None else int(response_ms),
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_per_verb_accuracy(
    db: aiosqlite.Connection, limit: int = 500
) -> dict[str, dict[str, Any]]:
    """Return {verb: {total, correct, accuracy}} for recent attempts."""
    rows = await db.execute_fetchall(
        """SELECT correct_verb, is_correct
             FROM collocation_attempts
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        v = r["correct_verb"]
        bucket = out.setdefault(v, {"total": 0, "correct": 0, "accuracy": 0.0})
        bucket["total"] += 1
        if r["is_correct"]:
            bucket["correct"] += 1
    for v, b in out.items():
        b["accuracy"] = (b["correct"] / b["total"]) if b["total"] else 0.0
    return out


async def get_stats(
    db: aiosqlite.Connection,
    *,
    limit: int = 500,
    recent_session_limit: int = 10,
    weakest_min_attempts: int = 2,
) -> dict[str, Any]:
    """Return overall stats, per-verb accuracy, weakest verbs, recent sessions."""
    rows = await db.execute_fetchall(
        """SELECT id, item_id, sentence, correct_verb, chosen_verb,
                  is_correct, response_ms, created_at
             FROM collocation_attempts
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    total = len(rows)
    correct = sum(1 for r in rows if r["is_correct"])
    per_verb_accuracy = await get_per_verb_accuracy(db, limit=limit)

    # Weakest verbs: those with at least weakest_min_attempts and lowest accuracy
    weak_candidates = [
        (verb, info["accuracy"], info["total"])
        for verb, info in per_verb_accuracy.items()
        if info["total"] >= weakest_min_attempts
    ]
    weak_candidates.sort(key=lambda kv: (kv[1], -kv[2], kv[0]))
    weakest_verbs = [v for v, _, _ in weak_candidates[:3]]

    recent_sessions = [
        {
            "id": int(r["id"]),
            "item_id": r["item_id"],
            "sentence": r["sentence"],
            "correct_verb": r["correct_verb"],
            "chosen_verb": r["chosen_verb"],
            "is_correct": bool(r["is_correct"]),
            "response_ms": r["response_ms"],
            "created_at": r["created_at"],
        }
        for r in rows[:recent_session_limit]
    ]

    return {
        "total_attempts": total,
        "accuracy": (correct / total) if total else 0.0,
        "per_verb_accuracy": {
            v: round(info["accuracy"], 4) for v, info in per_verb_accuracy.items()
        },
        "weakest_verbs": weakest_verbs,
        "recent_sessions": recent_sessions,
    }
