"""Data access layer for per-topic listening speed progress (Speed Ladder mode)."""

from __future__ import annotations

import aiosqlite

# Hard clamp range (must be in sync with router validation)
MIN_SPEED = 0.5
MAX_SPEED = 2.0
DEFAULT_SPEED = 1.0


def _normalize_topic(topic: str | None) -> str:
    """Normalize a topic key — empty / None becomes the global ('') bucket."""
    return (topic or "").strip().lower()


def _clamp(speed: float) -> float:
    if speed < MIN_SPEED:
        return MIN_SPEED
    if speed > MAX_SPEED:
        return MAX_SPEED
    return float(speed)


async def get_max_speed(db: aiosqlite.Connection, topic: str | None) -> float:
    """Return the stored max speed for the given topic, or DEFAULT_SPEED if missing."""
    key = _normalize_topic(topic)
    rows = await db.execute_fetchall(
        "SELECT max_speed FROM listening_speed_progress WHERE topic = ?",
        (key,),
    )
    if not rows:
        return DEFAULT_SPEED
    try:
        return float(rows[0]["max_speed"])
    except (KeyError, TypeError, ValueError):
        return DEFAULT_SPEED


async def record_speed(
    db: aiosqlite.Connection, topic: str | None, speed: float
) -> float:
    """UPSERT a new max speed if it exceeds the stored value.

    Returns the resulting max_speed (existing if not improved, new otherwise).
    The incoming speed is clamped into [MIN_SPEED, MAX_SPEED].
    """
    key = _normalize_topic(topic)
    new_speed = _clamp(float(speed))
    current = await get_max_speed(db, key)
    if new_speed <= current:
        # Ensure a row exists at the current value (no-op if already there)
        await db.execute(
            """INSERT INTO listening_speed_progress (topic, max_speed, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(topic) DO NOTHING""",
            (key, current),
        )
        await db.commit()
        return current
    await db.execute(
        """INSERT INTO listening_speed_progress (topic, max_speed, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(topic) DO UPDATE SET
               max_speed = excluded.max_speed,
               updated_at = excluded.updated_at""",
        (key, new_speed),
    )
    await db.commit()
    return new_speed
