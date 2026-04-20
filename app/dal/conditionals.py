"""DAL for the Conditional Transform Drill (Type 0/1/2/3).

Persists generated prompts (for later reference by prompt_id) and per-attempt
rows containing the learner's answer, the LLM's model answer, feedback,
issues, detected conditional type, and the 0..100 score.
"""

from __future__ import annotations

import json
from typing import Any, Iterable

import aiosqlite


VALID_LEVELS = ("beginner", "intermediate", "advanced")
VALID_TYPES = (0, 1, 2, 3)


def _serialize_issues(issues: Iterable[str] | None) -> str:
    if not issues:
        return "[]"
    cleaned = [str(i).strip() for i in issues if str(i or "").strip()]
    try:
        return json.dumps(cleaned[:8])
    except Exception:  # noqa: BLE001
        return "[]"


def _deserialize_issues(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        out = json.loads(raw)
        if isinstance(out, list):
            return [str(x) for x in out]
    except Exception:  # noqa: BLE001
        pass
    return []


async def save_prompt(
    db: aiosqlite.Connection,
    *,
    prompt_id: str,
    target_type: int,
    level: str,
    base_sentence: str,
    hint: str = "",
) -> str:
    """Insert (or replace) a generated conditional prompt row."""
    await db.execute(
        """INSERT OR REPLACE INTO conditional_prompts
               (id, target_type, level, base_sentence, hint)
           VALUES (?, ?, ?, ?, ?)""",
        (
            str(prompt_id),
            int(target_type),
            str(level or "intermediate"),
            str(base_sentence or ""),
            str(hint or ""),
        ),
    )
    await db.commit()
    return prompt_id


async def get_prompt(
    db: aiosqlite.Connection, prompt_id: str
) -> dict[str, Any] | None:
    """Return a stored prompt dict or None."""
    rows = await db.execute_fetchall(
        """SELECT id, target_type, level, base_sentence, hint, created_at
             FROM conditional_prompts WHERE id = ? LIMIT 1""",
        (str(prompt_id),),
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "id": r["id"],
        "target_type": int(r["target_type"]),
        "level": r["level"],
        "base_sentence": r["base_sentence"] or "",
        "hint": r["hint"] or "",
        "created_at": r["created_at"],
    }


async def save_attempt(
    db: aiosqlite.Connection,
    *,
    user_id: str,
    prompt_id: str,
    target_type: int,
    detected_type: int | None,
    base_sentence: str,
    user_answer: str,
    model_answer: str,
    feedback: str,
    issues: Iterable[str] | None,
    correct: bool,
    score: int,
) -> int:
    """Insert one attempt row. Returns new row id."""
    cursor = await db.execute(
        """INSERT INTO conditional_attempts
               (user_id, prompt_id, target_type, detected_type,
                base_sentence, user_answer, model_answer, feedback,
                issues, correct, score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(user_id or "local"),
            str(prompt_id or ""),
            int(target_type),
            int(detected_type) if detected_type is not None else None,
            str(base_sentence or ""),
            str(user_answer or ""),
            str(model_answer or ""),
            str(feedback or ""),
            _serialize_issues(issues),
            1 if correct else 0,
            max(0, min(100, int(score or 0))),
        ),
    )
    await db.commit()
    return int(cursor.lastrowid or 0)


async def recent_attempts(
    db: aiosqlite.Connection,
    *,
    user_id: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Return the newest `limit` attempts for the given user."""
    limit = max(1, min(200, int(limit)))
    rows = await db.execute_fetchall(
        """SELECT id, prompt_id, target_type, detected_type,
                  base_sentence, user_answer, model_answer, feedback,
                  issues, correct, score, created_at
             FROM conditional_attempts
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?""",
        (str(user_id or "local"), limit),
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": int(r["id"]),
                "prompt_id": r["prompt_id"] or "",
                "target_type": int(r["target_type"]),
                "detected_type": (
                    int(r["detected_type"])
                    if r["detected_type"] is not None
                    else None
                ),
                "base_sentence": r["base_sentence"] or "",
                "user_answer": r["user_answer"] or "",
                "model_answer": r["model_answer"] or "",
                "feedback": r["feedback"] or "",
                "issues": _deserialize_issues(r["issues"]),
                "correct": bool(r["correct"]),
                "score": int(r["score"] or 0),
                "created_at": r["created_at"],
            }
        )
    return out
