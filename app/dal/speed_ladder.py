"""DAL for the Listening Speed Ladder drill.

Persists per-question attempts keyed by (session_id, speed) and provides
per-session / per-speed accuracy aggregates for the history endpoint.
"""

from __future__ import annotations

from typing import Any

import aiosqlite


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    session_id: str,
    speed: float,
    correct: bool,
) -> int:
    """Insert a single attempt row; return the new row id."""
    cur = await db.execute(
        """INSERT INTO speed_ladder_attempts
               (session_id, speed, correct)
           VALUES (?, ?, ?)""",
        (str(session_id), float(speed), 1 if correct else 0),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_session_history(
    db: aiosqlite.Connection,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Return per-session per-speed accuracy for up to the `limit` most recent
    sessions (ordered by latest attempt desc).

    Each entry:
        {"session_id": str,
         "created_at": str,        # most recent created_at in session
         "total": int,
         "correct": int,
         "by_speed": {"0.8": {"total": n, "correct": c, "accuracy": a}, ...}}
    """
    limit = max(1, min(int(limit), 200))

    # Find most recent `limit` session ids.
    sess_rows = await db.execute_fetchall(
        """SELECT session_id, MAX(created_at) AS last_at
             FROM speed_ladder_attempts
            GROUP BY session_id
            ORDER BY last_at DESC
            LIMIT ?""",
        (limit,),
    )
    if not sess_rows:
        return []

    session_ids = [r["session_id"] for r in sess_rows]
    # Fetch all attempts for those sessions in one query.
    placeholders = ",".join("?" for _ in session_ids)
    rows = await db.execute_fetchall(
        f"""SELECT session_id, speed, correct, created_at
              FROM speed_ladder_attempts
             WHERE session_id IN ({placeholders})""",
        tuple(session_ids),
    )

    by_session: dict[str, dict[str, Any]] = {
        r["session_id"]: {
            "session_id": r["session_id"],
            "created_at": r["last_at"],
            "total": 0,
            "correct": 0,
            "by_speed": {},
        }
        for r in sess_rows
    }

    for r in rows:
        sid = r["session_id"]
        bucket = by_session[sid]
        bucket["total"] += 1
        bucket["correct"] += 1 if r["correct"] else 0
        key = _speed_key(float(r["speed"]))
        sp = bucket["by_speed"].setdefault(
            key, {"total": 0, "correct": 0, "accuracy": 0.0}
        )
        sp["total"] += 1
        sp["correct"] += 1 if r["correct"] else 0

    # Finalize accuracy per speed bucket.
    out: list[dict[str, Any]] = []
    for sid in session_ids:
        sess = by_session[sid]
        for sp in sess["by_speed"].values():
            sp["accuracy"] = (
                sp["correct"] / sp["total"] if sp["total"] else 0.0
            )
        out.append(sess)
    return out


async def get_overall_by_speed(
    db: aiosqlite.Connection,
    limit: int = 500,
) -> dict[str, dict[str, Any]]:
    """Return overall {speed: {total, correct, accuracy}} aggregate across
    the most recent `limit` attempts."""
    rows = await db.execute_fetchall(
        """SELECT speed, correct
             FROM speed_ladder_attempts
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (int(limit),),
    )
    agg: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = _speed_key(float(r["speed"]))
        sp = agg.setdefault(key, {"total": 0, "correct": 0, "accuracy": 0.0})
        sp["total"] += 1
        sp["correct"] += 1 if r["correct"] else 0
    for sp in agg.values():
        sp["accuracy"] = sp["correct"] / sp["total"] if sp["total"] else 0.0
    return agg


def _speed_key(speed: float) -> str:
    """Normalize a speed float to a stable string bucket key (e.g. '0.8')."""
    return f"{round(float(speed), 2):g}"
