"""Data access layer for dashboard statistics."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import aiosqlite


async def get_stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Gather all dashboard statistics from the database."""

    # Total conversations
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM conversations")
    total_conversations = rows[0]["cnt"]

    # Total messages by user
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM messages WHERE role = 'user'")
    total_messages = rows[0]["cnt"]

    # Total pronunciation attempts
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM pronunciation_attempts")
    total_pronunciation = rows[0]["cnt"]

    # Average pronunciation score
    rows = await db.execute_fetchall(
        "SELECT AVG(score) as avg_score FROM pronunciation_attempts WHERE score IS NOT NULL"
    )
    avg_pronunciation_score = round(rows[0]["avg_score"] or 0, 1)

    # Vocabulary words learned (have progress)
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM vocabulary_progress")
    total_vocab_reviewed = rows[0]["cnt"]

    # Vocabulary words mastered (level >= 3)
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE level >= 3")
    vocab_mastered = rows[0]["cnt"]

    # Vocabulary words due for review
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE next_review_at <= ?", (now,)
    )
    vocab_due_count = rows[0]["cnt"]

    # Streak: count consecutive days with activity
    streak = await _calculate_streak(db)

    # Recent activity (last 7 items)
    recent_activity = await _get_recent_activity(db)

    return {
        "streak": streak,
        "total_conversations": total_conversations,
        "total_messages": total_messages,
        "total_pronunciation": total_pronunciation,
        "avg_pronunciation_score": avg_pronunciation_score,
        "total_vocab_reviewed": total_vocab_reviewed,
        "vocab_mastered": vocab_mastered,
        "vocab_due_count": vocab_due_count,
        "recent_activity": recent_activity,
    }


async def _calculate_streak(db: aiosqlite.Connection) -> int:
    """Count consecutive days with learning activity ending at today."""
    rows = await db.execute_fetchall("""
        SELECT DISTINCT date(created_at) as d FROM (
            SELECT created_at FROM messages WHERE role = 'user'
            UNION ALL
            SELECT created_at FROM pronunciation_attempts
            UNION ALL
            SELECT last_reviewed AS created_at FROM vocabulary_progress
            WHERE last_reviewed IS NOT NULL
        ) ORDER BY d DESC
    """)

    streak = 0
    today = datetime.now(timezone.utc).date()
    for i, r in enumerate(rows):
        try:
            day = date.fromisoformat(r["d"])
        except (ValueError, TypeError):
            break
        expected = today.toordinal() - i
        if day.toordinal() == expected:
            streak += 1
        else:
            break
    return streak


async def _get_recent_activity(db: aiosqlite.Connection, limit: int = 7) -> list[dict[str, Any]]:
    """Get recent learning activity feed."""
    rows = await db.execute_fetchall("""
        SELECT 'conversation' as type, topic as detail, started_at as ts FROM conversations
        UNION ALL
        SELECT 'pronunciation' as type, reference_text as detail, created_at as ts FROM pronunciation_attempts
        UNION ALL
        SELECT 'vocabulary' as type, vw.word as detail, vp.last_reviewed as ts
        FROM vocabulary_progress vp
        JOIN vocabulary_words vw ON vp.word_id = vw.id
        WHERE vp.last_reviewed IS NOT NULL
        ORDER BY ts DESC LIMIT ?
    """, (limit,))
    return [
        {"type": r["type"], "detail": r["detail"][:60], "timestamp": r["ts"]}
        for r in rows
    ]
