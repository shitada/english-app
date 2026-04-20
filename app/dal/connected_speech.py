"""DAL for the Connected Speech Decoder drill.

Tracks per-attempt results on reduced/linked forms (gonna, wanna, lemme,
didja, kinda, etc.) in the ``connected_speech_attempts`` table. Provides
a pure, unit-testable ``normalize_answer`` helper used by the grader.
"""

from __future__ import annotations

import re
from typing import Any

import aiosqlite


# ---------------------------------------------------------------------------
# Normalization — pure function, unit-testable
# ---------------------------------------------------------------------------

# Casual/reduced forms that may appear in the user's answer — map to the
# expanded ("standard") multi-word equivalent so that either wording grades
# as equivalent.
_REDUCTION_MAP: dict[str, str] = {
    "gonna": "going to",
    "wanna": "want to",
    "gotta": "have got to",
    "hafta": "have to",
    "hasta": "has to",
    "lemme": "let me",
    "kinda": "kind of",
    "sorta": "sort of",
    "dunno": "do not know",
    "yaknow": "you know",
    "cmon": "come on",
    "betcha": "i bet you",
    "whatcha": "what are you",
    "didja": "did you",
    "whydja": "why did you",
    "wheredja": "where did you",
    "howdja": "how did you",
    "shoulda": "should have",
    "coulda": "could have",
    "woulda": "would have",
    "mighta": "might have",
    "musta": "must have",
}

# Contractions — also expanded so "I'm"=="I am".
_CONTRACTIONS: dict[str, str] = {
    "i'm": "i am",
    "you're": "you are",
    "we're": "we are",
    "they're": "they are",
    "he's": "he is",
    "she's": "she is",
    "it's": "it is",
    "that's": "that is",
    "what's": "what is",
    "there's": "there is",
    "let's": "let us",
    "i've": "i have",
    "you've": "you have",
    "we've": "we have",
    "they've": "they have",
    "i'd": "i would",
    "you'd": "you would",
    "he'd": "he would",
    "she'd": "she would",
    "we'd": "we would",
    "they'd": "they would",
    "i'll": "i will",
    "you'll": "you will",
    "he'll": "he will",
    "she'll": "she will",
    "we'll": "we will",
    "they'll": "they will",
    "don't": "do not",
    "doesn't": "does not",
    "didn't": "did not",
    "won't": "will not",
    "wouldn't": "would not",
    "shouldn't": "should not",
    "couldn't": "could not",
    "can't": "can not",
    "cannot": "can not",
    "isn't": "is not",
    "aren't": "are not",
    "wasn't": "was not",
    "weren't": "were not",
    "hasn't": "has not",
    "haven't": "have not",
    "hadn't": "had not",
    "would've": "would have",
    "could've": "could have",
    "should've": "should have",
    "might've": "might have",
    "must've": "must have",
}

_PUNCT_RE = re.compile(r"[^\w\s']")
_WS_RE = re.compile(r"\s+")
_TOKEN_RE = re.compile(r"[a-z']+")


def normalize_answer(text: str) -> str:
    """Normalize a phrase for the connected-speech grader.

    Steps:
    - lowercase
    - strip punctuation (except apostrophes — needed for contractions)
    - expand contractions ("I'm" -> "I am")
    - expand known reductions ("gonna" -> "going to")
    - collapse whitespace

    This is a pure function — safe to unit-test without any I/O.
    """
    if not text:
        return ""
    lower = text.lower()
    cleaned = _PUNCT_RE.sub(" ", lower)
    tokens = _TOKEN_RE.findall(cleaned)
    out: list[str] = []
    for tok in tokens:
        if tok in _CONTRACTIONS:
            out.append(_CONTRACTIONS[tok])
        elif tok in _REDUCTION_MAP:
            out.append(_REDUCTION_MAP[tok])
        else:
            out.append(tok)
    joined = " ".join(out)
    return _WS_RE.sub(" ", joined).strip()


def grade(expanded: str, user_answer: str) -> bool:
    """Return True if user's answer matches the expanded form after normalization."""
    return normalize_answer(expanded) == normalize_answer(user_answer)


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

async def insert_attempt(
    db: aiosqlite.Connection,
    *,
    reduced: str,
    expanded: str,
    user_answer: str,
    correct: bool,
    category: str | None = None,
    time_ms: int | None = None,
    user_id: int | None = None,
) -> int:
    """Insert a single connected-speech attempt and return its new row id."""
    cur = await db.execute(
        """INSERT INTO connected_speech_attempts
               (user_id, reduced, expanded, user_answer, correct, category, time_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            user_id,
            str(reduced),
            str(expanded),
            str(user_answer),
            1 if correct else 0,
            category,
            int(time_ms) if time_ms is not None else None,
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def stats_by_category(
    db: aiosqlite.Connection,
    lookback_days: int = 30,
) -> list[dict[str, Any]]:
    """Return per-category accuracy over the last ``lookback_days``.

    Each entry: ``{category, attempts, correct, accuracy}`` where
    ``accuracy`` is in [0.0, 1.0], rounded to 4 decimals.
    Rows with NULL category are grouped under "other".
    Sorted by category name for deterministic output.
    """
    days = max(1, int(lookback_days))
    rows = await db.execute_fetchall(
        f"""SELECT COALESCE(category, 'other') AS category,
                   COUNT(*) AS attempts,
                   SUM(correct) AS correct
              FROM connected_speech_attempts
             WHERE created_at >= datetime('now', '-{days} days')
             GROUP BY COALESCE(category, 'other')
             ORDER BY category ASC"""
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        attempts = int(r["attempts"] or 0)
        correct = int(r["correct"] or 0)
        accuracy = round(correct / attempts, 4) if attempts > 0 else 0.0
        out.append({
            "category": r["category"],
            "attempts": attempts,
            "correct": correct,
            "accuracy": accuracy,
        })
    return out


async def recent_streak(db: aiosqlite.Connection, window: int = 50) -> int:
    """Count how many of the most recent attempts were consecutively correct.

    Streak is computed from newest to oldest — stops at the first miss.
    """
    window = max(1, min(int(window), 500))
    rows = await db.execute_fetchall(
        f"""SELECT correct FROM connected_speech_attempts
             ORDER BY id DESC
             LIMIT {window}"""
    )
    n = 0
    for r in rows:
        if int(r["correct"] or 0) == 1:
            n += 1
        else:
            break
    return n


async def count_attempts(db: aiosqlite.Connection) -> int:
    """Total attempts recorded (used in tests)."""
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS n FROM connected_speech_attempts"
    )
    return int(rows[0]["n"]) if rows else 0
