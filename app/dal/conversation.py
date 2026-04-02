"""Data access layer for conversations and messages."""

from __future__ import annotations

import json
import re
from typing import Any

import aiosqlite

from app.utils import escape_like


async def create_conversation(db: aiosqlite.Connection, topic: str, difficulty: str = "intermediate") -> int:
    cursor = await db.execute(
        "INSERT INTO conversations (topic, difficulty) VALUES (?, ?)", (topic, difficulty)
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
    feedback_json = json.dumps(feedback) if feedback else None
    cursor = await db.execute(
        "INSERT INTO messages (conversation_id, role, content, feedback_json) VALUES (?, ?, ?, ?)",
        (conversation_id, role, content, feedback_json),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore[return-value]


async def update_message_feedback(
    db: aiosqlite.Connection,
    conversation_id: int,
    role: str,
    content: str,
    feedback: dict[str, Any],
) -> None:
    await db.execute(
        """UPDATE messages SET feedback_json = ?
           WHERE id = (
               SELECT id FROM messages
               WHERE conversation_id = ? AND role = ? AND content = ?
               ORDER BY created_at DESC, id DESC LIMIT 1
           )""",
        (json.dumps(feedback), conversation_id, role, content),
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


async def get_conversation_history(
    db: aiosqlite.Connection,
    conversation_id: int,
) -> list[dict[str, Any]]:
    rows = await db.execute_fetchall(
        "SELECT id, role, content, feedback_json, is_bookmarked, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC",
        (conversation_id,),
    )
    return [dict(r) for r in rows]


async def format_history_text(db: aiosqlite.Connection, conversation_id: int) -> str:
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
    summary_json = json.dumps(summary) if summary else None
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


async def delete_ended_conversations(db: aiosqlite.Connection) -> int:
    """Delete all ended conversations. Returns count of deleted rows."""
    cursor = await db.execute(
        "DELETE FROM conversations WHERE status = 'ended'"
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


async def get_grammar_accuracy(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get grammar accuracy stats across all conversations."""
    rows = await db.execute_fetchall(
        """SELECT c.topic, m.feedback_json
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.role = 'user' AND m.feedback_json IS NOT NULL"""
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
        if feedback.get("is_correct"):
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
    """Recommend conversation topics based on practice frequency."""
    rows = await db.execute_fetchall(
        """SELECT topic, COUNT(*) as session_count,
                  MAX(started_at) as last_practiced
           FROM conversations
           GROUP BY topic"""
    )
    practiced = {row["topic"]: dict(row) for row in rows}
    recommendations = []
    for topic in all_topics:
        if topic in practiced:
            recommendations.append({
                "topic": topic,
                "session_count": practiced[topic]["session_count"],
                "last_practiced": practiced[topic]["last_practiced"],
                "reason": "continue_practice",
            })
        else:
            recommendations.append({
                "topic": topic,
                "session_count": 0,
                "last_practiced": None,
                "reason": "never_practiced",
            })
    # Sort: never practiced first, then by fewest sessions, then oldest last_practiced
    recommendations.sort(
        key=lambda r: (
            0 if r["reason"] == "never_practiced" else 1,
            r["session_count"],
            r["last_practiced"] or "",
        )
    )
    return recommendations


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
        "is_bookmarked": row["is_bookmarked"],
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
            "is_bookmarked": r["is_bookmarked"],
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

    # Get all vocabulary words
    word_rows = await db.execute_fetchall(
        """SELECT w.id, w.word, w.meaning, w.topic, w.difficulty,
                  p.level, p.correct_count, p.incorrect_count, p.next_review_at
           FROM vocabulary_words w
           LEFT JOIN vocabulary_progress p ON w.id = p.word_id"""
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
