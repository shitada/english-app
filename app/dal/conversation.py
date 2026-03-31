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
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List past conversations with message counts."""
    if topic:
        rows = await db.execute_fetchall(
            """SELECT c.id, c.topic, c.difficulty, c.started_at, c.ended_at, c.status,
                      COUNT(m.id) as message_count,
                      CASE WHEN c.ended_at IS NOT NULL
                           THEN CAST((julianday(c.ended_at) - julianday(c.started_at)) * 86400 AS INTEGER)
                           ELSE NULL END as duration_seconds
               FROM conversations c
               LEFT JOIN messages m ON c.id = m.conversation_id
               WHERE c.topic = ?
               GROUP BY c.id
               ORDER BY c.started_at DESC
               LIMIT ? OFFSET ?""",
            (topic, limit, offset),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT c.id, c.topic, c.difficulty, c.started_at, c.ended_at, c.status,
                      COUNT(m.id) as message_count,
                      CASE WHEN c.ended_at IS NOT NULL
                           THEN CAST((julianday(c.ended_at) - julianday(c.started_at)) * 86400 AS INTEGER)
                           ELSE NULL END as duration_seconds
               FROM conversations c
               LEFT JOIN messages m ON c.id = m.conversation_id
               GROUP BY c.id
               ORDER BY c.started_at DESC
               LIMIT ? OFFSET ?""",
            (limit, offset),
        )
    return [dict(r) for r in rows]


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
