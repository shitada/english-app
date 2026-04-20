"""DAL for the Reported Speech Transformation drill.

Persists per-attempt rows (direct quote, reference answer, user's attempt,
correctness, score 0-100 and focus_tags) plus helpers for:

* recent attempts list (for a user), and
* recent focus-tag "weakness" — tags that show <70% accuracy across the
  latest attempts, useful to power a "Practice weakest tag" CTA.
"""

from __future__ import annotations

from typing import Any, Iterable

import aiosqlite


FOCUS_TAGS = (
    "backshift",
    "pronoun",
    "time_adverb",
    "question",
    "command",
)


def _serialize_tags(tags: Iterable[str] | None) -> str:
    if not tags:
        return ""
    out = [str(t or "").strip().lower() for t in tags]
    return ",".join(t for t in out if t)


def _deserialize_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [t.strip() for t in str(raw).split(",") if t.strip()]


async def save_attempt(
    db: aiosqlite.Connection,
    *,
    user_id: str,
    item_id: str,
    direct: str,
    reference: str,
    user_answer: str,
    correct: bool,
    score: int,
    focus_tags: Iterable[str] | None = None,
) -> int:
    """Insert one attempt row. Returns new row id."""
    cursor = await db.execute(
        """INSERT INTO reported_speech_attempts
               (user_id, item_id, direct, reference, user_answer,
                correct, score, focus_tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(user_id or "local"),
            str(item_id or ""),
            str(direct or ""),
            str(reference or ""),
            str(user_answer or ""),
            1 if correct else 0,
            max(0, min(100, int(score or 0))),
            _serialize_tags(focus_tags),
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
    limit = max(1, int(limit))
    rows = await db.execute_fetchall(
        """SELECT id, item_id, direct, reference, user_answer,
                  correct, score, focus_tags, created_at
             FROM reported_speech_attempts
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
                "item_id": r["item_id"] or "",
                "direct": r["direct"] or "",
                "reference": r["reference"] or "",
                "user_answer": r["user_answer"] or "",
                "correct": bool(r["correct"]),
                "score": int(r["score"] or 0),
                "focus_tags": _deserialize_tags(r["focus_tags"]),
                "created_at": r["created_at"],
            }
        )
    return out


async def get_recent_focus_weakness(
    db: aiosqlite.Connection,
    *,
    user_id: str,
    limit: int = 20,
    threshold: float = 0.7,
) -> list[dict[str, Any]]:
    """Return focus tags with accuracy < `threshold` over the latest
    `limit` attempts for this user.

    Each entry is ``{"tag": str, "total": int, "correct": int,
    "accuracy": float}`` and the list is sorted by ascending accuracy
    (weakest first), then by descending total.
    """
    limit = max(1, int(limit))
    rows = await db.execute_fetchall(
        """SELECT correct, focus_tags
             FROM reported_speech_attempts
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?""",
        (str(user_id or "local"), limit),
    )

    buckets: dict[str, dict[str, int]] = {}
    for r in rows:
        ok = bool(r["correct"])
        for tag in _deserialize_tags(r["focus_tags"]):
            b = buckets.setdefault(tag, {"total": 0, "correct": 0})
            b["total"] += 1
            if ok:
                b["correct"] += 1

    weak: list[dict[str, Any]] = []
    for tag, b in buckets.items():
        total = b["total"]
        if total <= 0:
            continue
        acc = b["correct"] / total
        if acc < float(threshold):
            weak.append(
                {
                    "tag": tag,
                    "total": total,
                    "correct": b["correct"],
                    "accuracy": acc,
                }
            )
    weak.sort(key=lambda x: (x["accuracy"], -x["total"]))
    return weak
