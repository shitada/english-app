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
        "SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE next_review_at IS NULL OR next_review_at <= ?", (now,)
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
    """Count consecutive days with learning activity ending at today or yesterday."""
    rows = await db.execute_fetchall("""
        SELECT DISTINCT date(created_at) as d FROM (
            SELECT created_at FROM messages WHERE role = 'user' AND created_at >= date('now', '-366 days')
            UNION ALL
            SELECT created_at FROM pronunciation_attempts WHERE created_at >= date('now', '-366 days')
            UNION ALL
            SELECT answered_at AS created_at FROM quiz_attempts WHERE answered_at >= date('now', '-366 days')
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
        ORDER BY ts DESC LIMIT ?
    """, (limit, limit, limit, limit))
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
               COALESCE(vocab.cnt, 0) AS vocabulary_reviews
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
           ORDER BY dates.d ASC""",
        (days, days, days, days, days),
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
    result = []
    for g in goals:
        goal = dict(g)
        goal_type = goal["goal_type"]
        # Count today's activity
        if goal_type == "conversations":
            rows = await db.execute_fetchall(
                "SELECT COUNT(*) as cnt FROM conversations WHERE started_at >= date('now') AND started_at < date('now', '+1 day')"
            )
        elif goal_type == "vocabulary_reviews":
            rows = await db.execute_fetchall(
                "SELECT COUNT(*) as cnt FROM quiz_attempts WHERE answered_at >= date('now') AND answered_at < date('now', '+1 day')"
            )
        elif goal_type == "pronunciation_attempts":
            rows = await db.execute_fetchall(
                "SELECT COUNT(*) as cnt FROM pronunciation_attempts WHERE created_at >= date('now') AND created_at < date('now', '+1 day')"
            )
        else:
            rows = [{"cnt": 0}]
        today_count = rows[0]["cnt"] if rows else 0
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
    # Compute today_count so the frontend can display progress immediately
    if goal_type == "conversations":
        count_rows = await db.execute_fetchall(
            "SELECT COUNT(*) as cnt FROM conversations WHERE started_at >= date('now') AND started_at < date('now', '+1 day')"
        )
    elif goal_type == "vocabulary_reviews":
        count_rows = await db.execute_fetchall(
            "SELECT COUNT(*) as cnt FROM quiz_attempts WHERE answered_at >= date('now') AND answered_at < date('now', '+1 day')"
        )
    elif goal_type == "pronunciation_attempts":
        count_rows = await db.execute_fetchall(
            "SELECT COUNT(*) as cnt FROM pronunciation_attempts WHERE created_at >= date('now') AND created_at < date('now', '+1 day')"
        )
    else:
        count_rows = [{"cnt": 0}]
    today_count = count_rows[0]["cnt"] if count_rows else 0
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
    """Get today's activity counts across all modules."""
    conv_rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM conversations WHERE started_at >= date('now') AND started_at < date('now', '+1 day')"
    )
    vocab_rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM quiz_attempts WHERE answered_at >= date('now') AND answered_at < date('now', '+1 day')"
    )
    pron_rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM pronunciation_attempts WHERE created_at >= date('now') AND created_at < date('now', '+1 day')"
    )
    return {
        "conversations": conv_rows[0]["cnt"] if conv_rows else 0,
        "vocabulary_reviews": vocab_rows[0]["cnt"] if vocab_rows else 0,
        "pronunciation_attempts": pron_rows[0]["cnt"] if pron_rows else 0,
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
    {"id": "all_rounder", "title": "All-Rounder", "description": "Use all 3 learning modules", "emoji": "🎯", "category": "general", "target": 3},
    {"id": "dedicated_10", "title": "Dedicated", "description": "Study for 10 different days", "emoji": "📅", "category": "general", "target": 10},
    {"id": "century", "title": "Century", "description": "Complete 100 total activities", "emoji": "💯", "category": "general", "target": 100},
]


async def get_achievements(db: aiosqlite.Connection) -> dict[str, Any]:
    """Compute achievements from existing learning data."""

    # Gather counts from existing tables
    streak_rows = await db.execute_fetchall("""
        SELECT COUNT(DISTINCT date(created_at)) as days FROM (
            SELECT created_at FROM messages WHERE role = 'user'
            UNION ALL
            SELECT created_at FROM pronunciation_attempts
            UNION ALL
            SELECT answered_at AS created_at FROM quiz_attempts
        )
    """)
    study_days = streak_rows[0]["days"] if streak_rows else 0

    # Current streak (from get_stats logic)
    conv_rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM conversations WHERE ended_at IS NOT NULL")
    total_convs = conv_rows[0]["cnt"] if conv_rows else 0

    vocab_rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE level >= 3"
    )
    vocab_mastered = vocab_rows[0]["cnt"] if vocab_rows else 0

    pron_rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM pronunciation_attempts")
    total_pron = pron_rows[0]["cnt"] if pron_rows else 0

    perfect_rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM pronunciation_attempts WHERE score >= 9.0"
    )
    perfect_count = perfect_rows[0]["cnt"] if perfect_rows else 0

    quiz_rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM quiz_attempts")
    total_quiz = quiz_rows[0]["cnt"] if quiz_rows else 0

    # Modules used
    modules_used = sum([
        1 if total_convs > 0 else 0,
        1 if total_quiz > 0 else 0,
        1 if total_pron > 0 else 0,
    ])

    total_activities = total_convs + total_quiz + total_pron

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

    # Grammar accuracy from feedback this week
    grammar_stats = await get_grammar_stats(db)
    grammar_accuracy = grammar_stats["grammar_accuracy"]

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
    conv_count = row[0][0] if row else 0
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM messages WHERE role = 'user'"
    )
    msg_count = row[0][0] if row else 0
    speaking = min(100, int((conv_count * 5 + msg_count) / 2))

    # Listening: proxy from pronunciation attempts with decent scores
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt, AVG(CAST(json_extract(feedback_json, '$.overall_score') AS REAL)) as avg_s "
        "FROM pronunciation_attempts WHERE feedback_json IS NOT NULL"
    )
    pron_count = row[0][0] if row and row[0][0] else 0
    pron_avg = row[0][1] if row and row[0][1] else 0
    listening = min(100, int(pron_count * 3 + pron_avg * 5))

    # Vocabulary: mastery percentage
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as total, SUM(CASE WHEN level >= 3 THEN 1 ELSE 0 END) as mastered "
        "FROM vocabulary_progress"
    )
    vocab_total = row[0][0] if row and row[0][0] else 0
    vocab_mastered = row[0][1] if row and row[0][1] else 0
    vocabulary = int((vocab_mastered / vocab_total * 100) if vocab_total > 0 else 0)

    # Grammar: accuracy from feedback
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as total, "
        "SUM(CASE WHEN json_extract(feedback_json, '$.is_correct') = 1 THEN 1 ELSE 0 END) as correct "
        "FROM messages WHERE feedback_json IS NOT NULL AND role = 'user'"
    )
    grammar_total = row[0][0] if row and row[0][0] else 0
    grammar_correct = row[0][1] if row and row[0][1] else 0
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
        ORDER BY ts DESC LIMIT ?
    """, (limit, limit, limit, limit))
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
    from_date = (date.today() - __import__("datetime").timedelta(days=days)).isoformat()

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

    # Build per-day breakdown
    daily: dict[str, dict[str, int]] = {}
    conv_total_secs = 0
    conv_total_cnt = 0
    for r in conv_rows:
        d = r["day"]
        s = max(r["secs"] or 0, 0)
        daily.setdefault(d, {"conversation": 0, "pronunciation": 0, "vocabulary": 0})
        daily[d]["conversation"] = s
        conv_total_secs += s
        conv_total_cnt += r["cnt"]

    pron_total_secs = 0
    pron_total_cnt = 0
    for r in pron_rows:
        d = r["day"]
        s = r["cnt"] * 120  # 2 min per attempt
        daily.setdefault(d, {"conversation": 0, "pronunciation": 0, "vocabulary": 0})
        daily[d]["pronunciation"] = s
        pron_total_secs += s
        pron_total_cnt += r["cnt"]

    vocab_total_secs = 0
    vocab_total_cnt = 0
    for r in vocab_rows:
        d = r["day"]
        s = r["cnt"] * 30  # 30 sec per attempt
        daily.setdefault(d, {"conversation": 0, "pronunciation": 0, "vocabulary": 0})
        daily[d]["vocabulary"] = s
        vocab_total_secs += s
        vocab_total_cnt += r["cnt"]

    modules = [
        {"module": "conversation", "total_seconds": conv_total_secs, "session_count": conv_total_cnt},
        {"module": "pronunciation", "total_seconds": pron_total_secs, "session_count": pron_total_cnt},
        {"module": "vocabulary", "total_seconds": vocab_total_secs, "session_count": vocab_total_cnt},
    ]

    daily_list = [
        {
            "date": d,
            "conversation_seconds": v["conversation"],
            "pronunciation_seconds": v["pronunciation"],
            "vocabulary_seconds": v["vocabulary"],
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

    return {
        "total_quizzes": total_quizzes,
        "avg_score": avg_score,
        "best_score": best_score,
        "by_difficulty": by_difficulty,
        "trend": trend,
    }
