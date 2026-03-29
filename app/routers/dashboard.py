"""Dashboard/stats API endpoints."""

from __future__ import annotations

import logging
from datetime import date

import aiosqlite
from fastapi import APIRouter, Depends

from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_stats(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get learning statistics for the dashboard."""

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
    rows = await db.execute_fetchall("SELECT AVG(score) as avg_score FROM pronunciation_attempts WHERE score IS NOT NULL")
    avg_pronunciation_score = round(rows[0]["avg_score"] or 0, 1)

    # Vocabulary words learned (have progress)
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM vocabulary_progress")
    total_vocab_reviewed = rows[0]["cnt"]

    # Vocabulary words mastered (level >= 3)
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE level >= 3")
    vocab_mastered = rows[0]["cnt"]

    # Streak: count consecutive days with activity (conversations or pronunciation)
    rows = await db.execute_fetchall("""
        SELECT DISTINCT date(created_at) as d FROM (
            SELECT created_at FROM messages WHERE role = 'user'
            UNION ALL
            SELECT created_at FROM pronunciation_attempts
        ) ORDER BY d DESC
    """)

    streak = 0
    today = date.today()
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

    # Recent activity (last 7 items)
    activity_rows = await db.execute_fetchall("""
        SELECT 'conversation' as type, topic as detail, started_at as ts FROM conversations
        UNION ALL
        SELECT 'pronunciation' as type, reference_text as detail, created_at as ts FROM pronunciation_attempts
        ORDER BY ts DESC LIMIT 7
    """)
    recent_activity = [
        {"type": r["type"], "detail": r["detail"][:60], "timestamp": r["ts"]}
        for r in activity_rows
    ]

    return {
        "streak": streak,
        "total_conversations": total_conversations,
        "total_messages": total_messages,
        "total_pronunciation": total_pronunciation,
        "avg_pronunciation_score": avg_pronunciation_score,
        "total_vocab_reviewed": total_vocab_reviewed,
        "vocab_mastered": vocab_mastered,
        "recent_activity": recent_activity,
    }
