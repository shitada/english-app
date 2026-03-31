"""Data access layer for pronunciation attempts."""

from __future__ import annotations

import json
import re
from typing import Any

import aiosqlite


async def get_sentences_from_conversations(db: aiosqlite.Connection, limit: int = 20) -> list[dict[str, str]]:
    rows = await db.execute_fetchall(
        """SELECT DISTINCT m.content, c.topic
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
        # Split on sentence boundaries, preserving trailing punctuation
        fragments = re.split(r'(?<=[.!?])\s+', content)
        for sent in fragments:
            sent = sent.strip()
            # Ensure sentence ends with punctuation
            if sent and sent[-1] not in '.!?':
                sent += '.'
            if 5 <= len(sent.rstrip('.!?').split()) <= 20 and sent not in seen:
                seen.add(sent)
                sentences.append({"text": sent, "topic": r["topic"]})
                if len(sentences) >= 10:
                    return sentences
    return sentences


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
