"""Data access layer for user preferences (key-value store)."""

from __future__ import annotations

from typing import Any

import aiosqlite


async def get_all_preferences(db: aiosqlite.Connection) -> dict[str, str]:
    """Return all preferences as a key-value dict."""
    rows = await db.execute_fetchall(
        "SELECT key, value FROM user_preferences ORDER BY key"
    )
    return {r["key"]: r["value"] for r in rows}


async def get_preference(db: aiosqlite.Connection, key: str) -> str | None:
    """Get a single preference value by key."""
    rows = await db.execute_fetchall(
        "SELECT value FROM user_preferences WHERE key = ?", (key,)
    )
    return rows[0]["value"] if rows else None


async def set_preference(db: aiosqlite.Connection, key: str, value: str) -> dict[str, Any]:
    """Upsert a single preference."""
    await db.execute(
        """INSERT INTO user_preferences (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
        (key, value),
    )
    await db.commit()
    return {"key": key, "value": value}


async def set_preferences_batch(
    db: aiosqlite.Connection, prefs: dict[str, str]
) -> dict[str, str]:
    """Upsert multiple preferences at once."""
    for key, value in prefs.items():
        await db.execute(
            """INSERT INTO user_preferences (key, value, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (key, value),
        )
    await db.commit()
    return prefs


async def delete_preference(db: aiosqlite.Connection, key: str) -> bool:
    """Delete a preference. Returns True if a row was deleted."""
    cursor = await db.execute(
        "DELETE FROM user_preferences WHERE key = ?", (key,)
    )
    await db.commit()
    return cursor.rowcount > 0
