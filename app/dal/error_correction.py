"""DAL for the Error Correction Drill.

Persists sessions (category/level/score) and per-item attempts (wrong sentence,
reference, error_type, hint_ja, user_answer, is_correct, explanation_ja).
"""

from __future__ import annotations

from typing import Any, Iterable

import aiosqlite


async def create_session(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    category: str,
    level: str,
) -> None:
    """Insert a new error-correction session row."""
    await db.execute(
        """INSERT INTO error_correction_sessions (id, category, level)
           VALUES (?, ?, ?)""",
        (str(session_id), str(category), str(level)),
    )
    await db.commit()


async def save_items(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    items: Iterable[dict[str, Any]],
) -> None:
    """Bulk-insert items (wrong sentence + reference + error_type + hint_ja).

    Each item dict should include: id, idx, wrong, reference, error_type, hint_ja.
    """
    rows: list[tuple[Any, ...]] = []
    for it in items:
        rows.append(
            (
                str(it["id"]),
                str(session_id),
                int(it.get("idx", 0)),
                str(it.get("wrong") or ""),
                str(it.get("reference") or ""),
                str(it.get("error_type") or ""),
                str(it.get("hint_ja") or ""),
            )
        )
    if not rows:
        return
    await db.executemany(
        """INSERT INTO error_correction_items
              (id, session_id, idx, wrong, reference, error_type, hint_ja)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    await db.commit()


async def get_item(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    item_id: str,
) -> dict[str, Any] | None:
    row = await db.execute_fetchall(
        """SELECT id, session_id, idx, wrong, reference, error_type, hint_ja,
                  user_answer, is_correct, explanation_ja
             FROM error_correction_items
            WHERE session_id = ? AND id = ?
            LIMIT 1""",
        (str(session_id), str(item_id)),
    )
    if not row:
        return None
    r = row[0]
    return {
        "id": r["id"],
        "session_id": r["session_id"],
        "idx": r["idx"],
        "wrong": r["wrong"],
        "reference": r["reference"],
        "error_type": r["error_type"],
        "hint_ja": r["hint_ja"],
        "user_answer": r["user_answer"],
        "is_correct": bool(r["is_correct"]) if r["is_correct"] is not None else None,
        "explanation_ja": r["explanation_ja"],
    }


async def record_answer(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    item_id: str,
    user_answer: str,
    is_correct: bool,
    explanation_ja: str,
    reference: str | None = None,
) -> None:
    """Update the item row with the learner's answer + correctness + ja note."""
    if reference is not None:
        await db.execute(
            """UPDATE error_correction_items
                  SET user_answer = ?, is_correct = ?, explanation_ja = ?,
                      reference = COALESCE(NULLIF(?, ''), reference)
                WHERE session_id = ? AND id = ?""",
            (
                str(user_answer or ""),
                1 if is_correct else 0,
                str(explanation_ja or ""),
                str(reference or ""),
                str(session_id),
                str(item_id),
            ),
        )
    else:
        await db.execute(
            """UPDATE error_correction_items
                  SET user_answer = ?, is_correct = ?, explanation_ja = ?
                WHERE session_id = ? AND id = ?""",
            (
                str(user_answer or ""),
                1 if is_correct else 0,
                str(explanation_ja or ""),
                str(session_id),
                str(item_id),
            ),
        )
    await db.commit()


async def finish_session(
    db: aiosqlite.Connection,
    *,
    session_id: str,
) -> dict[str, Any]:
    """Compute score + missed error types, persist score, and return summary."""
    rows = await db.execute_fetchall(
        """SELECT id, wrong, reference, error_type, user_answer, is_correct,
                  explanation_ja
             FROM error_correction_items
            WHERE session_id = ?
            ORDER BY idx ASC, id ASC""",
        (str(session_id),),
    )
    total = len(rows)
    correct = sum(1 for r in rows if r["is_correct"] == 1)
    attempted = sum(1 for r in rows if r["is_correct"] is not None)
    score = int(round((correct / total) * 100)) if total else 0

    mistakes: list[dict[str, Any]] = []
    for r in rows:
        if r["is_correct"] == 0:
            mistakes.append(
                {
                    "id": r["id"],
                    "wrong": r["wrong"],
                    "reference": r["reference"],
                    "error_type": r["error_type"],
                    "user_answer": r["user_answer"] or "",
                    "explanation_ja": r["explanation_ja"] or "",
                }
            )

    await db.execute(
        "UPDATE error_correction_sessions SET score = ?, finished_at = datetime('now') WHERE id = ?",
        (float(score), str(session_id)),
    )
    await db.commit()

    return {
        "total": total,
        "attempted": attempted,
        "correct": correct,
        "score": score,
        "mistakes": mistakes,
    }
