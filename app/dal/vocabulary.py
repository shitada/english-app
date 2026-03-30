"""Data access layer for vocabulary words and progress."""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any

import aiosqlite

# SM-2 simplified intervals (days)
SM2_INTERVALS = [0, 1, 3, 7, 14, 30, 60]


async def get_words_by_topic(db: aiosqlite.Connection, topic: str) -> list[dict[str, Any]]:
    rows = await db.execute_fetchall(
        "SELECT id, word, meaning, example_sentence, difficulty FROM vocabulary_words WHERE topic = ?",
        (topic,),
    )
    return [dict(r) for r in rows]


async def save_words(
    db: aiosqlite.Connection,
    topic: str,
    questions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Save LLM-generated words to DB and return them with IDs."""
    words = []
    for q in questions:
        cursor = await db.execute(
            """INSERT INTO vocabulary_words (topic, word, meaning, example_sentence, difficulty)
               VALUES (?, ?, ?, ?, ?)""",
            (topic, q["word"], q["correct_meaning"], q.get("example_sentence", ""), q.get("difficulty", 1)),
        )
        words.append({
            "id": cursor.lastrowid,
            "word": q["word"],
            "meaning": q["correct_meaning"],
            "example_sentence": q.get("example_sentence", ""),
            "difficulty": q.get("difficulty", 1),
            "wrong_options": q.get("wrong_options", []),
        })
    await db.commit()
    return words


async def get_due_word_ids(db: aiosqlite.Connection, topic: str, count: int) -> set[int]:
    rows = await db.execute_fetchall(
        """SELECT vp.word_id
           FROM vocabulary_progress vp
           JOIN vocabulary_words vw ON vp.word_id = vw.id
           WHERE vw.topic = ?
           ORDER BY vp.next_review_at ASC NULLS FIRST
           LIMIT ?""",
        (topic, count),
    )
    return {r["word_id"] for r in rows}


def build_quiz(words: list[dict[str, Any]], all_meanings: list[str]) -> list[dict[str, Any]]:
    """Build quiz questions with wrong options from available meanings."""
    questions = []
    for w in words:
        w_dict = dict(w)
        wrong = [m for m in all_meanings if m != w_dict["meaning"]]
        random.shuffle(wrong)
        w_dict["wrong_options"] = wrong[:3]
        questions.append(w_dict)
    return questions


async def get_word(db: aiosqlite.Connection, word_id: int) -> dict | None:
    rows = await db.execute_fetchall("SELECT * FROM vocabulary_words WHERE id = ?", (word_id,))
    return dict(rows[0]) if rows else None


async def update_progress(
    db: aiosqlite.Connection,
    word_id: int,
    is_correct: bool,
) -> dict[str, Any]:
    """Update spaced repetition progress and return the result."""
    progress = await db.execute_fetchall(
        "SELECT * FROM vocabulary_progress WHERE word_id = ?", (word_id,)
    )
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if progress:
        p = progress[0]
        level = p["level"]
        if is_correct:
            level = min(level + 1, len(SM2_INTERVALS) - 1)
            correct = p["correct_count"] + 1
            incorrect = p["incorrect_count"]
        else:
            level = max(level - 1, 0)
            correct = p["correct_count"]
            incorrect = p["incorrect_count"] + 1

        next_review = (datetime.now(timezone.utc) + timedelta(days=SM2_INTERVALS[level])).strftime('%Y-%m-%d %H:%M:%S')
        await db.execute(
            """UPDATE vocabulary_progress
               SET correct_count = ?, incorrect_count = ?, level = ?,
                   last_reviewed = ?, next_review_at = ?
               WHERE word_id = ?""",
            (correct, incorrect, level, now, next_review, word_id),
        )
    else:
        level = 1 if is_correct else 0
        correct = 1 if is_correct else 0
        incorrect = 0 if is_correct else 1
        next_review = (datetime.now(timezone.utc) + timedelta(days=SM2_INTERVALS[level])).strftime('%Y-%m-%d %H:%M:%S')
        await db.execute(
            """INSERT INTO vocabulary_progress
               (word_id, correct_count, incorrect_count, level, last_reviewed, next_review_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (word_id, correct, incorrect, level, now, next_review),
        )

    await db.commit()
    return {"word_id": word_id, "is_correct": is_correct, "new_level": level, "next_review": next_review}


async def get_progress(db: aiosqlite.Connection, topic: str | None = None) -> list[dict[str, Any]]:
    if topic:
        rows = await db.execute_fetchall(
            """SELECT vw.word, vw.topic, vp.correct_count, vp.incorrect_count,
                      vp.level, vp.last_reviewed, vp.next_review_at
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               WHERE vw.topic = ?
               ORDER BY vp.level ASC""",
            (topic,),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT vw.word, vw.topic, vp.correct_count, vp.incorrect_count,
                      vp.level, vp.last_reviewed, vp.next_review_at
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               ORDER BY vp.level ASC""",
        )
    return [dict(r) for r in rows]
