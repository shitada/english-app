"""DAL for the Linker Speak Drill (cohesive connector practice).

Persists per-attempt rows and provides aggregations (recent accuracy by
category, weakest category/connector).
"""

from __future__ import annotations

from typing import Any

import aiosqlite


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    item_id: str,
    chosen_linker: str,
    correct_linker: str,
    is_correct: bool,
    category: str,
    spoken_similarity: float | None = None,
) -> int:
    """Insert one drill attempt row; return the new id."""
    cur = await db.execute(
        """INSERT INTO linker_drill_attempts
               (item_id, chosen_linker, correct_linker, is_correct,
                category, spoken_similarity)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            str(item_id),
            str(chosen_linker),
            str(correct_linker),
            1 if is_correct else 0,
            str(category),
            None if spoken_similarity is None else float(spoken_similarity),
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_recent_stats(
    db: aiosqlite.Connection, limit: int = 50
) -> dict[str, Any]:
    """Return overall + per-category accuracy/avg_similarity over recent rows."""
    rows = await db.execute_fetchall(
        """SELECT category, is_correct, spoken_similarity
             FROM linker_drill_attempts
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    total = len(rows)
    if not total:
        return {
            "total": 0,
            "overall_accuracy": 0.0,
            "avg_similarity": None,
            "by_category": {},
        }

    correct = 0
    sims: list[float] = []
    by_cat: dict[str, dict[str, Any]] = {}
    for r in rows:
        cat = r["category"]
        ok = bool(r["is_correct"])
        sim = r["spoken_similarity"]
        correct += 1 if ok else 0
        if sim is not None:
            sims.append(float(sim))
        bucket = by_cat.setdefault(
            cat, {"total": 0, "correct": 0, "sims": []}
        )
        bucket["total"] += 1
        if ok:
            bucket["correct"] += 1
        if sim is not None:
            bucket["sims"].append(float(sim))

    by_category = {
        cat: {
            "total": b["total"],
            "accuracy": (b["correct"] / b["total"]) if b["total"] else 0.0,
            "avg_similarity": (sum(b["sims"]) / len(b["sims"])) if b["sims"] else None,
        }
        for cat, b in by_cat.items()
    }

    return {
        "total": total,
        "overall_accuracy": correct / total,
        "avg_similarity": (sum(sims) / len(sims)) if sims else None,
        "by_category": by_category,
    }


async def get_weakest_category(
    db: aiosqlite.Connection, limit: int = 50, min_attempts: int = 3
) -> str | None:
    """Return the category with lowest accuracy (>= min_attempts), else None."""
    stats = await get_recent_stats(db, limit=limit)
    candidates = [
        (cat, info["accuracy"])
        for cat, info in stats["by_category"].items()
        if info["total"] >= min_attempts
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda kv: (kv[1], kv[0]))
    return candidates[0][0]
