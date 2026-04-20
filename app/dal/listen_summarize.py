"""Data access layer for the Listen & Summarize listening drill.

Tracks short-passage summarization attempts: overall score, key-point coverage
ratio, conciseness, accuracy, and metadata (voice used, plays used, level).
Provides recent stats, sparkline data, and a streak count of consecutive
recent attempts at-or-above a quality threshold.
"""

from __future__ import annotations

from typing import Any

import aiosqlite


# Quality threshold (0..1) above which an attempt counts toward the streak.
DEFAULT_STREAK_THRESHOLD: float = 0.7


async def record_attempt(
    db: aiosqlite.Connection,
    *,
    overall: float,
    coverage_ratio: float,
    conciseness: float,
    accuracy: float,
    used_voice: bool,
    plays_used: int,
    level: str,
) -> int:
    """Insert one Listen & Summarize attempt and return its rowid.

    Scores are clamped to [0, 1]. ``plays_used`` is clamped to [0, 5].
    """

    def _clamp01(v: float) -> float:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return 0.0
        if f < 0.0:
            return 0.0
        if f > 1.0:
            return 1.0
        return f

    cur = await db.execute(
        """INSERT INTO listen_summarize_attempts
              (overall, coverage_ratio, conciseness, accuracy,
               used_voice, plays_used, level)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            _clamp01(overall),
            _clamp01(coverage_ratio),
            _clamp01(conciseness),
            _clamp01(accuracy),
            1 if used_voice else 0,
            max(0, min(int(plays_used or 0), 5)),
            (level or "intermediate").strip().lower()[:32] or "intermediate",
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_recent_stats(
    db: aiosqlite.Connection, days: int = 7
) -> dict[str, Any]:
    """Return aggregate stats for the last ``days`` days plus a daily sparkline.

    Shape:
        {
          "total": int,                # total attempts in window
          "average": float,            # mean overall in [0,1] (0 if empty)
          "best": float,               # max overall in window (0 if empty)
          "sparkline": [
              {"date": "YYYY-MM-DD", "avg_overall": float, "attempts": int}, ...
          ],
        }
    """
    days = max(1, int(days))
    rows = await db.execute_fetchall(
        """SELECT overall
             FROM listen_summarize_attempts
            WHERE created_at >= datetime('now', ?)""",
        (f"-{days} days",),
    )
    overalls = [float(r["overall"] or 0.0) for r in rows]
    total = len(overalls)
    average = (sum(overalls) / total) if total else 0.0
    best = max(overalls) if overalls else 0.0

    spark_rows = await db.execute_fetchall(
        """SELECT date(created_at) AS day,
                  AVG(overall) AS avg_overall,
                  COUNT(*) AS n
             FROM listen_summarize_attempts
            WHERE created_at >= datetime('now', ?)
            GROUP BY date(created_at)
            ORDER BY day ASC""",
        (f"-{days} days",),
    )
    sparkline = [
        {
            "date": r["day"],
            "avg_overall": float(r["avg_overall"] or 0.0),
            "attempts": int(r["n"] or 0),
        }
        for r in spark_rows
    ]

    return {
        "total": total,
        "average": float(average),
        "best": float(best),
        "sparkline": sparkline,
    }


async def get_streak(
    db: aiosqlite.Connection,
    threshold: float = DEFAULT_STREAK_THRESHOLD,
) -> int:
    """Return the count of most-recent consecutive attempts with
    ``overall >= threshold``. Stops at the first attempt below threshold.
    """
    th = max(0.0, min(float(threshold), 1.0))
    rows = await db.execute_fetchall(
        """SELECT overall
             FROM listen_summarize_attempts
            ORDER BY id DESC
            LIMIT 200"""
    )
    streak = 0
    for r in rows:
        if float(r["overall"] or 0.0) >= th:
            streak += 1
        else:
            break
    return streak
