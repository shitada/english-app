"""SQLite database setup and schema management."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import aiosqlite
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "english_app.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'intermediate',
    summary_json TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    feedback_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pronunciation_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_text TEXT NOT NULL,
    user_transcription TEXT NOT NULL,
    feedback_json TEXT,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vocabulary_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    example_sentence TEXT,
    difficulty INTEGER NOT NULL DEFAULT 1,
    is_favorite INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vocabulary_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0,
    incorrect_count INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 0,
    last_reviewed TEXT,
    next_review_at TEXT,
    FOREIGN KEY (word_id) REFERENCES vocabulary_words(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_topic ON vocabulary_words(topic);
CREATE INDEX IF NOT EXISTS idx_vocabulary_progress_word ON vocabulary_progress(word_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_progress_review ON vocabulary_progress(next_review_at);
CREATE INDEX IF NOT EXISTS idx_vocabulary_progress_word_review ON vocabulary_progress(word_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_pron_attempts_created ON pronunciation_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    is_correct INTEGER NOT NULL,
    answered_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (word_id) REFERENCES vocabulary_words(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_word ON quiz_attempts(word_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_answered ON quiz_attempts(answered_at DESC);
"""

# ---------------------------------------------------------------------------
# Migrations — each entry is an (description, SQL) tuple.
# These handle schema changes for EXISTING databases where CREATE TABLE IF NOT
# EXISTS will NOT add new columns. Add new migrations to the END of the list.
# ---------------------------------------------------------------------------
_MIGRATIONS: list[tuple[str, str]] = [
    (
        "add difficulty column to conversations",
        "ALTER TABLE conversations ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'intermediate'",
    ),
    (
        "add summary_json column to conversations",
        "ALTER TABLE conversations ADD COLUMN summary_json TEXT",
    ),
    (
        "add is_favorite column to vocabulary_words",
        "ALTER TABLE vocabulary_words ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
    ),
]


async def _apply_migrations(db: aiosqlite.Connection) -> None:
    """Apply pending migrations to an existing database.

    Each migration is attempted independently. If it fails (e.g. column already
    exists), the error is silently ignored — this makes migrations idempotent.
    """
    for desc, sql in _MIGRATIONS:
        try:
            await db.execute(sql)
            logger.info("Migration applied: %s", desc)
        except Exception:
            # Already applied (e.g. "duplicate column name") — skip silently
            pass
    await db.commit()


async def get_db() -> aiosqlite.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def get_db_session() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency that yields a DB connection and auto-closes it."""
    db = await get_db()
    try:
        yield db
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def init_db() -> None:
    db = await get_db()
    try:
        await db.executescript(SCHEMA)
        await db.commit()
        await _apply_migrations(db)
    finally:
        await db.close()
