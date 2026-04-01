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

    # Conversations by difficulty
    conversations_by_difficulty = await get_conversations_by_difficulty(db)

    # Grammar accuracy
    grammar_stats = await get_grammar_stats(db)

    # Vocabulary level distribution
    vocab_level_distribution = await get_vocab_level_distribution(db)

    # Conversations by topic
    conversations_by_topic = await get_conversations_by_topic(db)

    return {
        "streak": streak,
        "total_conversations": total_conversations,
        "total_messages": total_messages,
        "total_pronunciation": total_pronunciation,
        "avg_pronunciation_score": avg_pronunciation_score,
        "total_vocab_reviewed": total_vocab_reviewed,
        "vocab_mastered": vocab_mastered,
        "vocab_due_count": vocab_due_count,
        "conversations_by_difficulty": conversations_by_difficulty,
        "grammar_accuracy": grammar_stats["grammar_accuracy"],
        "vocab_level_distribution": vocab_level_distribution,
        "conversations_by_topic": conversations_by_topic,
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


async def get_conversations_by_difficulty(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Get conversation count breakdown by difficulty level."""
    rows = await db.execute_fetchall(
        """SELECT difficulty, COUNT(*) as count
           FROM conversations
           GROUP BY difficulty
           ORDER BY count DESC"""
    )
    return [{"difficulty": r["difficulty"], "count": r["count"]} for r in rows]


async def get_grammar_stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get aggregate grammar feedback statistics from conversation messages."""
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) as total_checked,
                  SUM(CASE WHEN json_extract(feedback_json, '$.errors') = '[]' THEN 1 ELSE 0 END) as error_free
           FROM messages
           WHERE role = 'user' AND feedback_json IS NOT NULL"""
    )
    total = rows[0]["total_checked"]
    error_free = rows[0]["error_free"] or 0
    accuracy = round(error_free / total * 100, 1) if total > 0 else 0
    return {"total_checked": total, "error_free": error_free, "grammar_accuracy": accuracy}


async def get_vocab_level_distribution(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Get vocabulary word count per mastery level."""
    rows = await db.execute_fetchall(
        """SELECT level, COUNT(*) as count
           FROM vocabulary_progress
           GROUP BY level
           ORDER BY level"""
    )
    return [{"level": r["level"], "count": r["count"]} for r in rows]


async def get_conversations_by_topic(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Get conversation count breakdown by topic."""
    rows = await db.execute_fetchall(
        """SELECT topic, COUNT(*) as count
           FROM conversations
           GROUP BY topic
           ORDER BY count DESC"""
    )
    return [{"topic": r["topic"], "count": r["count"]} for r in rows]


async def get_daily_activity(
    db: aiosqlite.Connection, days: int = 30
) -> list[dict[str, Any]]:
    """Get daily learning activity counts for the past N days."""
    rows = await db.execute_fetchall(
        """WITH RECURSIVE dates(d) AS (
               SELECT date('now', '-' || ? || ' days')
               UNION ALL
               SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
           )
           SELECT
               dates.d AS date,
               COALESCE(conv.cnt, 0) AS conversations,
               COALESCE(msg.cnt, 0) AS messages,
               COALESCE(pron.cnt, 0) AS pronunciation_attempts,
               COALESCE(vocab.cnt, 0) AS vocabulary_reviews
           FROM dates
           LEFT JOIN (
               SELECT date(started_at) AS d, COUNT(*) AS cnt
               FROM conversations GROUP BY date(started_at)
           ) conv ON dates.d = conv.d
           LEFT JOIN (
               SELECT date(created_at) AS d, COUNT(*) AS cnt
               FROM messages WHERE role = 'user' GROUP BY date(created_at)
           ) msg ON dates.d = msg.d
           LEFT JOIN (
               SELECT date(created_at) AS d, COUNT(*) AS cnt
               FROM pronunciation_attempts GROUP BY date(created_at)
           ) pron ON dates.d = pron.d
           LEFT JOIN (
               SELECT date(last_reviewed) AS d, COUNT(*) AS cnt
               FROM vocabulary_progress
               WHERE last_reviewed IS NOT NULL
               GROUP BY date(last_reviewed)
           ) vocab ON dates.d = vocab.d
           ORDER BY dates.d ASC""",
        (days,),
    )
    return [
        {
            "date": r["date"],
            "conversations": r["conversations"],
            "messages": r["messages"],
            "pronunciation_attempts": r["pronunciation_attempts"],
            "vocabulary_reviews": r["vocabulary_reviews"],
        }
        for r in rows
    ]
