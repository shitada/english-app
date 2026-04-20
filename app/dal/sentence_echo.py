"""Data access layer for the Sentence Echo memory-span listening drill."""

from __future__ import annotations

from typing import Any

import aiosqlite


SPAN_LADDER: tuple[int, ...] = (6, 9, 12, 15, 18)
PASS_THRESHOLD: float = 0.90


def next_span(current: int, passed: bool) -> int:
    """Return the next span value given the current span and whether it was passed.

    If passed and there is a higher rung available, advance to that rung.
    Otherwise return the same span.
    """
    if not passed:
        return current
    for rung in SPAN_LADDER:
        if rung > current:
            return rung
    return current


async def record_attempt(
    db: aiosqlite.Connection,
    span: int,
    accuracy: float,
    passed: bool,
) -> int:
    """Insert one sentence-echo attempt and return its rowid."""
    cur = await db.execute(
        """INSERT INTO sentence_echo_attempts (span, accuracy, passed)
           VALUES (?, ?, ?)""",
        (int(span), float(accuracy), 1 if passed else 0),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_recent_span_trend(
    db: aiosqlite.Connection, days: int = 14
) -> list[dict[str, Any]]:
    """Return a daily series of (date, max_span_passed, avg_accuracy) for the
    last `days` days. Days with no attempts are omitted.
    """
    rows = await db.execute_fetchall(
        """SELECT
                date(created_at) AS day,
                MAX(CASE WHEN passed = 1 THEN span ELSE 0 END) AS max_span,
                AVG(accuracy) AS avg_accuracy,
                COUNT(*) AS attempts
           FROM sentence_echo_attempts
           WHERE created_at >= datetime('now', ?)
           GROUP BY date(created_at)
           ORDER BY day ASC""",
        (f"-{int(days)} days",),
    )
    return [
        {
            "date": r["day"],
            "max_span": int(r["max_span"] or 0),
            "avg_accuracy": float(r["avg_accuracy"] or 0.0),
            "attempts": int(r["attempts"] or 0),
        }
        for r in rows
    ]


async def get_best_span(db: aiosqlite.Connection) -> int:
    """Return the highest span the user has ever passed. 0 if none."""
    rows = await db.execute_fetchall(
        "SELECT MAX(span) AS best FROM sentence_echo_attempts WHERE passed = 1"
    )
    if not rows:
        return 0
    val = rows[0]["best"]
    return int(val) if val is not None else 0


async def count_attempts(db: aiosqlite.Connection) -> int:
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS n FROM sentence_echo_attempts"
    )
    return int(rows[0]["n"]) if rows else 0


# ---------------------------------------------------------------------------
# Word-level accuracy via Levenshtein distance on tokens.
# ---------------------------------------------------------------------------

import re

_WORD_RE = re.compile(r"[a-z0-9']+")


def tokenize_words(text: str) -> list[str]:
    return _WORD_RE.findall((text or "").lower())


def word_levenshtein(a: list[str], b: list[str]) -> int:
    """Token-level Levenshtein edit distance between two word lists."""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ai in enumerate(a, start=1):
        cur = [i] + [0] * len(b)
        for j, bj in enumerate(b, start=1):
            cost = 0 if ai == bj else 1
            cur[j] = min(
                cur[j - 1] + 1,       # insertion
                prev[j] + 1,          # deletion
                prev[j - 1] + cost,   # substitution
            )
        prev = cur
    return prev[-1]


def word_accuracy(target: str, heard: str) -> float:
    """Return word-level accuracy in [0,1] = 1 - editDistance / len(target)."""
    t = tokenize_words(target)
    h = tokenize_words(heard)
    if not t:
        return 0.0
    dist = word_levenshtein(t, h)
    acc = 1.0 - dist / len(t)
    if acc < 0.0:
        return 0.0
    if acc > 1.0:
        return 1.0
    return acc
