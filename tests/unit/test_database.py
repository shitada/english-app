"""Unit tests for database schema and operations."""

import pytest
import aiosqlite
from app.database import SCHEMA


@pytest.mark.asyncio
async def test_schema_creates_tables(test_db: aiosqlite.Connection):
    """Verify all tables are created by the schema."""
    rows = await test_db.execute_fetchall(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = {r["name"] for r in rows}
    assert "conversations" in tables
    assert "messages" in tables
    assert "pronunciation_attempts" in tables
    assert "vocabulary_words" in tables
    assert "vocabulary_progress" in tables


@pytest.mark.asyncio
async def test_insert_conversation(test_db: aiosqlite.Connection):
    cursor = await test_db.execute(
        "INSERT INTO conversations (topic) VALUES (?)", ("business",)
    )
    assert cursor.lastrowid is not None
    await test_db.commit()

    rows = await test_db.execute_fetchall("SELECT * FROM conversations WHERE id = ?", (cursor.lastrowid,))
    assert len(rows) == 1
    assert rows[0]["topic"] == "business"
    assert rows[0]["status"] == "active"


@pytest.mark.asyncio
async def test_insert_message(test_db: aiosqlite.Connection):
    cursor = await test_db.execute("INSERT INTO conversations (topic) VALUES (?)", ("daily",))
    conv_id = cursor.lastrowid
    await test_db.commit()

    await test_db.execute(
        "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
        (conv_id, "user", "Hello there"),
    )
    await test_db.commit()

    rows = await test_db.execute_fetchall("SELECT * FROM messages WHERE conversation_id = ?", (conv_id,))
    assert len(rows) == 1
    assert rows[0]["role"] == "user"
    assert rows[0]["content"] == "Hello there"


@pytest.mark.asyncio
async def test_message_role_constraint(test_db: aiosqlite.Connection):
    cursor = await test_db.execute("INSERT INTO conversations (topic) VALUES (?)", ("test",))
    conv_id = cursor.lastrowid
    await test_db.commit()

    with pytest.raises(aiosqlite.IntegrityError):
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
            (conv_id, "invalid_role", "test"),
        )


@pytest.mark.asyncio
async def test_foreign_key_constraint(test_db: aiosqlite.Connection):
    with pytest.raises(aiosqlite.IntegrityError):
        await test_db.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
            (99999, "user", "orphan message"),
        )


@pytest.mark.asyncio
async def test_vocabulary_word_insert(test_db: aiosqlite.Connection):
    cursor = await test_db.execute(
        "INSERT INTO vocabulary_words (topic, word, meaning, example_sentence, difficulty) VALUES (?, ?, ?, ?, ?)",
        ("business", "agenda", "a list of items to discuss", "Let's review the agenda.", 1),
    )
    word_id = cursor.lastrowid
    await test_db.commit()

    rows = await test_db.execute_fetchall("SELECT * FROM vocabulary_words WHERE id = ?", (word_id,))
    assert len(rows) == 1
    assert rows[0]["word"] == "agenda"


@pytest.mark.asyncio
async def test_vocabulary_progress_tracking(test_db: aiosqlite.Connection):
    cursor = await test_db.execute(
        "INSERT INTO vocabulary_words (topic, word, meaning) VALUES (?, ?, ?)",
        ("daily", "hello", "a greeting"),
    )
    word_id = cursor.lastrowid
    await test_db.commit()

    await test_db.execute(
        "INSERT INTO vocabulary_progress (word_id, correct_count, incorrect_count, level) VALUES (?, ?, ?, ?)",
        (word_id, 3, 1, 2),
    )
    await test_db.commit()

    rows = await test_db.execute_fetchall("SELECT * FROM vocabulary_progress WHERE word_id = ?", (word_id,))
    assert len(rows) == 1
    assert rows[0]["correct_count"] == 3
    assert rows[0]["level"] == 2


@pytest.mark.asyncio
async def test_pronunciation_attempt_insert(test_db: aiosqlite.Connection):
    await test_db.execute(
        "INSERT INTO pronunciation_attempts (reference_text, user_transcription, score) VALUES (?, ?, ?)",
        ("Hello world.", "Hello word.", 7.5),
    )
    await test_db.commit()

    rows = await test_db.execute_fetchall("SELECT * FROM pronunciation_attempts")
    assert len(rows) == 1
    assert rows[0]["score"] == 7.5
