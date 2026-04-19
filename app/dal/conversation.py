"""Data access layer for conversations and messages."""

from __future__ import annotations

import json
import random
import re
from typing import Any

import aiosqlite

from app.utils import coerce_bool, escape_like


async def create_conversation(db: aiosqlite.Connection, topic: str, difficulty: str = "intermediate", role_swap: bool = False, personality: str = "patient_teacher") -> int:
    cursor = await db.execute(
        "INSERT INTO conversations (topic, difficulty, role_swap, personality) VALUES (?, ?, ?, ?)",
        (topic, difficulty, int(role_swap), personality),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore[return-value]


async def add_message(
    db: aiosqlite.Connection,
    conversation_id: int,
    role: str,
    content: str,
    feedback: dict[str, Any] | None = None,
) -> int:
    feedback_json = json.dumps(feedback) if feedback is not None else None
    cursor = await db.execute(
        "INSERT INTO messages (conversation_id, role, content, feedback_json) VALUES (?, ?, ?, ?)",
        (conversation_id, role, content, feedback_json),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore[return-value]


async def update_message_feedback(
    db: aiosqlite.Connection,
    message_id: int,
    feedback: dict[str, Any],
) -> None:
    await db.execute(
        "UPDATE messages SET feedback_json = ? WHERE id = ?",
        (json.dumps(feedback), message_id),
    )
    await db.commit()


async def conversation_exists(db: aiosqlite.Connection, conversation_id: int) -> bool:
    """Check whether a conversation with the given ID exists."""
    rows = await db.execute_fetchall(
        "SELECT 1 FROM conversations WHERE id = ?", (conversation_id,)
    )
    return len(rows) > 0


async def get_active_conversation(db: aiosqlite.Connection, conversation_id: int) -> dict | None:
    rows = await db.execute_fetchall(
        "SELECT * FROM conversations WHERE id = ? AND status = 'active'",
        (conversation_id,),
    )
    return dict(rows[0]) if rows else None


async def get_conversation_status(db: aiosqlite.Connection, conversation_id: int) -> str | None:
    """Return the conversation's status string, or None if not found."""
    rows = await db.execute_fetchall(
        "SELECT status FROM conversations WHERE id = ?",
        (conversation_id,),
    )
    return rows[0]["status"] if rows else None


async def get_conversation_history(
    db: aiosqlite.Connection,
    conversation_id: int,
) -> list[dict[str, Any]]:
    rows = await db.execute_fetchall(
        "SELECT id, role, content, feedback_json, is_bookmarked, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC",
        (conversation_id,),
    )
    return [dict(r) for r in rows]


async def format_history_text(
    db: aiosqlite.Connection,
    conversation_id: int,
    max_turns: int | None = None,
) -> str:
    if max_turns is not None and max_turns >= 0:
        # Get total count to determine if truncation marker is needed
        count_rows = await db.execute_fetchall(
            "SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?",
            (conversation_id,),
        )
        total = int(count_rows[0]["c"]) if count_rows else 0
        recent_rows = await db.execute_fetchall(
            "SELECT role, content FROM messages WHERE conversation_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (conversation_id, max_turns),
        )
        # Reverse to chronological order
        rows = list(reversed(list(recent_rows)))
        body = "\n".join(f"{r['role']}: {r['content']}" for r in rows)
        if total > max_turns:
            marker = "[earlier turns omitted for brevity]"
            return f"{marker}\n{body}" if body else marker
        return body
    rows = await db.execute_fetchall(
        "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC",
        (conversation_id,),
    )
    return "\n".join(f"{r['role']}: {r['content']}" for r in rows)


async def end_conversation(
    db: aiosqlite.Connection,
    conversation_id: int,
    summary: dict[str, Any] | None = None,
) -> bool:
    """End a conversation atomically. Returns True if transitioned, False if already ended."""
    summary_json = json.dumps(summary) if summary is not None else None
    cursor = await db.execute(
        "UPDATE conversations SET status = 'ended', ended_at = datetime('now'), summary_json = ? WHERE id = ? AND status = 'active'",
        (summary_json, conversation_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def get_conversation_summary(
    db: aiosqlite.Connection,
    conversation_id: int,
) -> dict[str, Any] | None:
    """Retrieve a stored conversation summary."""
    rows = await db.execute_fetchall(
        "SELECT summary_json FROM conversations WHERE id = ?",
        (conversation_id,),
    )
    if rows and rows[0]["summary_json"]:
        try:
            return json.loads(rows[0]["summary_json"])
        except (json.JSONDecodeError, TypeError):
            return None
    return None


async def get_topic_progress(
    db: aiosqlite.Connection,
    conversation_id: int,
) -> dict[str, Any] | None:
    """Compare current conversation performance with the previous one on the same topic."""
    row = await db.execute_fetchall(
        "SELECT id, topic, summary_json FROM conversations WHERE id = ?",
        (conversation_id,),
    )
    if not row:
        return None
    current = dict(row[0])
    topic = current["topic"]
    if not current["summary_json"]:
        return None
    try:
        current_summary = json.loads(current["summary_json"])
    except (json.JSONDecodeError, TypeError):
        return None
    current_perf = current_summary.get("performance", {})
    if not current_perf:
        return None

    prev_rows = await db.execute_fetchall(
        """SELECT summary_json FROM conversations
           WHERE topic = ? AND status = 'ended' AND id < ? AND summary_json IS NOT NULL
           ORDER BY id DESC LIMIT 1""",
        (topic, conversation_id),
    )

    metrics = ["grammar_accuracy_rate", "avg_words_per_message", "vocabulary_diversity",
               "total_user_messages", "speaking_pace_wpm"]

    def extract(perf: dict) -> dict:
        return {m: perf.get(m) for m in metrics if perf.get(m) is not None}

    current_metrics = extract(current_perf)

    if not prev_rows:
        return {"has_previous": False, "current": current_metrics, "previous": None, "deltas": None}

    try:
        prev_summary = json.loads(prev_rows[0]["summary_json"])
    except (json.JSONDecodeError, TypeError):
        return {"has_previous": False, "current": current_metrics, "previous": None, "deltas": None}

    prev_perf = prev_summary.get("performance", {})
    prev_metrics = extract(prev_perf)

    deltas = {}
    for m in metrics:
        cur_val = current_metrics.get(m)
        prev_val = prev_metrics.get(m)
        if cur_val is not None and prev_val is not None:
            deltas[m] = round(cur_val - prev_val, 2)

    return {"has_previous": True, "current": current_metrics, "previous": prev_metrics, "deltas": deltas}


async def list_conversations(
    db: aiosqlite.Connection,
    topic: str | None = None,
    keyword: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List past conversations with message counts, optionally filtered."""
    where_clauses: list[str] = []
    params: list[Any] = []

    if topic:
        where_clauses.append("c.topic = ?")
        params.append(topic)
    if keyword:
        where_clauses.append(
            "EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id "
            "AND m2.content LIKE '%' || ? || '%' ESCAPE '\\')"
        )
        params.append(escape_like(keyword))

    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    params.extend([limit, offset])

    rows = await db.execute_fetchall(
        f"""SELECT c.id, c.topic, c.difficulty, c.started_at, c.ended_at, c.status,
                   COUNT(m.id) as message_count,
                   CASE WHEN c.ended_at IS NOT NULL
                        THEN CAST((julianday(c.ended_at) - julianday(c.started_at)) * 86400 AS INTEGER)
                        ELSE NULL END as duration_seconds
            FROM conversations c
            LEFT JOIN messages m ON c.id = m.conversation_id
            {where_sql}
            GROUP BY c.id
            ORDER BY c.started_at DESC, c.id DESC
            LIMIT ? OFFSET ?""",
        params,
    )
    return [dict(r) for r in rows]


async def count_conversations(
    db: aiosqlite.Connection,
    topic: str | None = None,
    keyword: str | None = None,
) -> int:
    """Count total conversations, optionally filtered by topic and/or keyword."""
    where_clauses: list[str] = []
    params: list[Any] = []

    if topic:
        where_clauses.append("topic = ?")
        params.append(topic)
    if keyword:
        where_clauses.append(
            "EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id "
            "AND m.content LIKE '%' || ? || '%' ESCAPE '\\')"
        )
        params.append(escape_like(keyword))

    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    rows = await db.execute_fetchall(
        f"SELECT COUNT(*) as cnt FROM conversations{where_sql}",
        params,
    )
    return rows[0]["cnt"] if rows else 0


async def delete_conversation(db: aiosqlite.Connection, conversation_id: int) -> bool:
    """Delete a conversation and its messages (cascade). Returns True if deleted."""
    cursor = await db.execute(
        "DELETE FROM conversations WHERE id = ?", (conversation_id,)
    )
    await db.commit()
    return cursor.rowcount > 0


async def delete_message(db: aiosqlite.Connection, message_id: int) -> bool:
    """Delete a single message by ID. Returns True if deleted."""
    cursor = await db.execute(
        "DELETE FROM messages WHERE id = ?", (message_id,)
    )
    await db.commit()
    return cursor.rowcount > 0


async def delete_ended_conversations(db: aiosqlite.Connection) -> int:
    """Delete all ended and abandoned conversations. Returns count of deleted rows."""
    cursor = await db.execute(
        "DELETE FROM conversations WHERE status IN ('ended', 'abandoned')"
    )
    await db.commit()
    return cursor.rowcount


async def cleanup_stale_conversations(db: aiosqlite.Connection, max_age_hours: int = 24) -> int:
    """Mark stale active conversations as abandoned. Returns count of updated rows."""
    cursor = await db.execute(
        "UPDATE conversations SET status = 'abandoned', ended_at = datetime('now') "
        "WHERE status = 'active' AND started_at < datetime('now', '-' || ? || ' hours')",
        (max_age_hours,),
    )
    await db.commit()
    return cursor.rowcount


async def get_conversation_export(
    db: aiosqlite.Connection, conversation_id: int
) -> dict[str, Any] | None:
    """Get full conversation transcript with metadata and messages."""
    row = await db.execute_fetchall(
        """SELECT id, topic, difficulty, started_at, ended_at, status, summary_json
           FROM conversations WHERE id = ?""",
        (conversation_id,),
    )
    if not row:
        return None
    conv = dict(row[0])
    summary = None
    if conv["summary_json"]:
        try:
            summary = json.loads(conv["summary_json"])
        except (json.JSONDecodeError, TypeError):
            summary = conv["summary_json"]

    msgs = await db.execute_fetchall(
        """SELECT role, content, feedback_json, created_at
           FROM messages WHERE conversation_id = ?
           ORDER BY created_at ASC, id ASC""",
        (conversation_id,),
    )
    messages = []
    for m in msgs:
        feedback = None
        if m["feedback_json"]:
            try:
                feedback = json.loads(m["feedback_json"])
            except (json.JSONDecodeError, TypeError):
                feedback = m["feedback_json"]
        messages.append({
            "role": m["role"],
            "content": m["content"],
            "feedback": feedback,
            "created_at": m["created_at"],
        })

    return {
        "id": conv["id"],
        "topic": conv["topic"],
        "difficulty": conv["difficulty"],
        "started_at": conv["started_at"],
        "ended_at": conv["ended_at"],
        "status": conv["status"],
        "summary": summary,
        "messages": messages,
    }


async def get_grammar_accuracy(
    db: aiosqlite.Connection, *, days: int = 180
) -> dict[str, Any]:
    """Get grammar accuracy stats across conversations within a time window."""
    rows = await db.execute_fetchall(
        """SELECT c.topic, m.feedback_json
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.role = 'user' AND m.feedback_json IS NOT NULL
             AND m.created_at >= date('now', ? || ' days')
           LIMIT 5000""",
        (f"-{days}",),
    )
    topic_stats: dict[str, dict[str, int]] = {}
    total_correct = 0
    total_checked = 0
    for row in rows:
        topic = row["topic"]
        try:
            feedback = json.loads(row["feedback_json"])
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(feedback, dict):
            continue
        if topic not in topic_stats:
            topic_stats[topic] = {"correct": 0, "total": 0, "error_count": 0}
        topic_stats[topic]["total"] += 1
        total_checked += 1
        if coerce_bool(feedback.get("is_correct", False)):
            topic_stats[topic]["correct"] += 1
            total_correct += 1
        errors = feedback.get("errors") or []
        if isinstance(errors, list):
            topic_stats[topic]["error_count"] += len(errors)

    overall_rate = round(total_correct / total_checked * 100, 1) if total_checked > 0 else 0.0
    by_topic = []
    for topic, stats in sorted(topic_stats.items()):
        rate = round(stats["correct"] / stats["total"] * 100, 1) if stats["total"] > 0 else 0.0
        by_topic.append({
            "topic": topic,
            "total_messages": stats["total"],
            "correct_messages": stats["correct"],
            "accuracy_rate": rate,
            "total_errors": stats["error_count"],
        })

    return {
        "total_checked": total_checked,
        "total_correct": total_correct,
        "overall_accuracy_rate": overall_rate,
        "by_topic": by_topic,
    }


async def get_topic_recommendations(
    db: aiosqlite.Connection, all_topics: list[str]
) -> list[dict[str, Any]]:
    """Recommend conversation topics based on practice frequency and grammar accuracy."""
    rows = await db.execute_fetchall(
        """SELECT topic, COUNT(*) as session_count,
                  MAX(started_at) as last_practiced
           FROM conversations
           GROUP BY topic"""
    )
    practiced = {row["topic"]: dict(row) for row in rows}

    # Per-topic grammar accuracy
    grammar_rows = await db.execute_fetchall(
        """SELECT c.topic, m.feedback_json
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.role = 'user' AND m.feedback_json IS NOT NULL
           LIMIT 5000"""
    )
    grammar_stats: dict[str, dict[str, int]] = {}
    for row in grammar_rows:
        topic = row["topic"]
        try:
            fb = json.loads(row["feedback_json"])
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(fb, dict):
            continue
        if topic not in grammar_stats:
            grammar_stats[topic] = {"correct": 0, "total": 0}
        grammar_stats[topic]["total"] += 1
        if coerce_bool(fb.get("is_correct", False)):
            grammar_stats[topic]["correct"] += 1

    recommendations = []
    for topic in all_topics:
        gs = grammar_stats.get(topic, {"correct": 0, "total": 0})
        accuracy = round(gs["correct"] / gs["total"] * 100) if gs["total"] > 0 else None

        if topic not in practiced:
            recommendations.append({
                "topic": topic,
                "session_count": 0,
                "last_practiced": None,
                "accuracy": accuracy,
                "reason": "never_practiced",
                "reason_text": "You haven't tried this scenario yet",
                "priority": 0,
            })
        elif accuracy is not None and accuracy < 70:
            recommendations.append({
                "topic": topic,
                "session_count": practiced[topic]["session_count"],
                "last_practiced": practiced[topic]["last_practiced"],
                "accuracy": accuracy,
                "reason": "low_accuracy",
                "reason_text": f"Your grammar accuracy was {accuracy}% — try again to improve!",
                "priority": 1,
            })
        else:
            recommendations.append({
                "topic": topic,
                "session_count": practiced[topic]["session_count"],
                "last_practiced": practiced[topic]["last_practiced"],
                "accuracy": accuracy,
                "reason": "continue_practice",
                "reason_text": "Keep practicing to maintain your skills",
                "priority": 2,
            })

    recommendations.sort(key=lambda r: (r["priority"], r.get("accuracy") or 999, r["session_count"]))
    return recommendations


async def get_topic_mastery(db: aiosqlite.Connection) -> dict[str, dict[str, Any]]:
    """Compute per-topic mastery tiers from ended conversations and their summary_json.

    Tiers:
        new       – 0 sessions
        bronze    – 1+ session completed
        silver    – 3+ sessions, avg grammar ≥60%
        gold      – 5+ sessions, avg grammar ≥80%, intermediate+ attempted
        diamond   – 8+ sessions, avg grammar ≥90%, advanced attempted
    """
    rows = await db.execute_fetchall(
        "SELECT topic, difficulty, summary_json FROM conversations WHERE status = 'ended'"
    )

    # Accumulate per-topic stats
    topic_data: dict[str, dict[str, Any]] = {}
    for row in rows:
        topic = row["topic"]
        if topic not in topic_data:
            topic_data[topic] = {
                "sessions": 0,
                "grammar_sum": 0.0,
                "grammar_count": 0,
                "difficulties": set(),
            }
        td = topic_data[topic]
        td["sessions"] += 1
        td["difficulties"].add(row["difficulty"])

        if row["summary_json"]:
            try:
                summary = json.loads(row["summary_json"])
            except (json.JSONDecodeError, TypeError):
                continue
            perf = summary.get("performance", {})
            grammar_rate = perf.get("grammar_accuracy_rate")
            if grammar_rate is not None:
                td["grammar_sum"] += float(grammar_rate)
                td["grammar_count"] += 1

    result: dict[str, dict[str, Any]] = {}
    for topic, td in topic_data.items():
        sessions = td["sessions"]
        avg_grammar = round(td["grammar_sum"] / td["grammar_count"], 1) if td["grammar_count"] > 0 else 0.0
        difficulties = td["difficulties"]

        # Determine highest difficulty attempted
        if "advanced" in difficulties:
            highest_difficulty = "advanced"
        elif "intermediate" in difficulties:
            highest_difficulty = "intermediate"
        elif "beginner" in difficulties:
            highest_difficulty = "beginner"
        else:
            highest_difficulty = "unknown"

        # Determine tier (check from highest to lowest)
        if sessions >= 8 and avg_grammar >= 90 and "advanced" in difficulties:
            tier = "diamond"
        elif sessions >= 5 and avg_grammar >= 80 and highest_difficulty in ("intermediate", "advanced"):
            tier = "gold"
        elif sessions >= 3 and avg_grammar >= 60:
            tier = "silver"
        elif sessions >= 1:
            tier = "bronze"
        else:
            tier = "new"

        result[topic] = {
            "tier": tier,
            "sessions": sessions,
            "avg_grammar": avg_grammar,
            "highest_difficulty": highest_difficulty,
        }

    return result


async def toggle_message_bookmark(db: aiosqlite.Connection, message_id: int) -> dict | None:
    """Toggle the is_bookmarked flag on a message. Returns updated message or None."""
    cursor = await db.execute(
        "UPDATE messages SET is_bookmarked = 1 - is_bookmarked WHERE id = ?",
        (message_id,),
    )
    if cursor.rowcount == 0:
        return None
    await db.commit()
    rows = await db.execute_fetchall(
        "SELECT id, conversation_id, role, content, is_bookmarked, created_at FROM messages WHERE id = ?",
        (message_id,),
    )
    row = rows[0]
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "role": row["role"],
        "content": row["content"],
        "is_bookmarked": bool(row["is_bookmarked"]),
        "created_at": row["created_at"],
    }


async def get_bookmarked_messages(
    db: aiosqlite.Connection,
    conversation_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Return bookmarked messages, optionally filtered by conversation_id."""
    params: list[Any] = []
    where = "WHERE m.is_bookmarked = 1"
    if conversation_id is not None:
        where += " AND m.conversation_id = ?"
        params.append(conversation_id)
    params.extend([limit, offset])
    rows = await db.execute_fetchall(
        f"""SELECT m.id, m.conversation_id, m.role, m.content, m.is_bookmarked,
                   m.created_at, c.topic
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            {where}
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT ? OFFSET ?""",
        params,
    )
    return [
        {
            "id": r["id"],
            "conversation_id": r["conversation_id"],
            "role": r["role"],
            "content": r["content"],
            "is_bookmarked": bool(r["is_bookmarked"]),
            "created_at": r["created_at"],
            "topic": r["topic"],
        }
        for r in rows
    ]


async def count_bookmarked_messages(
    db: aiosqlite.Connection, conversation_id: int | None = None
) -> int:
    """Count bookmarked messages, optionally filtered by conversation_id."""
    params: list[Any] = []
    where = "WHERE is_bookmarked = 1"
    if conversation_id is not None:
        where += " AND conversation_id = ?"
        params.append(conversation_id)
    rows = await db.execute_fetchall(
        f"SELECT COUNT(*) as cnt FROM messages {where}", params
    )
    return rows[0]["cnt"] if rows else 0


async def get_conversation_replay(
    db: aiosqlite.Connection, conversation_id: int
) -> dict[str, Any] | None:
    """Get conversation messages structured as turn-by-turn pairs for replay."""
    conv_rows = await db.execute_fetchall(
        """SELECT id, topic, difficulty, started_at, ended_at, status
           FROM conversations WHERE id = ?""",
        (conversation_id,),
    )
    if not conv_rows:
        return None

    conv = dict(conv_rows[0])
    rows = await db.execute_fetchall(
        """SELECT id, role, content, feedback_json, created_at
           FROM messages WHERE conversation_id = ?
           ORDER BY created_at ASC, id ASC""",
        (conversation_id,),
    )

    turns: list[dict[str, Any]] = []
    turn_number = 0
    i = 0
    messages = [dict(r) for r in rows]

    while i < len(messages):
        msg = messages[i]
        if msg["role"] == "user":
            turn_number += 1
            turn: dict[str, Any] = {
                "turn_number": turn_number,
                "user_message": msg["content"],
                "user_timestamp": msg["created_at"],
                "assistant_message": None,
                "assistant_timestamp": None,
                "feedback": None,
                "corrections": [],
            }
            # Look for paired assistant response
            if i + 1 < len(messages) and messages[i + 1]["role"] == "assistant":
                ast = messages[i + 1]
                turn["assistant_message"] = ast["content"]
                turn["assistant_timestamp"] = ast["created_at"]
                i += 1
            # Parse feedback from user message
            if msg["feedback_json"]:
                try:
                    feedback = json.loads(msg["feedback_json"])
                    turn["feedback"] = feedback
                    if isinstance(feedback, dict):
                        turn["corrections"] = feedback.get("errors") or []
                except (json.JSONDecodeError, TypeError):
                    pass
            turns.append(turn)
        elif msg["role"] == "assistant" and turn_number == 0:
            # Opening assistant message (before any user message)
            turn_number += 1
            turns.append({
                "turn_number": turn_number,
                "user_message": None,
                "user_timestamp": None,
                "assistant_message": msg["content"],
                "assistant_timestamp": msg["created_at"],
                "feedback": None,
                "corrections": [],
            })
        i += 1

    return {
        "conversation": conv,
        "turns": turns,
        "total_turns": len(turns),
    }


async def get_conversation_metrics(
    db: aiosqlite.Connection, conversation_id: int
) -> dict[str, Any]:
    """Compute quantitative performance metrics for a conversation."""
    rows = await db.execute_fetchall(
        "SELECT content, feedback_json FROM messages WHERE conversation_id = ? AND role = 'user'",
        (conversation_id,),
    )
    total_user_messages = len(rows)
    grammar_checked = 0
    grammar_correct = 0
    total_words = 0
    all_words: list[str] = []
    for row in rows:
        # Fluency metrics from content
        words = row["content"].split() if row["content"] else []
        total_words += len(words)
        all_words.extend(w.lower().strip(".,!?;:'\"") for w in words if w.strip(".,!?;:'\""))

        # Grammar metrics from feedback
        if not row["feedback_json"]:
            continue
        try:
            feedback = json.loads(row["feedback_json"])
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(feedback, dict):
            continue
        if "is_correct" not in feedback:
            continue
        grammar_checked += 1
        if coerce_bool(feedback["is_correct"]):
            grammar_correct += 1
    accuracy_rate = round(grammar_correct / grammar_checked * 100, 1) if grammar_checked > 0 else 0.0
    unique_words = len(set(all_words))
    avg_words = round(total_words / total_user_messages, 1) if total_user_messages > 0 else 0.0
    diversity = round(unique_words / len(all_words) * 100, 1) if all_words else 0.0

    # Speaking pace (WPM) from message timestamps
    pace_data = await _compute_speaking_pace(db, conversation_id)

    return {
        "total_user_messages": total_user_messages,
        "grammar_checked": grammar_checked,
        "grammar_correct": grammar_correct,
        "grammar_accuracy_rate": accuracy_rate,
        "total_words": total_words,
        "unique_words": unique_words,
        "avg_words_per_message": avg_words,
        "vocabulary_diversity": diversity,
        **pace_data,
    }


async def _compute_speaking_pace(
    db: aiosqlite.Connection, conversation_id: int
) -> dict[str, Any]:
    """Compute per-message WPM from timestamps of alternating messages."""
    from datetime import datetime

    all_msgs = await db.execute_fetchall(
        "SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC",
        (conversation_id,),
    )
    if not all_msgs:
        return {"speaking_pace_wpm": 0, "fastest_wpm": 0, "slowest_wpm": 0, "pace_trend": []}

    pace_values: list[float] = []
    last_assistant_ts: datetime | None = None

    for msg in all_msgs:
        ts_str = msg["created_at"]
        try:
            ts = datetime.fromisoformat(ts_str)
        except (ValueError, TypeError):
            continue

        if msg["role"] == "assistant":
            last_assistant_ts = ts
        elif msg["role"] == "user" and last_assistant_ts is not None:
            elapsed = (ts - last_assistant_ts).total_seconds()
            if elapsed < 2:
                continue  # skip too-fast (likely copy-paste)
            word_count = len(msg["content"].split()) if msg["content"] else 0
            if word_count > 0:
                wpm = round((word_count / elapsed) * 60, 1)
                pace_values.append(wpm)

    if not pace_values:
        return {"speaking_pace_wpm": 0, "fastest_wpm": 0, "slowest_wpm": 0, "pace_trend": []}

    return {
        "speaking_pace_wpm": round(sum(pace_values) / len(pace_values), 1),
        "fastest_wpm": round(max(pace_values), 1),
        "slowest_wpm": round(min(pace_values), 1),
        "pace_trend": [round(v, 1) for v in pace_values],
    }


async def get_conversation_vocabulary(
    db: aiosqlite.Connection, conversation_id: int
) -> dict[str, Any] | None:
    """Find vocabulary words that appear in a conversation's messages."""
    conv_rows = await db.execute_fetchall(
        "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not conv_rows:
        return None

    msg_rows = await db.execute_fetchall(
        "SELECT content FROM messages WHERE conversation_id = ?",
        (conversation_id,),
    )
    if not msg_rows:
        return {"conversation_id": conversation_id, "words": [], "total": 0}

    # Combine all message content into one searchable text
    full_text = " ".join(r["content"].lower() for r in msg_rows)

    # Get all vocabulary words (capped for safety)
    word_rows = await db.execute_fetchall(
        """SELECT w.id, w.word, w.meaning, w.topic, w.difficulty,
                  p.level, p.correct_count, p.incorrect_count, p.next_review_at
           FROM vocabulary_words w
           LEFT JOIN vocabulary_progress p ON w.id = p.word_id
           LIMIT 2000"""
    )

    matched = []
    for r in word_rows:
        word_lower = r["word"].lower()
        if re.search(r'\b' + re.escape(word_lower) + r'\b', full_text):
            matched.append({
                "word_id": r["id"],
                "word": r["word"],
                "meaning": r["meaning"],
                "topic": r["topic"],
                "difficulty": r["difficulty"],
                "srs_level": r["level"] or 0,
                "correct_count": r["correct_count"] or 0,
                "incorrect_count": r["incorrect_count"] or 0,
                "next_review_at": r["next_review_at"],
            })

    return {"conversation_id": conversation_id, "words": matched, "total": len(matched)}


async def get_shadowing_phrases(
    db: aiosqlite.Connection,
    conversation_id: int,
    limit: int = 6,
) -> list[dict[str, Any]] | None:
    """Extract suitable shadowing phrases from assistant messages in a conversation."""
    row = await db.execute_fetchall(
        "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not row:
        return None

    rows = await db.execute_fetchall(
        "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id",
        (conversation_id,),
    )

    phrases: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in rows:
        content = r[0] if isinstance(r, (tuple, list)) else r["content"]
        sentences = re.split(r'(?<=[.!?])\s+', content.strip())
        for s in sentences:
            s = s.strip()
            word_count = len(s.split())
            normalized = s.lower()
            if 4 <= word_count <= 15 and normalized not in seen:
                seen.add(normalized)
                phrases.append({"text": s, "word_count": word_count})
                if len(phrases) >= limit:
                    return phrases

    return phrases


async def get_difficulty_recommendation(db: aiosqlite.Connection) -> dict[str, Any]:
    """Analyze recent conversations to recommend a difficulty level."""
    rows = await db.execute_fetchall(
        """
        SELECT c.id, c.difficulty, c.summary_json
        FROM conversations c
        WHERE c.status = 'ended' AND c.summary_json IS NOT NULL
        ORDER BY c.ended_at DESC
        LIMIT 5
        """
    )

    if len(rows) < 2:
        return {
            "current_difficulty": "intermediate",
            "recommended_difficulty": "intermediate",
            "reason": "Not enough data yet — keep practicing!",
            "stats": {"accuracy": 0, "avg_words": 0, "sessions_analyzed": len(rows)},
        }

    difficulties = [r["difficulty"] or "intermediate" for r in rows]
    current_difficulty = max(set(difficulties), key=difficulties.count)

    total_accuracy = 0.0
    total_avg_words = 0.0
    valid_count = 0

    for row in rows:
        try:
            summary = json.loads(row["summary_json"]) if isinstance(row["summary_json"], str) else row["summary_json"]
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(summary, dict):
            continue
        perf = summary.get("performance")
        if not isinstance(perf, dict):
            continue
        total_accuracy += float(perf.get("grammar_accuracy_rate", 0))
        total_avg_words += float(perf.get("avg_words_per_message", 0))
        valid_count += 1

    if valid_count == 0:
        return {
            "current_difficulty": current_difficulty,
            "recommended_difficulty": current_difficulty,
            "reason": "Not enough performance data yet.",
            "stats": {"accuracy": 0, "avg_words": 0, "sessions_analyzed": 0},
        }

    avg_accuracy = round(total_accuracy / valid_count, 1)
    avg_words = round(total_avg_words / valid_count, 1)

    levels = ["beginner", "intermediate", "advanced"]
    current_idx = levels.index(current_difficulty) if current_difficulty in levels else 1

    if avg_accuracy > 85 and avg_words > 10 and current_idx < 2:
        recommended = levels[current_idx + 1]
        reason = f"Your grammar accuracy is {avg_accuracy}% with {avg_words} avg words/msg — ready for a challenge!"
    elif (avg_accuracy < 50 or avg_words < 4) and current_idx > 0:
        recommended = levels[current_idx - 1]
        reason = f"Accuracy is {avg_accuracy}% — try an easier level to build confidence."
    else:
        recommended = current_difficulty
        reason = f"Accuracy {avg_accuracy}%, {avg_words} avg words/msg — you're at the right level!"

    return {
        "current_difficulty": current_difficulty,
        "recommended_difficulty": recommended,
        "reason": reason,
        "stats": {"accuracy": avg_accuracy, "avg_words": avg_words, "sessions_analyzed": valid_count},
    }


async def get_rephrase_sentences(
    db: aiosqlite.Connection,
    conversation_id: int,
    limit: int = 5,
) -> list[dict[str, Any]] | None:
    """Extract substantive assistant sentences suitable for rephrasing practice."""
    row = await db.execute_fetchall(
        "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not row:
        return None

    rows = await db.execute_fetchall(
        "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id",
        (conversation_id,),
    )

    sentences: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in rows:
        content = r[0] if isinstance(r, (tuple, list)) else r["content"]
        parts = re.split(r'(?<=[.!?])\s+', content.strip())
        for s in parts:
            s = s.strip()
            word_count = len(s.split())
            normalized = s.lower()
            if 8 <= word_count <= 25 and normalized not in seen:
                seen.add(normalized)
                sentences.append({"text": s, "word_count": word_count})
                if len(sentences) >= limit:
                    return sentences

    return sentences


async def get_historical_session_averages(
    db: aiosqlite.Connection, *, exclude_id: int | None = None
) -> dict[str, Any]:
    """Compute average performance metrics from past ended conversations."""
    query = """
        SELECT id, summary_json FROM conversations
        WHERE status = 'ended' AND summary_json IS NOT NULL
        ORDER BY ended_at DESC LIMIT 20
    """
    rows = await db.execute_fetchall(query)

    totals: dict[str, float] = {
        "grammar_accuracy_rate": 0,
        "avg_words_per_message": 0,
        "vocabulary_diversity": 0,
        "total_user_messages": 0,
    }
    count = 0

    for row in rows:
        if exclude_id and row["id"] == exclude_id:
            continue
        try:
            summary = json.loads(row["summary_json"]) if isinstance(row["summary_json"], str) else row["summary_json"]
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(summary, dict):
            continue
        perf = summary.get("performance")
        if not isinstance(perf, dict):
            continue
        count += 1
        for key in totals:
            totals[key] += float(perf.get(key, 0))

    if count == 0:
        return {"session_count": 0, **{f"avg_{k}": 0 for k in totals}}

    return {
        "session_count": count,
        **{f"avg_{k}": round(totals[k] / count, 1) for k in totals},
    }


async def get_random_grammar_mistake(db: aiosqlite.Connection) -> dict[str, Any] | None:
    """Pick a random grammar mistake from the user's conversation history."""
    rows = await db.execute_fetchall(
        """SELECT m.content, m.feedback_json
           FROM messages m
           WHERE m.role = 'user' AND m.feedback_json IS NOT NULL
           LIMIT 5000""",
    )
    candidates: list[dict[str, Any]] = []
    for row in rows:
        try:
            feedback = json.loads(row["feedback_json"])
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(feedback, dict):
            continue
        if coerce_bool(feedback.get("is_correct", False)):
            continue
        errors = feedback.get("errors")
        if not isinstance(errors, list) or len(errors) == 0:
            continue
        corrected = feedback.get("corrected_text", "")
        for err in errors:
            if not isinstance(err, dict):
                continue
            candidates.append({
                "original_text": row["content"],
                "corrected_text": corrected or row["content"],
                "error_fragment": err.get("original", "") or err.get("fragment", ""),
                "correction": err.get("correction", ""),
                "explanation": err.get("explanation", ""),
            })
    if not candidates:
        return None
    return random.choice(candidates)


async def list_custom_topics(db: aiosqlite.Connection) -> list[dict]:
    """Return all custom topics."""
    rows = await db.execute_fetchall(
        "SELECT topic_id, label, description, scenario, goal, created_at FROM custom_topics ORDER BY created_at DESC"
    )
    return [
        {"id": r[0], "label": r[1], "description": r[2], "scenario": r[3], "goal": r[4], "created_at": r[5]}
        for r in rows
    ]


async def create_custom_topic(
    db: aiosqlite.Connection, topic_id: str, label: str, description: str, scenario: str, goal: str
) -> dict:
    """Create a new custom topic."""
    await db.execute(
        "INSERT INTO custom_topics (topic_id, label, description, scenario, goal) VALUES (?, ?, ?, ?, ?)",
        (topic_id, label, description, scenario, goal),
    )
    await db.commit()
    return {"id": topic_id, "label": label, "description": description, "scenario": scenario, "goal": goal}


async def delete_custom_topic(db: aiosqlite.Connection, topic_id: str) -> bool:
    """Delete a custom topic. Returns True if deleted."""
    cursor = await db.execute("DELETE FROM custom_topics WHERE topic_id = ?", (topic_id,))
    await db.commit()
    return cursor.rowcount > 0


async def save_self_assessment(
    db: aiosqlite.Connection,
    conversation_id: int,
    confidence: int,
    fluency: int,
    comprehension: int,
) -> dict:
    """Save or update a self-assessment for a conversation."""
    await db.execute(
        """INSERT OR REPLACE INTO conversation_self_assessments
           (conversation_id, confidence_rating, fluency_rating, comprehension_rating)
           VALUES (?, ?, ?, ?)""",
        (conversation_id, confidence, fluency, comprehension),
    )
    await db.commit()
    return {
        "conversation_id": conversation_id,
        "confidence_rating": confidence,
        "fluency_rating": fluency,
        "comprehension_rating": comprehension,
    }


async def get_self_assessment(
    db: aiosqlite.Connection,
    conversation_id: int,
) -> dict | None:
    """Retrieve a self-assessment for a conversation, or None if not found."""
    rows = await db.execute_fetchall(
        "SELECT conversation_id, confidence_rating, fluency_rating, comprehension_rating, created_at FROM conversation_self_assessments WHERE conversation_id = ?",
        (conversation_id,),
    )
    return dict(rows[0]) if rows else None


async def get_user_messages(
    db: aiosqlite.Connection,
    conversation_id: int,
    limit: int = 4,
) -> list[str] | None:
    """Return user message contents from a conversation, or None if conversation not found."""
    row = await db.execute_fetchall(
        "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not row:
        return None

    rows = await db.execute_fetchall(
        "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id LIMIT ?",
        (conversation_id, limit),
    )
    return [r[0] if isinstance(r, (tuple, list)) else r["content"] for r in rows]
