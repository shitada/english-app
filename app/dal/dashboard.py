"""Data access layer for dashboard statistics."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import aiosqlite


async def get_stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Gather all dashboard statistics from the database."""

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    rows = await db.execute_fetchall(
        """
        SELECT
            (SELECT COUNT(*) FROM conversations) AS total_conversations,
            (SELECT COUNT(*) FROM messages WHERE role = 'user') AS total_messages,
            (SELECT COUNT(*) FROM pronunciation_attempts) AS total_pronunciation,
            COALESCE((SELECT AVG(score) FROM pronunciation_attempts WHERE score IS NOT NULL), 0) AS avg_pronunciation_score,
            (SELECT COUNT(*) FROM vocabulary_progress) AS total_vocab_reviewed,
            (SELECT COUNT(*) FROM vocabulary_progress WHERE level >= 3) AS vocab_mastered,
            (SELECT COUNT(*) FROM vocabulary_progress WHERE next_review_at IS NULL OR next_review_at <= ?) AS vocab_due_count
        """,
        (now,),
    )
    r = rows[0]
    total_conversations = r["total_conversations"]
    total_messages = r["total_messages"]
    total_pronunciation = r["total_pronunciation"]
    avg_pronunciation_score = round(r["avg_pronunciation_score"] or 0, 1)
    total_vocab_reviewed = r["total_vocab_reviewed"]
    vocab_mastered = r["vocab_mastered"]
    vocab_due_count = r["vocab_due_count"]

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
    """Count consecutive days with learning activity ending at today or yesterday."""
    rows = await db.execute_fetchall("""
        SELECT DISTINCT date(created_at) as d FROM (
            SELECT created_at FROM messages WHERE role = 'user' AND created_at >= date('now', '-366 days')
            UNION ALL
            SELECT created_at FROM pronunciation_attempts WHERE created_at >= date('now', '-366 days')
            UNION ALL
            SELECT answered_at AS created_at FROM quiz_attempts WHERE answered_at >= date('now', '-366 days')
            UNION ALL
            SELECT created_at FROM listening_quiz_results WHERE created_at >= date('now', '-366 days')
            UNION ALL
            SELECT created_at FROM speaking_journal WHERE created_at >= date('now', '-366 days')
        ) ORDER BY d DESC
    """)

    streak = 0
    today = datetime.now(timezone.utc).date()
    if not rows:
        return 0

    # Allow streak to start from yesterday if no activity today
    try:
        most_recent = date.fromisoformat(rows[0]["d"])
    except (ValueError, TypeError):
        return 0

    gap = today.toordinal() - most_recent.toordinal()
    if gap > 1:
        return 0

    # Start counting from the most recent activity day
    start_ordinal = most_recent.toordinal()
    for i, r in enumerate(rows):
        try:
            day = date.fromisoformat(r["d"])
        except (ValueError, TypeError):
            break
        if day.toordinal() == start_ordinal - i:
            streak += 1
        else:
            break
    return streak


async def _get_recent_activity(db: aiosqlite.Connection, limit: int = 7) -> list[dict[str, Any]]:
    """Get recent learning activity feed."""
    rows = await db.execute_fetchall("""
        SELECT type, detail, ts FROM (
            SELECT 'conversation' as type, topic as detail, started_at as ts FROM conversations ORDER BY started_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'pronunciation' as type, reference_text as detail, created_at as ts FROM pronunciation_attempts ORDER BY created_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'vocabulary' as type, vw.word as detail, qa.answered_at as ts
            FROM quiz_attempts qa
            JOIN vocabulary_words vw ON qa.word_id = vw.id
            ORDER BY qa.answered_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'listening' as type, title as detail, created_at as ts FROM listening_quiz_results ORDER BY created_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'speaking_journal' as type, prompt as detail, created_at as ts FROM speaking_journal ORDER BY created_at DESC LIMIT ?
        )
        ORDER BY ts DESC LIMIT ?
    """, (limit, limit, limit, limit, limit, limit))
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
                  SUM(CASE WHEN json_extract(feedback_json, '$.is_correct') = 1
                            OR LOWER(json_extract(feedback_json, '$.is_correct')) IN ('true', 'yes', '1')
                       THEN 1 ELSE 0 END) as error_free
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
               SELECT date('now', '-' || (? - 1) || ' days')
               UNION ALL
               SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
           )
           SELECT
               dates.d AS date,
               COALESCE(conv.cnt, 0) AS conversations,
               COALESCE(msg.cnt, 0) AS messages,
               COALESCE(pron.cnt, 0) AS pronunciation_attempts,
               COALESCE(vocab.cnt, 0) AS vocabulary_reviews,
               COALESCE(sj.cnt, 0) AS speaking_journal_entries,
               COALESCE(lq.cnt, 0) AS listening_quizzes
           FROM dates
           LEFT JOIN (
               SELECT date(started_at) AS d, COUNT(*) AS cnt
               FROM conversations
               WHERE started_at >= date('now', '-' || (? - 1) || ' days')
               GROUP BY date(started_at)
           ) conv ON dates.d = conv.d
           LEFT JOIN (
               SELECT date(created_at) AS d, COUNT(*) AS cnt
               FROM messages WHERE role = 'user'
                 AND created_at >= date('now', '-' || (? - 1) || ' days')
               GROUP BY date(created_at)
           ) msg ON dates.d = msg.d
           LEFT JOIN (
               SELECT date(created_at) AS d, COUNT(*) AS cnt
               FROM pronunciation_attempts
               WHERE created_at >= date('now', '-' || (? - 1) || ' days')
               GROUP BY date(created_at)
           ) pron ON dates.d = pron.d
           LEFT JOIN (
               SELECT date(answered_at) AS d, COUNT(*) AS cnt
               FROM quiz_attempts
               WHERE answered_at >= date('now', '-' || (? - 1) || ' days')
               GROUP BY date(answered_at)
           ) vocab ON dates.d = vocab.d
           LEFT JOIN (
               SELECT date(created_at) AS d, COUNT(*) AS cnt
               FROM speaking_journal
               WHERE created_at >= date('now', '-' || (? - 1) || ' days')
               GROUP BY date(created_at)
           ) sj ON dates.d = sj.d
           LEFT JOIN (
               SELECT date(created_at) AS d, COUNT(*) AS cnt
               FROM listening_quiz_results
               WHERE created_at >= date('now', '-' || (? - 1) || ' days')
               GROUP BY date(created_at)
           ) lq ON dates.d = lq.d
           ORDER BY dates.d ASC""",
        (days, days, days, days, days, days, days),
    )
    return [
        {
            "date": r["date"],
            "conversations": r["conversations"],
            "messages": r["messages"],
            "pronunciation_attempts": r["pronunciation_attempts"],
            "vocabulary_reviews": r["vocabulary_reviews"],
            "speaking_journal_entries": r["speaking_journal_entries"],
            "listening_quizzes": r["listening_quizzes"],
        }
        for r in rows
    ]


_MILESTONES = [
    (7, "1 Week"),
    (14, "2 Weeks"),
    (30, "1 Month"),
    (60, "2 Months"),
    (90, "3 Months"),
]


async def get_streak_milestones(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get current streak with milestone achievements."""
    current_streak = await _calculate_streak(db)
    longest_streak = await _calculate_longest_streak(db)

    milestones = [
        {"days": days, "label": label, "achieved": current_streak >= days}
        for days, label in _MILESTONES
    ]

    next_milestone = None
    for days, label in _MILESTONES:
        if current_streak < days:
            next_milestone = {
                "days": days,
                "label": label,
                "days_remaining": days - current_streak,
            }
            break

    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "milestones": milestones,
        "next_milestone": next_milestone,
    }


async def _calculate_longest_streak(db: aiosqlite.Connection) -> int:
    """Find the longest consecutive streak in all activity history."""
    rows = await db.execute_fetchall("""
        SELECT DISTINCT date(created_at) as d FROM (
            SELECT created_at FROM messages WHERE role = 'user' AND created_at >= date('now', '-1095 days')
            UNION ALL
            SELECT created_at FROM pronunciation_attempts WHERE created_at >= date('now', '-1095 days')
            UNION ALL
            SELECT answered_at AS created_at FROM quiz_attempts WHERE answered_at >= date('now', '-1095 days')
            UNION ALL
            SELECT created_at FROM listening_quiz_results WHERE created_at >= date('now', '-1095 days')
            UNION ALL
            SELECT created_at FROM speaking_journal WHERE created_at >= date('now', '-1095 days')
        ) ORDER BY d ASC
    """)
    if not rows:
        return 0

    longest = 1
    current = 1
    prev_ord = None
    for r in rows:
        try:
            day_ord = date.fromisoformat(r["d"]).toordinal()
        except (ValueError, TypeError):
            continue
        if prev_ord is not None:
            if day_ord == prev_ord + 1:
                current += 1
                longest = max(longest, current)
            elif day_ord != prev_ord:
                current = 1
        prev_ord = day_ord
    return longest if prev_ord is not None else 0


async def get_conversation_duration_stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get aggregate conversation duration statistics."""
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) as total_completed,
                  COALESCE(SUM(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)), 0) as total_duration,
                  COALESCE(AVG(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)), 0) as avg_duration,
                  COALESCE(MIN(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)), 0) as shortest,
                  COALESCE(MAX(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)), 0) as longest
           FROM conversations
           WHERE status = 'ended' AND ended_at IS NOT NULL"""
    )
    row = dict(rows[0]) if rows else {}

    # Duration by difficulty
    diff_rows = await db.execute_fetchall(
        """SELECT difficulty,
                  COUNT(*) as count,
                  CAST(AVG(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)) AS INTEGER) as avg_duration
           FROM conversations
           WHERE status = 'ended' AND ended_at IS NOT NULL
           GROUP BY difficulty
           ORDER BY difficulty"""
    )

    return {
        "total_completed": row.get("total_completed", 0),
        "total_duration_seconds": row.get("total_duration", 0),
        "avg_duration_seconds": int(row.get("avg_duration", 0)),
        "shortest_duration_seconds": row.get("shortest", 0),
        "longest_duration_seconds": row.get("longest", 0),
        "duration_by_difficulty": [
            {"difficulty": r["difficulty"], "count": r["count"], "avg_duration_seconds": r["avg_duration"] or 0}
            for r in diff_rows
        ],
    }


async def get_learning_summary(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get a high-level learning summary with key metrics."""
    # Total study days
    rows = await db.execute_fetchall("""
        SELECT COUNT(DISTINCT date(created_at)) as study_days FROM (
            SELECT created_at FROM messages WHERE role = 'user'
            UNION ALL
            SELECT created_at FROM pronunciation_attempts
            UNION ALL
            SELECT answered_at AS created_at FROM quiz_attempts
            UNION ALL
            SELECT created_at FROM listening_quiz_results
            UNION ALL
            SELECT created_at FROM speaking_journal
        )
    """)
    study_days = rows[0]["study_days"] if rows else 0

    # Words known (level >= 1)
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE level >= 1"
    )
    words_learning = rows[0]["cnt"] if rows else 0

    # Total quiz attempts
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM quiz_attempts")
    total_quiz_attempts = rows[0]["cnt"] if rows else 0

    # Quiz accuracy
    rows = await db.execute_fetchall(
        "SELECT SUM(is_correct) as correct, COUNT(*) as total FROM quiz_attempts"
    )
    r = dict(rows[0]) if rows else {"correct": 0, "total": 0}
    quiz_accuracy = round((r["correct"] or 0) / r["total"] * 100, 1) if r["total"] else 0

    return {
        "total_study_days": study_days,
        "words_learning": words_learning,
        "total_quiz_attempts": total_quiz_attempts,
        "quiz_accuracy_percent": quiz_accuracy,
    }


async def get_learning_goals(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Get all learning goals with today's progress."""
    goals = await db.execute_fetchall(
        "SELECT id, goal_type, daily_target, created_at, updated_at FROM learning_goals"
    )
    today = await get_today_activity(db)
    result = []
    for g in goals:
        goal = dict(g)
        today_count = today.get(goal["goal_type"], 0)
        goal["today_count"] = today_count
        goal["completed"] = today_count >= goal["daily_target"]
        result.append(goal)
    return result


async def set_learning_goal(
    db: aiosqlite.Connection, goal_type: str, daily_target: int
) -> dict[str, Any]:
    """Set or update a daily learning goal."""
    await db.execute(
        """INSERT INTO learning_goals (goal_type, daily_target, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(goal_type) DO UPDATE SET daily_target = ?, updated_at = datetime('now')""",
        (goal_type, daily_target, daily_target),
    )
    await db.commit()
    rows = await db.execute_fetchall(
        "SELECT id, goal_type, daily_target, created_at, updated_at FROM learning_goals WHERE goal_type = ?",
        (goal_type,),
    )
    goal = dict(rows[0])
    today = await get_today_activity(db)
    today_count = today.get(goal_type, 0)
    goal["today_count"] = today_count
    goal["completed"] = today_count >= goal["daily_target"]
    return goal


async def delete_learning_goal(db: aiosqlite.Connection, goal_type: str) -> bool:
    """Delete a learning goal."""
    cursor = await db.execute(
        "DELETE FROM learning_goals WHERE goal_type = ?",
        (goal_type,),
    )
    await db.commit()
    return cursor.rowcount > 0


async def get_learning_insights(db: aiosqlite.Connection) -> dict[str, Any]:
    """Compute cross-module learning insights with personalized recommendations."""
    streak = await _calculate_streak(db)

    # Streak at risk: streak alive from yesterday but no activity today
    at_risk = False
    if streak > 0:
        today_rows = await db.execute_fetchall("""
            SELECT COUNT(*) as cnt FROM (
                SELECT 1 FROM messages
                    WHERE role = 'user' AND date(created_at) = date('now')
                UNION ALL
                SELECT 1 FROM pronunciation_attempts
                    WHERE date(created_at) = date('now')
                UNION ALL
                SELECT 1 FROM quiz_attempts
                    WHERE date(answered_at) = date('now')
                UNION ALL
                SELECT 1 FROM listening_quiz_results
                    WHERE date(created_at) = date('now')
                UNION ALL
                SELECT 1 FROM speaking_journal
                    WHERE date(created_at) = date('now')
            )
        """)
        if today_rows[0]["cnt"] == 0:
            at_risk = True

    # --- Module strengths (0-100) ---
    grammar = await get_grammar_stats(db)
    conversation_strength = grammar["grammar_accuracy"]

    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM vocabulary_progress")
    total_reviewed = rows[0]["cnt"]
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE level >= 3"
    )
    mastered = rows[0]["cnt"]
    vocabulary_strength = round(mastered / total_reviewed * 100, 1) if total_reviewed > 0 else 0.0

    rows = await db.execute_fetchall(
        "SELECT AVG(score) as avg_score FROM pronunciation_attempts WHERE score IS NOT NULL"
    )
    avg_score = rows[0]["avg_score"] or 0
    pronunciation_strength = round(avg_score * 10, 1)

    strengths = {
        "conversation": conversation_strength,
        "vocabulary": vocabulary_strength,
        "pronunciation": pronunciation_strength,
    }
    if any(v > 0 for v in strengths.values()):
        strongest_area = max(strengths, key=strengths.get)
        weakest_area = min(strengths, key=strengths.get)
        # When all strengths are equal, there's no meaningful distinction
        if strengths[strongest_area] == strengths[weakest_area]:
            strongest_area = None
            weakest_area = None
    else:
        strongest_area = None
        weakest_area = None

    # --- Recommendations ---
    recommendations: list[str] = []

    now_ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE next_review_at IS NULL OR next_review_at <= ?",
        (now_ts,),
    )
    vocab_due = rows[0]["cnt"]
    if vocab_due > 0:
        recommendations.append(f"You have {vocab_due} words due for review")

    if pronunciation_strength > 0 and pronunciation_strength < 50:
        recommendations.append("Try pronunciation retry suggestions to improve")

    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM conversations "
        "WHERE started_at >= datetime('now', '-7 days')"
    )
    if rows[0]["cnt"] == 0:
        total_convos = await db.execute_fetchall(
            "SELECT COUNT(*) as cnt FROM conversations"
        )
        if total_convos[0]["cnt"] > 0:
            recommendations.append("Practice a conversation to maintain skills")

    if at_risk:
        recommendations.append("Complete an activity today to keep your streak")

    # --- Weekly comparison ---
    weekly_comparison = await _get_weekly_comparison(db)

    return {
        "streak": streak,
        "streak_at_risk": at_risk,
        "module_strengths": strengths,
        "strongest_area": strongest_area,
        "weakest_area": weakest_area,
        "recommendations": recommendations,
        "weekly_comparison": weekly_comparison,
    }


async def _get_weekly_comparison(db: aiosqlite.Connection) -> dict[str, Any]:
    """Activity counts for this week vs last week per module."""
    queries = [
        ("conversations", """
            SELECT
                COALESCE(SUM(CASE WHEN date(started_at) >= date('now', '-6 days') THEN 1 ELSE 0 END), 0) as this_week,
                COALESCE(SUM(CASE WHEN date(started_at) < date('now', '-6 days') THEN 1 ELSE 0 END), 0) as last_week
            FROM conversations
            WHERE started_at >= date('now', '-13 days')
        """),
        ("vocabulary", """
            SELECT
                COALESCE(SUM(CASE WHEN date(answered_at) >= date('now', '-6 days') THEN 1 ELSE 0 END), 0) as this_week,
                COALESCE(SUM(CASE WHEN date(answered_at) < date('now', '-6 days') THEN 1 ELSE 0 END), 0) as last_week
            FROM quiz_attempts
            WHERE answered_at >= date('now', '-13 days')
        """),
        ("pronunciation", """
            SELECT
                COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-6 days') THEN 1 ELSE 0 END), 0) as this_week,
                COALESCE(SUM(CASE WHEN date(created_at) < date('now', '-6 days') THEN 1 ELSE 0 END), 0) as last_week
            FROM pronunciation_attempts
            WHERE created_at >= date('now', '-13 days')
        """),
        ("listening", """
            SELECT
                COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-6 days') THEN 1 ELSE 0 END), 0) as this_week,
                COALESCE(SUM(CASE WHEN date(created_at) < date('now', '-6 days') THEN 1 ELSE 0 END), 0) as last_week
            FROM listening_quiz_results
            WHERE created_at >= date('now', '-13 days')
        """),
        ("speaking_journal", """
            SELECT
                COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-6 days') THEN 1 ELSE 0 END), 0) as this_week,
                COALESCE(SUM(CASE WHEN date(created_at) < date('now', '-6 days') THEN 1 ELSE 0 END), 0) as last_week
            FROM speaking_journal
            WHERE created_at >= date('now', '-13 days')
        """),
    ]
    result = {}
    for module, query in queries:
        rows = await db.execute_fetchall(query)
        result[module] = {
            "this_week": rows[0]["this_week"] or 0,
            "last_week": rows[0]["last_week"] or 0,
        }
    return result


async def get_today_activity(db: aiosqlite.Connection) -> dict[str, int]:
    """Get today's activity counts across all modules in a single query."""
    rows = await db.execute_fetchall("""
        SELECT
            (SELECT COUNT(*) FROM conversations WHERE started_at >= date('now') AND started_at < date('now', '+1 day')) AS conversations,
            (SELECT COUNT(*) FROM quiz_attempts WHERE answered_at >= date('now') AND answered_at < date('now', '+1 day')) AS vocabulary_reviews,
            (SELECT COUNT(*) FROM pronunciation_attempts WHERE created_at >= date('now') AND created_at < date('now', '+1 day')) AS pronunciation_attempts,
            (SELECT COUNT(*) FROM listening_quiz_results WHERE created_at >= date('now') AND created_at < date('now', '+1 day')) AS listening_quizzes,
            (SELECT COUNT(*) FROM speaking_journal WHERE created_at >= date('now') AND created_at < date('now', '+1 day')) AS speaking_journal_entries
    """)
    row = rows[0] if rows else {}
    return {
        "conversations": row["conversations"] if row else 0,
        "vocabulary_reviews": row["vocabulary_reviews"] if row else 0,
        "pronunciation_attempts": row["pronunciation_attempts"] if row else 0,
        "listening_quizzes": row["listening_quizzes"] if row else 0,
        "speaking_journal_entries": row["speaking_journal_entries"] if row else 0,
    }


async def get_mistake_journal(
    db: aiosqlite.Connection,
    *,
    module: str = "all",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """Aggregate mistakes from grammar, pronunciation, and vocabulary modules."""
    import json as _json

    items: list[dict[str, Any]] = []

    # Grammar mistakes from messages with errors in feedback_json
    if module in ("all", "grammar"):
        grammar_rows = await db.execute_fetchall(
            """
            SELECT m.id, m.content, m.feedback_json, m.created_at, c.topic
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE m.role = 'user' AND m.feedback_json IS NOT NULL
            ORDER BY m.created_at DESC
            LIMIT 200
            """
        )
        for row in grammar_rows:
            try:
                fb = _json.loads(row["feedback_json"]) if isinstance(row["feedback_json"], str) else row["feedback_json"]
            except (TypeError, _json.JSONDecodeError):
                continue
            if not isinstance(fb, dict):
                continue
            errors = fb.get("errors", [])
            if not isinstance(errors, list) or not errors:
                continue
            for err in errors:
                if not isinstance(err, dict):
                    continue
                items.append({
                    "module": "grammar",
                    "detail": {
                        "original": err.get("original", ""),
                        "correction": err.get("correction", ""),
                        "explanation": err.get("explanation", ""),
                        "topic": row["topic"],
                    },
                    "created_at": row["created_at"],
                })

    # Pronunciation mistakes (low scores)
    if module in ("all", "pronunciation"):
        pron_rows = await db.execute_fetchall(
            """
            SELECT id, reference_text, user_transcription, score, created_at
            FROM pronunciation_attempts
            WHERE score IS NOT NULL AND score < 7.0
            ORDER BY created_at DESC
            LIMIT 100
            """
        )
        for row in pron_rows:
            items.append({
                "module": "pronunciation",
                "detail": {
                    "reference_text": row["reference_text"],
                    "user_transcription": row["user_transcription"],
                    "score": row["score"],
                },
                "created_at": row["created_at"],
            })

    # Vocabulary mistakes (incorrect quiz answers)
    if module in ("all", "vocabulary"):
        vocab_rows = await db.execute_fetchall(
            """
            SELECT qa.id, vw.word, vw.meaning, qa.answered_at
            FROM quiz_attempts qa
            JOIN vocabulary_words vw ON vw.id = qa.word_id
            WHERE qa.is_correct = 0
            ORDER BY qa.answered_at DESC
            LIMIT 100
            """
        )
        for row in vocab_rows:
            items.append({
                "module": "vocabulary",
                "detail": {
                    "word": row["word"],
                    "meaning": row["meaning"],
                },
                "created_at": row["answered_at"],
            })

    # Sort all items by timestamp descending
    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    total_count = len(items)
    paged = items[offset: offset + limit]

    return {"items": paged, "total_count": total_count}


# Achievement definitions: id, title, description, emoji, category, target
_ACHIEVEMENT_DEFS: list[dict[str, Any]] = [
    # Streak
    {"id": "streak_1", "title": "Getting Started", "description": "Study for 1 day", "emoji": "🌱", "category": "streak", "target": 1},
    {"id": "streak_7", "title": "Week Warrior", "description": "7-day study streak", "emoji": "🔥", "category": "streak", "target": 7},
    {"id": "streak_30", "title": "Monthly Master", "description": "30-day study streak", "emoji": "👑", "category": "streak", "target": 30},
    # Conversation
    {"id": "conv_1", "title": "First Chat", "description": "Complete 1 conversation", "emoji": "💬", "category": "conversation", "target": 1},
    {"id": "conv_10", "title": "Chatterbox", "description": "Complete 10 conversations", "emoji": "🗣️", "category": "conversation", "target": 10},
    {"id": "conv_25", "title": "Polyglot", "description": "Complete 25 conversations", "emoji": "🌍", "category": "conversation", "target": 25},
    # Vocabulary
    {"id": "vocab_1", "title": "Word Learner", "description": "Master 1 word", "emoji": "📖", "category": "vocabulary", "target": 1},
    {"id": "vocab_10", "title": "Vocab Builder", "description": "Master 10 words", "emoji": "📚", "category": "vocabulary", "target": 10},
    {"id": "vocab_50", "title": "Lexicon", "description": "Master 50 words", "emoji": "🏆", "category": "vocabulary", "target": 50},
    # Pronunciation
    {"id": "pron_1", "title": "First Try", "description": "Complete 1 pronunciation attempt", "emoji": "🎙️", "category": "pronunciation", "target": 1},
    {"id": "pron_25", "title": "Sound Scholar", "description": "Complete 25 pronunciation attempts", "emoji": "🎓", "category": "pronunciation", "target": 25},
    {"id": "pron_perfect", "title": "Perfect Score", "description": "Score 9.0+ on pronunciation", "emoji": "⭐", "category": "pronunciation", "target": 1},
    # General
    {"id": "all_rounder", "title": "All-Rounder", "description": "Use all 5 learning modules", "emoji": "🎯", "category": "general", "target": 5},
    {"id": "dedicated_10", "title": "Dedicated", "description": "Study for 10 different days", "emoji": "📅", "category": "general", "target": 10},
    {"id": "century", "title": "Century", "description": "Complete 100 total activities", "emoji": "💯", "category": "general", "target": 100},
]


async def get_achievements(db: aiosqlite.Connection) -> dict[str, Any]:
    """Compute achievements from existing learning data."""

    # Gather counts from existing tables - batched into 2 queries
    streak_rows = await db.execute_fetchall("""
        SELECT COUNT(DISTINCT date(created_at)) as days FROM (
            SELECT created_at FROM messages WHERE role = 'user'
            UNION ALL
            SELECT created_at FROM pronunciation_attempts
            UNION ALL
            SELECT answered_at AS created_at FROM quiz_attempts
            UNION ALL
            SELECT created_at FROM listening_quiz_results
            UNION ALL
            SELECT created_at FROM speaking_journal
        )
    """)
    study_days = streak_rows[0]["days"] if streak_rows else 0

    # Batch 7 COUNT queries into 1
    count_rows = await db.execute_fetchall("""
        SELECT
            (SELECT COUNT(*) FROM conversations WHERE ended_at IS NOT NULL) AS total_convs,
            (SELECT COUNT(*) FROM vocabulary_progress WHERE level >= 3) AS vocab_mastered,
            (SELECT COUNT(*) FROM pronunciation_attempts) AS total_pron,
            (SELECT COUNT(*) FROM pronunciation_attempts WHERE score >= 9.0) AS perfect_count,
            (SELECT COUNT(*) FROM quiz_attempts) AS total_quiz,
            (SELECT COUNT(*) FROM listening_quiz_results) AS total_listening,
            (SELECT COUNT(*) FROM speaking_journal) AS total_speaking
    """)
    cr = count_rows[0] if count_rows else {}
    total_convs = cr["total_convs"] if cr else 0
    vocab_mastered = cr["vocab_mastered"] if cr else 0
    total_pron = cr["total_pron"] if cr else 0
    perfect_count = cr["perfect_count"] if cr else 0
    total_quiz = cr["total_quiz"] if cr else 0
    total_listening = cr["total_listening"] if cr else 0
    total_speaking = cr["total_speaking"] if cr else 0

    # Modules used
    modules_used = sum([
        1 if total_convs > 0 else 0,
        1 if total_quiz > 0 else 0,
        1 if total_pron > 0 else 0,
        1 if total_listening > 0 else 0,
        1 if total_speaking > 0 else 0,
    ])

    total_activities = total_convs + total_quiz + total_pron + total_listening + total_speaking

    # Reuse canonical streak calculation
    streak = await _calculate_streak(db)

    # Map progress values
    progress_map: dict[str, int] = {
        "streak_1": streak, "streak_7": streak, "streak_30": streak,
        "conv_1": total_convs, "conv_10": total_convs, "conv_25": total_convs,
        "vocab_1": vocab_mastered, "vocab_10": vocab_mastered, "vocab_50": vocab_mastered,
        "pron_1": total_pron, "pron_25": total_pron,
        "pron_perfect": perfect_count,
        "all_rounder": modules_used,
        "dedicated_10": study_days,
        "century": total_activities,
    }

    achievements = []
    unlocked_count = 0
    for defn in _ACHIEVEMENT_DEFS:
        current = min(progress_map.get(defn["id"], 0), defn["target"])
        unlocked = current >= defn["target"]
        if unlocked:
            unlocked_count += 1
        achievements.append({
            **defn,
            "unlocked": unlocked,
            "progress": {"current": current, "target": defn["target"]},
        })

    return {
        "achievements": achievements,
        "unlocked_count": unlocked_count,
        "total_count": len(_ACHIEVEMENT_DEFS),
    }


async def get_weekly_report(db: aiosqlite.Connection) -> dict[str, Any]:
    """Generate a weekly progress report aggregating the past 7 days."""
    today = datetime.now(timezone.utc).date()
    week_start = today.isoformat()
    week_end = today.isoformat()

    # Conversations started this week
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM conversations WHERE started_at >= date('now', '-6 days')"
    )
    conversations = rows[0]["cnt"] if rows else 0

    # Messages sent by user this week
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM messages WHERE role = 'user' AND created_at >= date('now', '-6 days')"
    )
    messages_sent = rows[0]["cnt"] if rows else 0

    # Vocabulary words reviewed this week
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM quiz_attempts WHERE answered_at >= date('now', '-6 days')"
    )
    vocabulary_reviewed = rows[0]["cnt"] if rows else 0

    # Quiz accuracy this week
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as total, SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct "
        "FROM quiz_attempts WHERE answered_at >= date('now', '-6 days')"
    )
    quiz_total = rows[0]["total"] or 0
    quiz_correct = rows[0]["correct"] or 0
    quiz_accuracy = round((quiz_correct / quiz_total * 100) if quiz_total > 0 else 0, 1)

    # Pronunciation attempts and average score this week
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt, AVG(score) as avg_score FROM pronunciation_attempts "
        "WHERE created_at >= date('now', '-6 days') AND score IS NOT NULL"
    )
    pronunciation_attempts = rows[0]["cnt"] if rows else 0
    avg_pronunciation_score = round(rows[0]["avg_score"] or 0, 1)

    # Speaking journal entries this week
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt, AVG(wpm) as avg_wpm FROM speaking_journal "
        "WHERE created_at >= date('now', '-6 days')"
    )
    speaking_journal_entries = rows[0]["cnt"] if rows else 0
    speaking_journal_avg_wpm = round(rows[0]["avg_wpm"] or 0, 1)

    # Listening quizzes this week
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt, AVG(score) as avg_score FROM listening_quiz_results "
        "WHERE created_at >= date('now', '-6 days')"
    )
    listening_quizzes = rows[0]["cnt"] if rows else 0
    listening_avg_score = round(rows[0]["avg_score"] or 0, 1)

    # Grammar accuracy from feedback this week (weekly-scoped, not all-time)
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) as total_checked,
                  SUM(CASE WHEN json_extract(feedback_json, '$.is_correct') = 1
                            OR LOWER(json_extract(feedback_json, '$.is_correct')) IN ('true', 'yes', '1')
                       THEN 1 ELSE 0 END) as error_free
           FROM messages
           WHERE role = 'user' AND feedback_json IS NOT NULL
             AND created_at >= date('now', '-6 days')"""
    )
    grammar_total = rows[0]["total_checked"] or 0
    grammar_error_free = rows[0]["error_free"] or 0
    grammar_accuracy = round(grammar_error_free / grammar_total * 100, 1) if grammar_total > 0 else 0

    # Streak
    streak = await _calculate_streak(db)

    # Week-over-week comparison for highlights
    comparison = await _get_weekly_comparison(db)

    highlights: list[str] = []
    for module, data in comparison.items():
        this_w = data["this_week"]
        last_w = data["last_week"]
        if this_w > last_w and last_w > 0:
            pct = round((this_w - last_w) / last_w * 100)
            highlights.append(f"{module.capitalize()} up {pct}% vs last week!")
        elif this_w > 0 and last_w == 0:
            highlights.append(f"Started {module} practice this week!")

    if streak >= 7:
        highlights.append(f"{streak}-day streak — incredible dedication!")
    elif streak >= 3:
        highlights.append(f"{streak}-day streak — keep going!")

    if quiz_accuracy >= 90 and quiz_total >= 5:
        highlights.append(f"Quiz accuracy at {quiz_accuracy}% — excellent!")

    if speaking_journal_entries >= 3:
        highlights.append(f"Completed {speaking_journal_entries} speaking journal entries this week!")

    if listening_quizzes >= 3:
        highlights.append(f"Completed {listening_quizzes} listening quizzes this week!")

    # Build week date range string
    from datetime import timedelta
    week_start_date = today - timedelta(days=6)
    week_start = week_start_date.isoformat()
    week_end = today.isoformat()

    # Build text summary
    lines = [
        f"📊 Weekly Progress Report ({week_start} to {week_end})",
        "",
        f"🔥 Current Streak: {streak} days",
        f"💬 Conversations: {conversations} ({messages_sent} messages)",
        f"📚 Vocabulary Reviewed: {vocabulary_reviewed} words ({quiz_accuracy}% accuracy)",
        f"🎙️ Pronunciation: {pronunciation_attempts} attempts (avg {avg_pronunciation_score}/10)",
        f"📝 Grammar Accuracy: {grammar_accuracy}%",
        f"🗣️ Speaking Journal: {speaking_journal_entries} entries (avg {speaking_journal_avg_wpm} WPM)",
        f"👂 Listening Quizzes: {listening_quizzes} (avg {listening_avg_score}%)",
    ]
    if highlights:
        lines.append("")
        lines.append("✨ Highlights:")
        for h in highlights:
            lines.append(f"  • {h}")

    text_summary = "\n".join(lines)

    return {
        "week_start": week_start,
        "week_end": week_end,
        "conversations": conversations,
        "messages_sent": messages_sent,
        "vocabulary_reviewed": vocabulary_reviewed,
        "quiz_accuracy": quiz_accuracy,
        "pronunciation_attempts": pronunciation_attempts,
        "avg_pronunciation_score": avg_pronunciation_score,
        "grammar_accuracy": grammar_accuracy,
        "speaking_journal_entries": speaking_journal_entries,
        "speaking_journal_avg_wpm": speaking_journal_avg_wpm,
        "listening_quizzes": listening_quizzes,
        "listening_avg_score": listening_avg_score,
        "streak": streak,
        "highlights": highlights,
        "text_summary": text_summary,
    }


async def get_grammar_trend(db: aiosqlite.Connection, limit: int = 20) -> dict[str, Any]:
    """Get per-conversation grammar accuracy trend for completed conversations."""
    rows = await db.execute_fetchall(
        """SELECT c.id, c.topic, c.difficulty, c.started_at,
                  COUNT(*) as checked_count,
                  SUM(CASE WHEN json_extract(m.feedback_json, '$.is_correct') = 1
                            OR LOWER(json_extract(m.feedback_json, '$.is_correct')) IN ('true', 'yes', '1')
                       THEN 1 ELSE 0 END) as correct_count
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.role = 'user' AND m.feedback_json IS NOT NULL AND c.status = 'ended'
           GROUP BY c.id
           HAVING checked_count >= 1
           ORDER BY c.started_at DESC
           LIMIT ?""",
        (limit,),
    )
    conversations = []
    for r in rows:
        accuracy = round(r["correct_count"] / r["checked_count"] * 100, 1) if r["checked_count"] > 0 else 0
        conversations.append({
            "conversation_id": r["id"],
            "topic": r["topic"],
            "difficulty": r["difficulty"],
            "started_at": r["started_at"],
            "checked_count": r["checked_count"],
            "correct_count": r["correct_count"],
            "accuracy_rate": accuracy,
        })

    # Reverse to chronological order for trend display
    conversations.reverse()

    # Compute trend direction
    if len(conversations) < 3:
        trend = "insufficient_data"
    else:
        mid = len(conversations) // 2
        first_half_avg = sum(c["accuracy_rate"] for c in conversations[:mid]) / mid
        second_half_avg = sum(c["accuracy_rate"] for c in conversations[mid:]) / (len(conversations) - mid)
        diff = second_half_avg - first_half_avg
        if diff > 3:
            trend = "improving"
        elif diff < -3:
            trend = "declining"
        else:
            trend = "stable"

    return {"conversations": conversations, "trend": trend}


async def get_mistake_review_items(
    db: aiosqlite.Connection,
    *,
    count: int = 10,
) -> list[dict[str, Any]]:
    """Return grammar mistakes formatted as correction drill items for review practice."""
    import json as _json
    import random

    grammar_rows = await db.execute_fetchall(
        """
        SELECT m.content, m.feedback_json, m.created_at, c.topic
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.role = 'user' AND m.feedback_json IS NOT NULL
        ORDER BY m.created_at DESC
        LIMIT 500
        """
    )

    items: list[dict[str, Any]] = []
    for row in grammar_rows:
        try:
            fb = _json.loads(row["feedback_json"]) if isinstance(row["feedback_json"], str) else row["feedback_json"]
        except (TypeError, _json.JSONDecodeError):
            continue
        if not isinstance(fb, dict):
            continue
        errors = fb.get("errors", [])
        if not isinstance(errors, list):
            continue
        for err in errors:
            if not isinstance(err, dict):
                continue
            original = err.get("original", "").strip()
            correction = err.get("correction", "").strip()
            if not original or not correction:
                continue
            items.append({
                "original": original,
                "correction": correction,
                "explanation": err.get("explanation", ""),
                "topic": row["topic"],
                "created_at": row["created_at"],
            })

    if len(items) > count:
        items = random.sample(items, count)

    return items


async def get_confidence_trend(
    db: aiosqlite.Connection,
    *,
    limit: int = 20,
) -> dict[str, Any]:
    """Compute speaking confidence scores from ended conversations with performance data."""
    import json as _json

    rows = await db.execute_fetchall(
        """
        SELECT id, topic, difficulty, started_at, summary_json
        FROM conversations
        WHERE status = 'ended' AND summary_json IS NOT NULL
        ORDER BY started_at DESC
        LIMIT ?
        """,
        (limit,),
    )

    sessions: list[dict[str, Any]] = []
    for row in rows:
        try:
            summary = _json.loads(row["summary_json"]) if isinstance(row["summary_json"], str) else row["summary_json"]
        except (TypeError, _json.JSONDecodeError):
            continue
        if not isinstance(summary, dict):
            continue
        perf = summary.get("performance")
        if not isinstance(perf, dict):
            continue

        accuracy = float(perf.get("grammar_accuracy_rate", 0))
        diversity = float(perf.get("vocabulary_diversity", 0))
        avg_words = float(perf.get("avg_words_per_message", 0))
        total_msgs = int(perf.get("total_user_messages", 0))

        # Normalize sub-scores to 0-100
        grammar_score = min(accuracy, 100.0)
        diversity_score = min(diversity, 100.0)
        complexity_score = min(avg_words / 15.0 * 100, 100.0)
        participation_score = min(total_msgs / 10.0 * 100, 100.0)

        # Weighted composite
        composite = round(
            grammar_score * 0.4
            + diversity_score * 0.3
            + complexity_score * 0.2
            + participation_score * 0.1,
            1,
        )

        sessions.append({
            "conversation_id": row["id"],
            "topic": row["topic"],
            "difficulty": row["difficulty"],
            "started_at": row["started_at"],
            "score": composite,
            "grammar_score": round(grammar_score, 1),
            "diversity_score": round(diversity_score, 1),
            "complexity_score": round(complexity_score, 1),
            "participation_score": round(participation_score, 1),
        })

    # Reverse to chronological order
    sessions.reverse()

    # Compute trend
    if len(sessions) < 3:
        trend = "insufficient_data"
    else:
        mid = len(sessions) // 2
        first_avg = sum(s["score"] for s in sessions[:mid]) / mid
        second_avg = sum(s["score"] for s in sessions[mid:]) / (len(sessions) - mid)
        diff = second_avg - first_avg
        if diff > 3:
            trend = "improving"
        elif diff < -3:
            trend = "declining"
        else:
            trend = "stable"

    return {"sessions": sessions, "trend": trend}


async def get_daily_challenge(db: aiosqlite.Connection) -> dict[str, Any]:
    """Generate a deterministic daily challenge based on today's date and user's weakest area."""
    from hashlib import md5

    today = date.today().isoformat()
    activity = await get_today_activity(db)

    # Determine weakest module from recent activity
    insights = await get_learning_insights(db)
    strengths = insights.get("module_strengths", {})
    conv_str = strengths.get("conversation", 50)
    vocab_str = strengths.get("vocabulary", 50)
    pron_str = strengths.get("pronunciation", 50)

    # Bias toward weakest module using date hash
    day_hash = int(md5(today.encode()).hexdigest(), 16)
    modules = [
        ("conversation", conv_str),
        ("vocabulary", vocab_str),
        ("pronunciation", pron_str),
    ]
    modules.sort(key=lambda x: x[1])
    # 60% chance weakest, 30% middle, 10% strongest
    r = day_hash % 10
    if r < 6:
        chosen = modules[0][0]
    elif r < 9:
        chosen = modules[1][0]
    else:
        chosen = modules[2][0]

    # Pick a topic deterministically
    from app.config import load_config
    config = load_config()
    conv_topics = config.get("conversation_topics", [])
    topic_ids = [t["id"] for t in conv_topics]
    topic_labels = {t["id"]: t["label"] for t in conv_topics}
    selected_topic_idx = day_hash % len(topic_ids) if topic_ids else 0
    selected_topic = topic_ids[selected_topic_idx] if topic_ids else "hotel_checkin"
    topic_label = topic_labels.get(selected_topic, selected_topic)

    if chosen == "conversation":
        title = f"Have a conversation: {topic_label}"
        description = f"Start a conversation practice session about {topic_label} today."
        target = 1
        current = activity.get("conversations", 0)
        route = "/conversation"
    elif chosen == "vocabulary":
        title = "Review vocabulary words"
        description = "Complete at least 10 vocabulary quiz answers to reinforce your learning."
        target = 10
        current = activity.get("vocabulary_reviews", 0)
        route = "/vocabulary"
    else:
        title = "Practice pronunciation"
        description = "Complete 3 pronunciation attempts to improve your speaking."
        target = 3
        current = activity.get("pronunciation_attempts", 0)
        route = "/pronunciation"

    return {
        "challenge_type": chosen,
        "title": title,
        "description": description,
        "target_count": target,
        "current_count": min(current, target),
        "completed": current >= target,
        "route": route,
        "topic": selected_topic,
    }


async def get_word_of_the_day(db: aiosqlite.Connection) -> dict[str, Any] | None:
    """Select a deterministic word-of-the-day based on today's date."""
    from hashlib import md5

    rows = await db.execute_fetchall(
        "SELECT id, word, meaning, example_sentence, topic, difficulty FROM vocabulary_words ORDER BY id"
    )
    if not rows:
        return None

    today = date.today().isoformat()
    day_hash = int(md5(today.encode()).hexdigest(), 16)
    idx = day_hash % len(rows)
    row = rows[idx]

    return {
        "word_id": row["id"],
        "word": row["word"],
        "meaning": row["meaning"],
        "example_sentence": row["example_sentence"] or "",
        "topic": row["topic"],
        "difficulty": row["difficulty"],
    }


async def get_skill_radar(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Compute 5-axis skill scores (0-100) for radar chart."""
    # Speaking: based on conversation participation
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM conversations WHERE status = 'ended'"
    )
    conv_count = row[0]["cnt"] if row else 0
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM messages WHERE role = 'user'"
    )
    msg_count = row[0]["cnt"] if row else 0
    # Include speaking journal entries in Speaking score
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM speaking_journal"
    )
    sj_count = row[0]["cnt"] if row else 0
    speaking = min(100, int((conv_count * 5 + msg_count + sj_count * 3) / 2))

    # Listening: blend pronunciation attempts + listening quiz results
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt, AVG(CAST(json_extract(feedback_json, '$.overall_score') AS REAL)) as avg_s "
        "FROM pronunciation_attempts WHERE feedback_json IS NOT NULL"
    )
    pron_count = row[0]["cnt"] if row and row[0]["cnt"] else 0
    pron_avg = row[0]["avg_s"] if row and row[0]["avg_s"] else 0
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt, AVG(score) as avg_s FROM listening_quiz_results WHERE score IS NOT NULL"
    )
    quiz_listen_count = row[0]["cnt"] if row and row[0]["cnt"] else 0
    quiz_listen_avg = row[0]["avg_s"] if row and row[0]["avg_s"] else 0
    listening = min(100, int(
        (pron_count + quiz_listen_count) * 3 + (pron_avg * 2.5 + quiz_listen_avg * 2.5)
    ))

    # Vocabulary: mastery percentage
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as total, SUM(CASE WHEN level >= 3 THEN 1 ELSE 0 END) as mastered "
        "FROM vocabulary_progress"
    )
    vocab_total = row[0]["total"] if row and row[0]["total"] else 0
    vocab_mastered = row[0]["mastered"] if row and row[0]["mastered"] else 0
    vocabulary = int((vocab_mastered / vocab_total * 100) if vocab_total > 0 else 0)

    # Grammar: accuracy from feedback (handle both integer and string is_correct)
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as total, "
        "SUM(CASE WHEN json_extract(feedback_json, '$.is_correct') = 1 "
        "          OR LOWER(json_extract(feedback_json, '$.is_correct')) IN ('true', 'yes', '1') "
        "     THEN 1 ELSE 0 END) as correct "
        "FROM messages WHERE feedback_json IS NOT NULL AND role = 'user'"
    )
    grammar_total = row[0]["total"] if row and row[0]["total"] else 0
    grammar_correct = row[0]["correct"] if row and row[0]["correct"] else 0
    grammar = int((grammar_correct / grammar_total * 100) if grammar_total > 0 else 0)

    # Pronunciation: avg score * 10
    pronunciation = min(100, int(pron_avg * 10)) if pron_avg else 0

    return [
        {"name": "speaking", "score": speaking, "label": "Speaking"},
        {"name": "listening", "score": listening, "label": "Listening"},
        {"name": "vocabulary", "score": vocabulary, "label": "Vocabulary"},
        {"name": "grammar", "score": grammar, "label": "Grammar"},
        {"name": "pronunciation", "score": pronunciation, "label": "Pronunciation"},
    ]


ROUTE_MAP = {
    "conversation": "/conversation",
    "pronunciation": "/pronunciation",
    "vocabulary": "/vocabulary",
    "listening": "/listening",
    "speaking_journal": "/",
}


async def get_recent_activity(db: aiosqlite.Connection, limit: int = 5) -> list[dict[str, Any]]:
    """Get recent learning activity with navigation routes."""
    rows = await db.execute_fetchall("""
        SELECT type, detail, ts FROM (
            SELECT 'conversation' as type, topic as detail, started_at as ts FROM conversations ORDER BY started_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'pronunciation' as type, reference_text as detail, created_at as ts FROM pronunciation_attempts ORDER BY created_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'vocabulary' as type, vw.word as detail, qa.answered_at as ts
            FROM quiz_attempts qa
            JOIN vocabulary_words vw ON qa.word_id = vw.id
            ORDER BY qa.answered_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'listening' as type, title as detail, created_at as ts FROM listening_quiz_results ORDER BY created_at DESC LIMIT ?
        )
        UNION ALL
        SELECT type, detail, ts FROM (
            SELECT 'speaking_journal' as type, prompt as detail, created_at as ts FROM speaking_journal ORDER BY created_at DESC LIMIT ?
        )
        ORDER BY ts DESC LIMIT ?
    """, (limit, limit, limit, limit, limit, limit))
    return [
        {
            "type": r["type"],
            "detail": r["detail"][:60] if r["detail"] else r["type"],
            "timestamp": r["ts"],
            "route": ROUTE_MAP.get(r["type"], "/"),
        }
        for r in rows
    ]


async def get_session_analytics(db: aiosqlite.Connection, days: int = 7) -> dict[str, Any]:
    """Compute time spent per exercise module over the given number of days."""
    from_date = (date.today() - timedelta(days=days)).isoformat()

    # Conversation time from started_at/ended_at
    conv_rows = await db.execute_fetchall(
        """
        SELECT DATE(started_at) as day,
               SUM(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)) as secs,
               COUNT(*) as cnt
        FROM conversations
        WHERE status = 'ended' AND ended_at IS NOT NULL
          AND DATE(started_at) >= ?
        GROUP BY DATE(started_at)
        ORDER BY day
        """,
        (from_date,),
    )

    # Pronunciation: count attempts per day, estimate 2 min each
    pron_rows = await db.execute_fetchall(
        """
        SELECT DATE(created_at) as day,
               COUNT(*) as cnt
        FROM pronunciation_attempts
        WHERE DATE(created_at) >= ?
        GROUP BY DATE(created_at)
        ORDER BY day
        """,
        (from_date,),
    )

    # Vocabulary: count quiz attempts per day, estimate 30 sec each
    vocab_rows = await db.execute_fetchall(
        """
        SELECT DATE(answered_at) as day,
               COUNT(*) as cnt
        FROM quiz_attempts
        WHERE DATE(answered_at) >= ?
        GROUP BY DATE(answered_at)
        ORDER BY day
        """,
        (from_date,),
    )

    # Listening quiz: estimate 5 min per quiz session
    listen_rows = await db.execute_fetchall(
        """
        SELECT DATE(created_at) as day,
               COUNT(*) as cnt
        FROM listening_quiz_results
        WHERE DATE(created_at) >= ?
        GROUP BY DATE(created_at)
        ORDER BY day
        """,
        (from_date,),
    )

    # Speaking journal: use actual duration_seconds
    speak_rows = await db.execute_fetchall(
        """
        SELECT DATE(created_at) as day,
               SUM(COALESCE(duration_seconds, 0)) as secs,
               COUNT(*) as cnt
        FROM speaking_journal
        WHERE DATE(created_at) >= ?
        GROUP BY DATE(created_at)
        ORDER BY day
        """,
        (from_date,),
    )

    defaults = {"conversation": 0, "pronunciation": 0, "vocabulary": 0, "listening": 0, "speaking_journal": 0}

    # Build per-day breakdown
    daily: dict[str, dict[str, int]] = {}
    conv_total_secs = 0
    conv_total_cnt = 0
    for r in conv_rows:
        d = r["day"]
        s = max(r["secs"] or 0, 0)
        daily.setdefault(d, {**defaults})
        daily[d]["conversation"] = s
        conv_total_secs += s
        conv_total_cnt += r["cnt"]

    pron_total_secs = 0
    pron_total_cnt = 0
    for r in pron_rows:
        d = r["day"]
        s = r["cnt"] * 120  # 2 min per attempt
        daily.setdefault(d, {**defaults})
        daily[d]["pronunciation"] = s
        pron_total_secs += s
        pron_total_cnt += r["cnt"]

    vocab_total_secs = 0
    vocab_total_cnt = 0
    for r in vocab_rows:
        d = r["day"]
        s = r["cnt"] * 30  # 30 sec per attempt
        daily.setdefault(d, {**defaults})
        daily[d]["vocabulary"] = s
        vocab_total_secs += s
        vocab_total_cnt += r["cnt"]

    listen_total_secs = 0
    listen_total_cnt = 0
    for r in listen_rows:
        d = r["day"]
        s = r["cnt"] * 300  # 5 min per quiz session
        daily.setdefault(d, {**defaults})
        daily[d]["listening"] = s
        listen_total_secs += s
        listen_total_cnt += r["cnt"]

    speak_total_secs = 0
    speak_total_cnt = 0
    for r in speak_rows:
        d = r["day"]
        s = max(r["secs"] or 0, 0)
        daily.setdefault(d, {**defaults})
        daily[d]["speaking_journal"] = s
        speak_total_secs += s
        speak_total_cnt += r["cnt"]

    modules = [
        {"module": "conversation", "total_seconds": conv_total_secs, "session_count": conv_total_cnt},
        {"module": "pronunciation", "total_seconds": pron_total_secs, "session_count": pron_total_cnt},
        {"module": "vocabulary", "total_seconds": vocab_total_secs, "session_count": vocab_total_cnt},
        {"module": "listening", "total_seconds": listen_total_secs, "session_count": listen_total_cnt},
        {"module": "speaking_journal", "total_seconds": speak_total_secs, "session_count": speak_total_cnt},
    ]

    daily_list = [
        {
            "date": d,
            "conversation_seconds": v["conversation"],
            "pronunciation_seconds": v["pronunciation"],
            "vocabulary_seconds": v["vocabulary"],
            "listening_seconds": v["listening"],
            "speaking_journal_seconds": v["speaking_journal"],
        }
        for d, v in sorted(daily.items())
    ]

    return {"modules": modules, "daily": daily_list}


async def get_listening_progress(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get listening quiz progress stats."""
    db.row_factory = aiosqlite.Row

    # Overall stats
    row = await db.execute_fetchall(
        """SELECT COUNT(*) as total, COALESCE(AVG(score), 0) as avg_score,
                  COALESCE(MAX(score), 0) as best_score
           FROM listening_quiz_results"""
    )
    r = row[0]
    total_quizzes = r["total"]
    avg_score = round(float(r["avg_score"]), 1)
    best_score = round(float(r["best_score"]), 1)

    # By difficulty breakdown
    diff_rows = await db.execute_fetchall(
        """SELECT difficulty, COUNT(*) as count, COALESCE(AVG(score), 0) as avg_score
           FROM listening_quiz_results
           GROUP BY difficulty
           ORDER BY difficulty"""
    )
    by_difficulty = [
        {
            "difficulty": dr["difficulty"],
            "count": dr["count"],
            "avg_score": round(float(dr["avg_score"]), 1),
        }
        for dr in diff_rows
    ]

    # Score trend (compare last 5 to previous 5)
    recent_rows = await db.execute_fetchall(
        """SELECT score FROM listening_quiz_results
           ORDER BY created_at DESC LIMIT 10"""
    )
    scores = [float(r["score"]) for r in recent_rows]
    if len(scores) >= 6:
        recent_avg = sum(scores[:5]) / 5
        older_avg = sum(scores[5:]) / len(scores[5:])
        if recent_avg > older_avg + 5:
            trend = "improving"
        elif recent_avg < older_avg - 5:
            trend = "declining"
        else:
            trend = "stable"
    else:
        trend = "insufficient_data"

    # By topic breakdown
    topic_rows = await db.execute_fetchall(
        """SELECT topic, COUNT(*) as count, COALESCE(AVG(score), 0) as avg_score
           FROM listening_quiz_results
           WHERE topic != ''
           GROUP BY topic
           ORDER BY avg_score ASC"""
    )
    by_topic = [
        {
            "topic": tr["topic"],
            "count": tr["count"],
            "avg_score": round(float(tr["avg_score"]), 1),
        }
        for tr in topic_rows
    ]

    return {
        "total_quizzes": total_quizzes,
        "avg_score": avg_score,
        "best_score": best_score,
        "by_difficulty": by_difficulty,
        "by_topic": by_topic,
        "trend": trend,
    }


async def _calculate_module_streak(db: aiosqlite.Connection, query: str) -> tuple[int, str | None]:
    """Calculate streak for a single module. Returns (streak, last_active_date)."""
    rows = await db.execute_fetchall(query)
    if not rows:
        return 0, None

    today = datetime.now(timezone.utc).date()
    try:
        most_recent = date.fromisoformat(rows[0]["d"])
    except (ValueError, TypeError):
        return 0, None

    last_active = most_recent.isoformat()
    gap = today.toordinal() - most_recent.toordinal()
    if gap > 1:
        return 0, last_active

    streak = 0
    start_ordinal = most_recent.toordinal()
    for i, r in enumerate(rows):
        try:
            day = date.fromisoformat(r["d"])
        except (ValueError, TypeError):
            break
        if day.toordinal() == start_ordinal - i:
            streak += 1
        else:
            break
    return streak, last_active


async def get_module_streaks(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get per-module study streak breakdown."""
    modules = {
        "conversation": """
            SELECT DISTINCT date(created_at) as d FROM messages
            WHERE role = 'user' AND created_at >= date('now', '-366 days')
            ORDER BY d DESC
        """,
        "vocabulary": """
            SELECT DISTINCT date(answered_at) as d FROM quiz_attempts
            WHERE answered_at >= date('now', '-366 days')
            ORDER BY d DESC
        """,
        "pronunciation": """
            SELECT DISTINCT date(created_at) as d FROM pronunciation_attempts
            WHERE created_at >= date('now', '-366 days')
            ORDER BY d DESC
        """,
        "listening": """
            SELECT DISTINCT date(created_at) as d FROM listening_quiz_results
            WHERE created_at >= date('now', '-366 days')
            ORDER BY d DESC
        """,
        "speaking_journal": """
            SELECT DISTINCT date(created_at) as d FROM speaking_journal
            WHERE created_at >= date('now', '-366 days')
            ORDER BY d DESC
        """,
    }

    overall_streak = await _calculate_streak(db)
    results: dict[str, dict[str, Any]] = {}
    for module_name, query in modules.items():
        streak, last_active = await _calculate_module_streak(db, query)
        results[module_name] = {
            "current_streak": streak,
            "last_active": last_active,
        }

    streaks = {k: v["current_streak"] for k, v in results.items()}
    active_modules = {k: v for k, v in streaks.items() if v > 0}

    most_consistent = max(active_modules, key=active_modules.get) if active_modules else None
    least_consistent = min(streaks, key=streaks.get) if streaks else None

    return {
        "overall_streak": overall_streak,
        "modules": results,
        "most_consistent": most_consistent,
        "least_consistent": least_consistent,
    }


async def get_learning_velocity(
    db: aiosqlite.Connection, *, weeks: int = 8
) -> dict[str, Any]:
    """Return learning velocity analytics with weekly pace tracking."""
    cutoff = f"-{weeks * 7} days"

    # Weekly counts per activity type — use parameterized queries
    queries: dict[str, tuple[str, tuple[str]]] = {
        "new_words": ("""
            SELECT strftime('%Y-W%W', last_reviewed) AS week, COUNT(DISTINCT word_id) AS cnt
            FROM vocabulary_progress
            WHERE last_reviewed IS NOT NULL
              AND last_reviewed >= date('now', ?)
            GROUP BY week ORDER BY week
        """, (cutoff,)),
        "quiz_attempts": ("""
            SELECT strftime('%Y-W%W', answered_at) AS week, COUNT(*) AS cnt
            FROM quiz_attempts
            WHERE answered_at >= date('now', ?)
            GROUP BY week ORDER BY week
        """, (cutoff,)),
        "conversations": ("""
            SELECT strftime('%Y-W%W', started_at) AS week, COUNT(*) AS cnt
            FROM conversations
            WHERE started_at >= date('now', ?)
            GROUP BY week ORDER BY week
        """, (cutoff,)),
        "pronunciation_attempts": ("""
            SELECT strftime('%Y-W%W', created_at) AS week, COUNT(*) AS cnt
            FROM pronunciation_attempts
            WHERE created_at >= date('now', ?)
            GROUP BY week ORDER BY week
        """, (cutoff,)),
    }

    per_activity: dict[str, dict[str, int]] = {}
    for key, (sql, params) in queries.items():
        rows = await db.execute_fetchall(sql, params)
        for row in rows:
            week_label = row["week"]
            per_activity.setdefault(week_label, {})[key] = row["cnt"]

    all_weeks = sorted(per_activity.keys())
    weekly_data: list[dict[str, Any]] = []
    for w in all_weeks:
        entry = per_activity[w]
        weekly_data.append(
            {
                "week": w,
                "new_words": entry.get("new_words", 0),
                "quiz_attempts": entry.get("quiz_attempts", 0),
                "conversations": entry.get("conversations", 0),
                "pronunciation_attempts": entry.get("pronunciation_attempts", 0),
            }
        )

    # --- Trend: compare recent 4 weeks vs prior 4 weeks ---
    def _week_total(entry: dict[str, Any]) -> int:
        return (
            entry["new_words"]
            + entry["quiz_attempts"]
            + entry["conversations"]
            + entry["pronunciation_attempts"]
        )

    if len(weekly_data) < 4:
        trend = "insufficient_data"
    else:
        recent = weekly_data[-4:]
        prior = weekly_data[-8:-4] if len(weekly_data) >= 8 else weekly_data[: len(weekly_data) - 4]
        if not prior:
            trend = "insufficient_data"
        else:
            recent_sum = sum(_week_total(e) for e in recent)
            prior_sum = sum(_week_total(e) for e in prior)
            if prior_sum == 0:
                trend = "accelerating" if recent_sum > 0 else "steady"
            elif recent_sum > prior_sum * 1.15:
                trend = "accelerating"
            elif recent_sum < prior_sum * 0.85:
                trend = "decelerating"
            else:
                trend = "steady"

    # --- Current pace: rolling 7-day averages ---
    pace_queries: dict[str, str] = {
        "words_per_day": """
            SELECT COUNT(DISTINCT word_id) AS cnt
            FROM vocabulary_progress
            WHERE last_reviewed IS NOT NULL
              AND last_reviewed >= date('now', '-7 days')
        """,
        "quizzes_per_day": """
            SELECT COUNT(*) AS cnt FROM quiz_attempts
            WHERE answered_at >= date('now', '-7 days')
        """,
        "conversations_per_day": """
            SELECT COUNT(*) AS cnt FROM conversations
            WHERE started_at >= date('now', '-7 days')
        """,
        "pronunciation_per_day": """
            SELECT COUNT(*) AS cnt FROM pronunciation_attempts
            WHERE created_at >= date('now', '-7 days')
        """,
    }
    current_pace: dict[str, float] = {}
    for key, sql in pace_queries.items():
        row = await db.execute_fetchall(sql)
        current_pace[key] = round(row[0]["cnt"] / 7.0, 1) if row else 0

    # --- Total active days: distinct dates across all tables ---
    active_days_sql = """
        SELECT COUNT(*) AS cnt FROM (
            SELECT DISTINCT date(last_reviewed) AS d FROM vocabulary_progress
                WHERE last_reviewed IS NOT NULL
            UNION
            SELECT DISTINCT date(answered_at) FROM quiz_attempts
            UNION
            SELECT DISTINCT date(started_at) FROM conversations
            UNION
            SELECT DISTINCT date(created_at) FROM pronunciation_attempts
        )
    """
    rows = await db.execute_fetchall(active_days_sql)
    total_active_days: int = rows[0]["cnt"] if rows else 0

    # --- Words per study day ---
    total_words_sql = "SELECT COUNT(DISTINCT word_id) AS cnt FROM vocabulary_progress WHERE last_reviewed IS NOT NULL"
    rows = await db.execute_fetchall(total_words_sql)
    total_words = rows[0]["cnt"] if rows else 0
    words_per_study_day = round(total_words / total_active_days, 1) if total_active_days > 0 else 0

    return {
        "weekly_data": weekly_data,
        "current_pace": current_pace,
        "trend": trend,
        "total_active_days": total_active_days,
        "words_per_study_day": words_per_study_day,
    }


# ---------------------------------------------------------------------------
# Grammar weak-spots analysis
# ---------------------------------------------------------------------------

_CATEGORY_KEYWORDS: list[tuple[str, list[str]]] = [
    ("Subject-Verb Agreement", ["subject", "verb agreement", "subject-verb"]),
    ("Verb Tenses", ["tense", "past tense", "present tense", "future tense", "verb form"]),
    ("Articles", ["article", " a ", " an ", " the ", "determiner"]),
    ("Prepositions", ["preposition", "prepositional"]),
    ("Word Order", ["word order", "syntax", "sentence structure", "inverted"]),
    ("Plurals", ["plural", "singular", "countable", "uncountable"]),
    ("Pronouns", ["pronoun", "possessive pronoun"]),
    ("Spelling", ["spelling", "misspell", "typo"]),
    ("Punctuation", ["punctuation", "comma", "period", "apostrophe"]),
    ("Vocabulary Choice", ["word choice", "vocabulary", "collocation", "wrong word"]),
]


def _categorize_error(explanation: str) -> str:
    """Map a grammar error explanation to a category via keyword matching."""
    lower = explanation.lower()
    for category, keywords in _CATEGORY_KEYWORDS:
        for kw in keywords:
            if kw in lower:
                return category
    return "Other"


async def get_grammar_weak_spots(
    db: aiosqlite.Connection, *, limit: int = 10
) -> dict[str, Any]:
    """Analyse grammar errors by category with recent-vs-older trend."""
    rows = await db.execute_fetchall(
        """
        SELECT m.feedback_json, m.created_at
        FROM messages m
        WHERE m.role = 'user' AND m.feedback_json IS NOT NULL
        ORDER BY m.created_at DESC
        LIMIT 500
        """
    )

    import json as _json
    from collections import Counter
    from datetime import datetime, timedelta, timezone

    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()

    recent_counts: Counter[str] = Counter()
    older_counts: Counter[str] = Counter()
    total_errors = 0

    for row in rows:
        try:
            fb = _json.loads(row["feedback_json"]) if isinstance(row["feedback_json"], str) else row["feedback_json"]
        except (TypeError, _json.JSONDecodeError):
            continue
        if not isinstance(fb, dict):
            continue
        errors = fb.get("errors", [])
        if not isinstance(errors, list):
            continue
        for err in errors:
            if not isinstance(err, dict):
                continue
            explanation = err.get("explanation", "")
            if not explanation:
                continue
            category = _categorize_error(explanation)
            total_errors += 1
            created = row["created_at"] or ""
            if created >= cutoff:
                recent_counts[category] += 1
            else:
                older_counts[category] += 1

    all_categories = set(recent_counts.keys()) | set(older_counts.keys())
    category_list: list[dict[str, Any]] = []
    for cat in all_categories:
        recent = recent_counts.get(cat, 0)
        older = older_counts.get(cat, 0)
        total = recent + older
        if older == 0:
            trend = "new"
        elif recent < older * 0.7:
            trend = "improving"
        elif recent > older * 1.3:
            trend = "declining"
        else:
            trend = "stable"
        category_list.append({
            "name": cat,
            "total_count": total,
            "recent_count": recent,
            "older_count": older,
            "trend": trend,
        })

    category_list.sort(key=lambda c: c["total_count"], reverse=True)
    category_list = category_list[:limit]

    most_common = category_list[0]["name"] if category_list else None

    return {
        "categories": category_list,
        "total_errors": total_errors,
        "category_count": len(all_categories),
        "most_common_category": most_common,
    }


# ---------------------------------------------------------------------------
# Vocabulary retention forecast
# ---------------------------------------------------------------------------

_SM2_INTERVALS = [0, 1, 3, 7, 14, 30, 60]


async def get_vocabulary_forecast(
    db: aiosqlite.Connection, *, limit: int = 20
) -> dict[str, Any]:
    """Predict vocabulary retention risk per word and return at-risk words."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    rows = await db.execute_fetchall(
        """
        SELECT vp.word_id, vw.word, vw.meaning, vw.topic,
               vp.level, vp.correct_count, vp.incorrect_count,
               vp.last_reviewed, vp.next_review_at
        FROM vocabulary_progress vp
        JOIN vocabulary_words vw ON vw.id = vp.word_id
        WHERE vp.last_reviewed IS NOT NULL
        """
    )

    # Get quiz attempt accuracy per word
    quiz_rows = await db.execute_fetchall(
        """
        SELECT word_id,
               SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
               COUNT(*) AS total
        FROM quiz_attempts
        GROUP BY word_id
        """
    )
    quiz_map: dict[int, tuple[int, int]] = {
        r["word_id"]: (r["correct"], r["total"]) for r in quiz_rows
    }

    at_risk: list[dict[str, Any]] = []
    total_reviewed = len(rows)
    overdue_count = 0

    for row in rows:
        word_id = row["word_id"]
        level = max(0, min(row["level"], len(_SM2_INTERVALS) - 1))
        expected_interval = max(_SM2_INTERVALS[level], 1)

        # Overdue ratio
        next_review = row["next_review_at"] or today
        try:
            next_dt = datetime.fromisoformat(next_review.replace("Z", "+00:00"))
            if next_dt.tzinfo is None:
                next_dt = next_dt.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            next_dt = now
        days_overdue = (now - next_dt).days
        if days_overdue > 0:
            overdue_count += 1
        overdue_ratio = max(days_overdue, 0) / expected_interval

        # Error rate from quiz attempts
        quiz_data = quiz_map.get(word_id)
        if quiz_data:
            correct, total = quiz_data
            error_rate = (total - correct) / total if total > 0 else 0
        else:
            error_rate = 0.5  # unknown = moderate risk

        # Level fragility (lower level = higher fragility)
        max_level = len(_SM2_INTERVALS) - 1
        level_fragility = 1.0 - (level / max_level) if max_level > 0 else 1.0

        # Composite risk score (0-100)
        risk = min(100, round(
            (overdue_ratio * 0.4 + error_rate * 0.35 + level_fragility * 0.25) * 100
        ))

        at_risk.append({
            "word_id": word_id,
            "word": row["word"],
            "meaning": row["meaning"],
            "topic": row["topic"],
            "level": level,
            "risk_score": risk,
            "days_overdue": max(days_overdue, 0),
            "error_rate": round(error_rate, 2),
        })

    at_risk.sort(key=lambda w: w["risk_score"], reverse=True)
    at_risk = at_risk[:limit]

    avg_retention = round(
        100 - (sum(w["risk_score"] for w in at_risk) / len(at_risk))
        if at_risk else 100,
        1,
    )
    at_risk_count = sum(1 for w in at_risk if w["risk_score"] >= 50)
    recommended = min(max(overdue_count, at_risk_count, 5), 20)

    return {
        "at_risk_words": at_risk,
        "total_reviewed": total_reviewed,
        "at_risk_count": at_risk_count,
        "overdue_count": overdue_count,
        "avg_retention_score": avg_retention,
        "recommended_review_count": recommended,
    }


async def get_phrase_of_the_day(db: aiosqlite.Connection) -> dict[str, Any] | None:
    """Select a deterministic phrase-of-the-day from past AI conversation messages."""
    from hashlib import md5

    # Try assistant messages from completed conversations first
    rows = await db.execute_fetchall(
        """
        SELECT m.content, c.topic
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.role = 'assistant' AND c.status = 'ended'
        ORDER BY m.id
        """
    )

    phrases: list[tuple[str, str]] = []
    for row in rows:
        content = row["content"] or ""
        topic = row["topic"] or "general"
        for sentence in content.replace("!", ".").replace("?", ".").split("."):
            s = sentence.strip()
            if 20 <= len(s) <= 80 and not s.startswith("*"):
                phrases.append((s, topic))

    # Fallback to vocabulary example sentences
    if not phrases:
        vocab_rows = await db.execute_fetchall(
            "SELECT example_sentence, topic FROM vocabulary_words WHERE example_sentence IS NOT NULL AND LENGTH(example_sentence) BETWEEN 20 AND 80 ORDER BY id"
        )
        for vr in vocab_rows:
            phrases.append((vr["example_sentence"], vr["topic"] or "general"))

    if not phrases:
        return None

    today = date.today().isoformat()
    day_hash = int(md5(("phrase:" + today).encode()).hexdigest(), 16)
    idx = day_hash % len(phrases)
    phrase, topic = phrases[idx]

    return {
        "phrase": phrase,
        "topic": topic,
        "source": "conversation" if rows else "vocabulary",
    }


async def get_vocabulary_activation(
    db: aiosqlite.Connection, limit: int = 20
) -> dict[str, Any]:
    """Analyze how many studied vocabulary words appear in user conversation messages."""

    # Get all studied words (have progress records)
    studied_rows = await db.execute_fetchall(
        """
        SELECT vw.id, vw.word, vw.meaning, vw.topic
        FROM vocabulary_words vw
        INNER JOIN vocabulary_progress vp ON vp.word_id = vw.id
        ORDER BY vw.word
        """
    )

    if not studied_rows:
        return {
            "total_studied": 0,
            "total_activated": 0,
            "activation_rate": 0.0,
            "activated_words": [],
            "unactivated_words": [],
            "by_topic": [],
        }

    # Get all user messages
    user_messages = await db.execute_fetchall(
        "SELECT content, created_at FROM messages WHERE role = 'user' ORDER BY created_at DESC"
    )

    # Pre-process messages: lowercase once, pad for word-boundary matching
    prepared_msgs = [
        {"content_padded": f" {(msg['content'] or '').lower()} ", "created_at": msg["created_at"]}
        for msg in user_messages
    ]
    # Build a single corpus string for fast O(1) amortized rejection
    corpus = " ".join(m["content_padded"] for m in prepared_msgs)

    # Check each studied word for occurrences in user messages
    activated: list[dict[str, Any]] = []
    unactivated: list[dict[str, Any]] = []
    topic_stats: dict[str, dict[str, int]] = {}

    for row in studied_rows:
        word = row["word"].lower()
        topic = row["topic"] or "general"

        if topic not in topic_stats:
            topic_stats[topic] = {"studied": 0, "activated": 0}
        topic_stats[topic]["studied"] += 1

        times_used = 0
        last_used_at: str | None = None
        word_padded = f" {word} "
        # Quick corpus check: skip per-message scan if word not in any message
        if word_padded in corpus:
            for msg in prepared_msgs:
                if word_padded in msg["content_padded"]:
                    times_used += 1
                    if last_used_at is None:
                        last_used_at = msg["created_at"]

        entry = {
            "word_id": row["id"],
            "word": row["word"],
            "meaning": row["meaning"],
            "topic": topic,
            "times_used": times_used,
            "last_used_at": last_used_at,
        }

        if times_used > 0:
            activated.append(entry)
            topic_stats[topic]["activated"] += 1
        else:
            unactivated.append(entry)

    total_studied = len(studied_rows)
    total_activated = len(activated)
    activation_rate = round(
        (total_activated / total_studied * 100) if total_studied > 0 else 0.0, 1
    )

    # Sort activated by times_used desc, unactivated by word
    activated.sort(key=lambda x: x["times_used"], reverse=True)

    by_topic = [
        {
            "topic": t,
            "studied": s["studied"],
            "activated": s["activated"],
            "rate": round(s["activated"] / s["studied"] * 100, 1) if s["studied"] else 0.0,
        }
        for t, s in sorted(topic_stats.items())
    ]

    return {
        "total_studied": total_studied,
        "total_activated": total_activated,
        "activation_rate": activation_rate,
        "activated_words": activated[:limit],
        "unactivated_words": unactivated[:limit],
        "by_topic": by_topic,
    }


async def get_topic_coverage(db: aiosqlite.Connection) -> dict:
    """Get conversation topic coverage with practice counts and accuracy."""
    from app.config import get_conversation_topics

    topics = get_conversation_topics()
    topic_map = {t["id"]: t for t in topics}

    # Get practice counts and last practiced per topic
    rows = await db.execute_fetchall(
        """
        SELECT
            topic,
            COUNT(*) as practice_count,
            MAX(started_at) as last_practiced_at
        FROM conversations
        WHERE status IN ('active', 'ended')
        GROUP BY topic
        """
    )
    practice_data: dict = {}
    for row in rows:
        practice_data[row["topic"]] = {
            "practice_count": row["practice_count"],
            "last_practiced_at": row["last_practiced_at"],
        }

    # Get grammar accuracy per topic from summary_json
    accuracy_rows = await db.execute_fetchall(
        """
        SELECT
            topic,
            AVG(
                CASE
                    WHEN json_extract(summary_json, '$.performance.grammar_accuracy_rate') IS NOT NULL
                    THEN CAST(json_extract(summary_json, '$.performance.grammar_accuracy_rate') AS REAL)
                    ELSE NULL
                END
            ) as avg_accuracy
        FROM conversations
        WHERE status IN ('active', 'ended') AND summary_json IS NOT NULL
        GROUP BY topic
        """
    )
    accuracy_map: dict = {}
    for row in accuracy_rows:
        if row["avg_accuracy"] is not None:
            accuracy_map[row["topic"]] = round(row["avg_accuracy"], 1)

    # Build coverage items
    items = []
    for topic in topics:
        tid = topic["id"]
        pd = practice_data.get(tid, {})
        items.append({
            "topic_id": tid,
            "label": topic["label"],
            "description": topic.get("description", ""),
            "practice_count": pd.get("practice_count", 0),
            "last_practiced_at": pd.get("last_practiced_at"),
            "grammar_accuracy": accuracy_map.get(tid),
        })

    total_topics = len(topics)
    practiced_count = sum(1 for i in items if i["practice_count"] > 0)
    coverage_rate = round(practiced_count / total_topics * 100, 1) if total_topics > 0 else 0.0

    return {
        "total_topics": total_topics,
        "practiced_count": practiced_count,
        "coverage_rate": coverage_rate,
        "topics": items,
    }


async def get_fluency_progression(
    db: aiosqlite.Connection,
    *,
    limit: int = 30,
) -> dict[str, Any]:
    """Compute fluency progression from ended conversations with performance data."""
    import json as _json

    rows = await db.execute_fetchall(
        """
        SELECT id, topic, started_at, summary_json
        FROM conversations
        WHERE status = 'ended' AND summary_json IS NOT NULL
        ORDER BY started_at ASC
        LIMIT ?
        """,
        (limit,),
    )

    sessions: list[dict[str, Any]] = []
    best_idx = -1
    best_score = -1.0

    for row in rows:
        try:
            summary = _json.loads(row["summary_json"]) if isinstance(row["summary_json"], str) else row["summary_json"]
        except (TypeError, _json.JSONDecodeError):
            continue
        if not isinstance(summary, dict):
            continue
        perf = summary.get("performance")
        if not isinstance(perf, dict):
            continue

        accuracy = float(perf.get("grammar_accuracy_rate", 0))
        diversity = float(perf.get("vocabulary_diversity", 0))
        avg_words = float(perf.get("avg_words_per_message", 0))
        total_msgs = int(perf.get("total_user_messages", 0))

        # Composite fluency score (0-100)
        fluency_score = round(
            accuracy * 0.3
            + diversity * 0.3
            + min(avg_words / 15.0 * 100, 100.0) * 0.25
            + min(total_msgs / 10.0 * 100, 100.0) * 0.15,
            1,
        )

        idx = len(sessions)
        sessions.append({
            "conversation_id": row["id"],
            "topic": row["topic"],
            "date": row["started_at"],
            "grammar_accuracy_rate": round(accuracy, 1),
            "vocabulary_diversity": round(diversity, 1),
            "avg_words_per_message": round(avg_words, 1),
            "total_user_messages": total_msgs,
            "fluency_score": fluency_score,
            "personal_best": False,
        })

        if fluency_score > best_score:
            best_score = fluency_score
            best_idx = idx

    # Mark personal best
    if best_idx >= 0:
        sessions[best_idx]["personal_best"] = True

    # Compute trend
    if len(sessions) < 2:
        trend = "insufficient_data"
    else:
        mid = len(sessions) // 2
        first_half_avg = sum(s["fluency_score"] for s in sessions[:mid]) / mid
        second_half_avg = sum(s["fluency_score"] for s in sessions[mid:]) / (len(sessions) - mid)
        diff = second_half_avg - first_half_avg
        if diff > 2:
            trend = "improving"
        elif diff < -2:
            trend = "declining"
        else:
            trend = "stable"

    return {
        "sessions": sessions,
        "session_count": len(sessions),
        "trend": trend,
    }


async def get_review_queue(
    db: aiosqlite.Connection, *, limit: int = 10
) -> list[dict[str, Any]]:
    """Return a prioritized queue of items to review across all modules."""
    import json as _json
    from collections import Counter
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    items: list[dict[str, Any]] = []

    # 1. Vocabulary words due for SRS review
    vocab_rows = await db.execute_fetchall(
        """
        SELECT vp.word_id, vp.next_review_at, vp.level, vp.correct_count,
               vw.word, vw.meaning, vw.topic
        FROM vocabulary_progress vp
        JOIN vocabulary_words vw ON vw.id = vp.word_id
        WHERE vp.next_review_at IS NOT NULL AND vp.next_review_at <= ?
        ORDER BY vp.next_review_at ASC
        LIMIT 50
        """,
        (now,),
    )
    for row in vocab_rows:
        overdue_days = 0.0
        if row["next_review_at"]:
            try:
                review_dt = datetime.fromisoformat(row["next_review_at"].replace("Z", "+00:00"))
                now_dt = datetime.now(timezone.utc)
                overdue_days = max(0.0, (now_dt - review_dt).total_seconds() / 86400)
            except (ValueError, TypeError):
                pass
        priority = min(100, int(20 * overdue_days + row["level"] * 2))
        items.append({
            "module": "vocabulary",
            "priority": priority,
            "detail": {
                "word_id": row["word_id"],
                "word": row["word"],
                "meaning": row["meaning"],
                "topic": row["topic"],
                "level": row["level"],
                "overdue_days": round(overdue_days, 1),
            },
            "route": "/vocabulary",
        })

    # 2. Pronunciation phrases needing retry (latest score < 7.0)
    pron_rows = await db.execute_fetchall(
        """
        SELECT pa.reference_text, pa.score, pa.created_at
        FROM pronunciation_attempts pa
        INNER JOIN (
            SELECT reference_text, MAX(id) AS max_id
            FROM pronunciation_attempts
            GROUP BY reference_text
        ) latest ON pa.id = latest.max_id
        WHERE pa.score IS NOT NULL AND pa.score < 7.0
        ORDER BY pa.score ASC
        LIMIT 30
        """
    )
    for row in pron_rows:
        score = row["score"] or 0.0
        priority = min(100, int((10 - score) * 10))
        items.append({
            "module": "pronunciation",
            "priority": priority,
            "detail": {
                "reference_text": row["reference_text"],
                "latest_score": round(score, 1),
            },
            "route": "/pronunciation",
        })

    # 3. Grammar error patterns from recent messages
    msg_rows = await db.execute_fetchall(
        """
        SELECT m.feedback_json
        FROM messages m
        WHERE m.role = 'user' AND m.feedback_json IS NOT NULL
        ORDER BY m.created_at DESC
        LIMIT 200
        """
    )
    error_counts: Counter[str] = Counter()
    for row in msg_rows:
        try:
            fb = _json.loads(row["feedback_json"]) if isinstance(row["feedback_json"], str) else row["feedback_json"]
        except (TypeError, _json.JSONDecodeError):
            continue
        if not isinstance(fb, dict):
            continue
        errors = fb.get("errors", [])
        if not isinstance(errors, list):
            continue
        for err in errors:
            if not isinstance(err, dict):
                continue
            explanation = err.get("explanation", "")
            category = _categorize_error(explanation)
            error_counts[category] += 1

    for category, count in error_counts.most_common(20):
        if category == "Other":
            continue
        priority = min(100, count * 5)
        items.append({
            "module": "grammar",
            "priority": priority,
            "detail": {
                "category": category,
                "occurrence_count": count,
            },
            "route": "/conversation",
        })

    # Sort by priority descending, return top `limit`
    items.sort(key=lambda x: x["priority"], reverse=True)
    return items[:limit]
