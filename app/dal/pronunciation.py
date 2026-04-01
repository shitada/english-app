"""Data access layer for pronunciation attempts."""

from __future__ import annotations

import json
import re
from typing import Any

import aiosqlite


async def get_sentences_from_conversations(
    db: aiosqlite.Connection, limit: int = 20, difficulty: str | None = None
) -> list[dict[str, str]]:
    rows = await db.execute_fetchall(
        """SELECT DISTINCT m.content, c.topic, c.difficulty
           FROM messages m
           JOIN conversations c ON m.conversation_id = c.id
           WHERE m.role = 'assistant'
           ORDER BY m.created_at DESC
           LIMIT ?""",
        (limit,),
    )
    sentences: list[dict[str, str]] = []
    seen: set[str] = set()
    for r in rows:
        content = r["content"]
        conv_difficulty = r["difficulty"] or "intermediate"
        # Split on sentence boundaries, preserving trailing punctuation
        fragments = re.split(r'(?<=[.!?])\s+', content)
        for sent in fragments:
            sent = sent.strip()
            # Ensure sentence ends with punctuation
            if sent and sent[-1] not in '.!?':
                sent += '.'
            word_count = len(sent.rstrip('.!?').split())
            if 5 <= word_count <= 20 and sent not in seen:
                # Use conversation difficulty or estimate from word count
                est_difficulty = _estimate_difficulty(word_count, conv_difficulty)
                if difficulty and est_difficulty != difficulty:
                    continue
                seen.add(sent)
                sentences.append({"text": sent, "topic": r["topic"], "difficulty": est_difficulty})
                if len(sentences) >= 10:
                    return sentences
    return sentences


def _estimate_difficulty(word_count: int, conv_difficulty: str) -> str:
    """Estimate sentence difficulty from word count, falling back to conversation difficulty."""
    if word_count <= 8:
        return "beginner"
    elif word_count <= 14:
        return "intermediate"
    else:
        return "advanced"


async def save_attempt(
    db: aiosqlite.Connection,
    reference_text: str,
    user_transcription: str,
    feedback: dict[str, Any],
    score: float,
) -> int:
    cursor = await db.execute(
        """INSERT INTO pronunciation_attempts
           (reference_text, user_transcription, feedback_json, score)
           VALUES (?, ?, ?, ?)""",
        (reference_text, user_transcription, json.dumps(feedback), score),
    )
    await db.commit()
    return cursor.lastrowid


async def get_history(db: aiosqlite.Connection, limit: int = 20) -> list[dict[str, Any]]:
    rows = await db.execute_fetchall(
        """SELECT id, reference_text, user_transcription, feedback_json, score, created_at
           FROM pronunciation_attempts
           ORDER BY created_at DESC LIMIT ?""",
        (limit,),
    )
    return [
        {
            "id": r["id"],
            "reference_text": r["reference_text"],
            "user_transcription": r["user_transcription"],
            "feedback": json.loads(r["feedback_json"]) if r["feedback_json"] else None,
            "score": r["score"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


async def get_progress(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get aggregate pronunciation progress stats."""

    # Total attempts and scores
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) as total, AVG(score) as avg_score,
                  MAX(score) as best_score
           FROM pronunciation_attempts WHERE score IS NOT NULL"""
    )
    total = rows[0]["total"]
    avg_score = round(rows[0]["avg_score"] or 0, 1)
    best_score = rows[0]["best_score"] or 0

    # Daily average scores for trend
    daily_rows = await db.execute_fetchall(
        """SELECT date(created_at) as day, AVG(score) as avg_score, COUNT(*) as count
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
           GROUP BY date(created_at)
           ORDER BY day DESC
           LIMIT 30"""
    )
    scores_by_date = [
        {"date": r["day"], "avg_score": round(r["avg_score"], 1), "count": r["count"]}
        for r in daily_rows
    ]

    # Most practiced sentences
    sentence_rows = await db.execute_fetchall(
        """SELECT reference_text, COUNT(*) as attempt_count,
                  AVG(score) as avg_score
           FROM pronunciation_attempts
           GROUP BY reference_text
           ORDER BY attempt_count DESC
           LIMIT 5"""
    )
    most_practiced = [
        {
            "text": r["reference_text"],
            "attempt_count": r["attempt_count"],
            "avg_score": round(r["avg_score"] or 0, 1),
        }
        for r in sentence_rows
    ]

    return {
        "total_attempts": total,
        "avg_score": avg_score,
        "best_score": best_score,
        "scores_by_date": scores_by_date,
        "most_practiced": most_practiced,
    }


async def clear_history(db: aiosqlite.Connection) -> int:
    """Delete all pronunciation attempts."""
    cursor = await db.execute("DELETE FROM pronunciation_attempts")
    await db.commit()
    return cursor.rowcount


async def delete_attempt(db: aiosqlite.Connection, attempt_id: int) -> bool:
    """Delete a single pronunciation attempt. Returns True if deleted."""
    cursor = await db.execute("DELETE FROM pronunciation_attempts WHERE id = ?", (attempt_id,))
    await db.commit()
    return cursor.rowcount > 0


async def get_score_trend(db: aiosqlite.Connection, window: int = 5) -> dict[str, Any]:
    """Calculate pronunciation score trend (improving/declining/stable).
    
    Compares average of last `window` attempts to the `window` before that.
    """
    rows = await db.execute_fetchall(
        "SELECT score FROM pronunciation_attempts WHERE score IS NOT NULL ORDER BY id DESC LIMIT ?",
        (window * 2,),
    )
    if len(rows) < window:
        return {"trend": "insufficient_data", "recent_avg": 0, "previous_avg": 0, "change": 0}
    
    recent = [r["score"] for r in rows[:window]]
    previous = [r["score"] for r in rows[window:]]
    recent_avg = round(sum(recent) / len(recent), 2)
    previous_avg = round(sum(previous) / len(previous), 2) if previous else recent_avg
    change = round(recent_avg - previous_avg, 2)
    
    if change > 0.5:
        trend = "improving"
    elif change < -0.5:
        trend = "declining"
    else:
        trend = "stable"
    
    return {"trend": trend, "recent_avg": recent_avg, "previous_avg": previous_avg, "change": change}


_SCORE_BUCKETS = [
    ("poor", 0, 2),
    ("fair", 3, 4),
    ("good", 5, 6),
    ("very_good", 7, 8),
    ("excellent", 9, 10),
]


async def get_score_distribution(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get pronunciation scores grouped into quality buckets."""
    rows = await db.execute_fetchall(
        "SELECT score FROM pronunciation_attempts WHERE score IS NOT NULL"
    )
    bucket_counts = {name: 0 for name, _, _ in _SCORE_BUCKETS}
    for r in rows:
        score = r["score"]
        for name, lo, hi in _SCORE_BUCKETS:
            if lo <= score <= hi:
                bucket_counts[name] = bucket_counts.get(name, 0) + 1
                break

    distribution = [
        {
            "bucket": name,
            "label": name.replace("_", " ").title(),
            "min_score": lo,
            "max_score": hi,
            "count": bucket_counts[name],
        }
        for name, lo, hi in _SCORE_BUCKETS
    ]
    return {
        "total_attempts": len(rows),
        "distribution": distribution,
    }


async def get_personal_records(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get pronunciation personal records (best, worst, average scores)."""
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) as total_attempts,
                  ROUND(AVG(score), 2) as avg_score,
                  MAX(score) as best_score,
                  MIN(score) as worst_score
           FROM pronunciation_attempts
           WHERE score IS NOT NULL"""
    )
    r = dict(rows[0]) if rows else {}

    # Best and worst sentences
    best_rows = await db.execute_fetchall(
        """SELECT reference_text, score, created_at
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
           ORDER BY score DESC LIMIT 3"""
    )
    worst_rows = await db.execute_fetchall(
        """SELECT reference_text, score, created_at
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
           ORDER BY score ASC LIMIT 3"""
    )

    return {
        "total_attempts": r.get("total_attempts", 0),
        "avg_score": r.get("avg_score") or 0,
        "best_score": r.get("best_score") or 0,
        "worst_score": r.get("worst_score") or 0,
        "best_attempts": [
            {"text": row["reference_text"], "score": row["score"], "date": row["created_at"]}
            for row in best_rows
        ],
        "worst_attempts": [
            {"text": row["reference_text"], "score": row["score"], "date": row["created_at"]}
            for row in worst_rows
        ],
    }


async def get_weekly_progress(
    db: aiosqlite.Connection, weeks: int = 8
) -> dict[str, Any]:
    """Get pronunciation score averages grouped by week."""
    rows = await db.execute_fetchall(
        """SELECT strftime('%Y-W%W', created_at) as week,
                  COUNT(*) as attempt_count,
                  ROUND(AVG(score), 2) as avg_score,
                  MAX(score) as best_score
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
             AND created_at >= datetime('now', ?)
           GROUP BY week
           ORDER BY week ASC""",
        (f"-{weeks * 7} days",),
    )
    weekly = [
        {
            "week": row["week"],
            "attempt_count": row["attempt_count"],
            "avg_score": row["avg_score"] or 0,
            "best_score": row["best_score"] or 0,
        }
        for row in rows
    ]
    # Calculate improvement trend
    if len(weekly) >= 2:
        first_avg = weekly[0]["avg_score"]
        last_avg = weekly[-1]["avg_score"]
        improvement = round(last_avg - first_avg, 2)
    else:
        improvement = 0.0

    return {
        "weeks": weekly,
        "total_weeks": len(weekly),
        "improvement": improvement,
    }
