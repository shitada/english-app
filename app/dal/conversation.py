"""Data access layer for conversations and messages."""

from __future__ import annotations

import json
from typing import Any

import aiosqlite


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
               ORDER BY created_at DESC LIMIT 1
           )""",
        (json.dumps(feedback), conversation_id, role, content),
    )


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
        "SELECT role, content, feedback_json, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at",
        (conversation_id,),
    )
    return [dict(r) for r in rows]


async def format_history_text(db: aiosqlite.Connection, conversation_id: int) -> str:
    rows = await db.execute_fetchall(
        "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at",
        (conversation_id,),
    )
    return "\n".join(f"{r['role']}: {r['content']}" for r in rows)


async def end_conversation(
    db: aiosqlite.Connection,
    conversation_id: int,
    summary: dict[str, Any] | None = None,
) -> None:
    summary_json = json.dumps(summary) if summary else None
    await db.execute(
        "UPDATE conversations SET status = 'ended', ended_at = datetime('now'), summary_json = ? WHERE id = ?",
        (summary_json, conversation_id),
    )
    await db.commit()


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
        return json.loads(rows[0]["summary_json"])
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
            "AND m2.content LIKE '%' || ? || '%')"
        )
        params.append(keyword)

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
            ORDER BY c.started_at DESC
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
            "AND m.content LIKE '%' || ? || '%')"
        )
        params.append(keyword)

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
           ORDER BY created_at ASC""",
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
        errors = feedback.get("errors", [])
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
