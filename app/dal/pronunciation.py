"""Data access layer for pronunciation attempts."""

from __future__ import annotations

import json
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
        for sent in content.replace("!", ".").replace("?", ".").split("."):
            sent = sent.strip()
            if 5 <= len(sent.split()) <= 20 and sent not in seen:
                seen.add(sent)
                sentences.append({"text": sent + ".", "topic": r["topic"]})
                if len(sentences) >= 10:
                    return sentences
    return sentences


async def save_attempt(
    db: aiosqlite.Connection,
    reference_text: str,
    user_transcription: str,
    feedback: dict[str, Any],
    score: float,
) -> None:
    await db.execute(
        """INSERT INTO pronunciation_attempts
           (reference_text, user_transcription, feedback_json, score)
           VALUES (?, ?, ?, ?)""",
        (reference_text, user_transcription, json.dumps(feedback), score),
    )
    await db.commit()


async def get_history(db: aiosqlite.Connection, limit: int = 20) -> list[dict[str, Any]]:
    rows = await db.execute_fetchall(
        """SELECT reference_text, user_transcription, feedback_json, score, created_at
           FROM pronunciation_attempts
           ORDER BY created_at DESC LIMIT ?""",
        (limit,),
    )
    return [
        {
            "reference_text": r["reference_text"],
            "user_transcription": r["user_transcription"],
            "feedback": json.loads(r["feedback_json"]) if r["feedback_json"] else None,
            "score": r["score"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]
