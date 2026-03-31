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


def build_fill_blank_quiz(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build fill-in-the-blank quiz where user types the word."""
    questions = []
    for w in words:
        w_dict = dict(w)
        word = w_dict["word"]
        sentence = w_dict.get("example_sentence", "")
        # Replace word in sentence (case-insensitive) with ___
        import re
        blanked = re.sub(re.escape(word), "___", sentence, flags=re.IGNORECASE) if sentence else ""
        hint = word[0] if word else ""
        questions.append({
            "id": w_dict["id"],
            "meaning": w_dict["meaning"],
            "example_with_blank": blanked,
            "hint": hint,
            "answer": word,
            "difficulty": w_dict.get("difficulty", 1),
        })
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
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

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


async def get_due_words(
    db: aiosqlite.Connection, topic: str | None = None, limit: int = 50
) -> list[dict[str, Any]]:
    """Return words where next_review_at <= now (due for review)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    if topic:
        rows = await db.execute_fetchall(
            """SELECT vw.id, vw.word, vw.meaning, vw.topic, vp.level, vp.next_review_at
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               WHERE vp.next_review_at <= ? AND vw.topic = ?
               ORDER BY vp.next_review_at ASC
               LIMIT ?""",
            (now, topic, limit),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT vw.id, vw.word, vw.meaning, vw.topic, vp.level, vp.next_review_at
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               WHERE vp.next_review_at <= ?
               ORDER BY vp.next_review_at ASC
               LIMIT ?""",
            (now, limit),
        )
    return [dict(r) for r in rows]


async def search_words(
    db: aiosqlite.Connection,
    query: str | None = None,
    topic: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[int, list[dict[str, Any]]]:
    """Search vocabulary words with optional filters. Returns (total_count, words)."""
    conditions = []
    params: list[Any] = []
    if query:
        conditions.append("(word LIKE ? OR meaning LIKE ?)")
        like = f"%{query}%"
        params.extend([like, like])
    if topic:
        conditions.append("topic = ?")
        params.append(topic)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    count_rows = await db.execute_fetchall(
        f"SELECT COUNT(*) as cnt FROM vocabulary_words {where}", params
    )
    total = count_rows[0]["cnt"]

    rows = await db.execute_fetchall(
        f"SELECT id, word, meaning, example_sentence, topic, difficulty FROM vocabulary_words {where} ORDER BY id DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    )
    return total, [dict(r) for r in rows]


async def get_vocabulary_stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get aggregate vocabulary mastery statistics."""
    rows = await db.execute_fetchall(
        """SELECT
               COUNT(*) as total_words,
               SUM(CASE WHEN level >= 3 THEN 1 ELSE 0 END) as total_mastered,
               SUM(correct_count + incorrect_count) as total_reviews,
               SUM(correct_count) as total_correct
           FROM vocabulary_progress"""
    )
    r = rows[0]
    total_words = r["total_words"] or 0
    total_mastered = r["total_mastered"] or 0
    total_reviews = r["total_reviews"] or 0
    total_correct = r["total_correct"] or 0
    accuracy_rate = round(total_correct / total_reviews * 100, 1) if total_reviews > 0 else 0.0

    level_rows = await db.execute_fetchall(
        "SELECT level, COUNT(*) as count FROM vocabulary_progress GROUP BY level ORDER BY level"
    )
    level_distribution = [{"level": lr["level"], "count": lr["count"]} for lr in level_rows]

    topic_rows = await db.execute_fetchall(
        """SELECT vw.topic,
                  COUNT(*) as word_count,
                  SUM(CASE WHEN vp.level >= 3 THEN 1 ELSE 0 END) as mastered_count,
                  ROUND(AVG(vp.level), 1) as avg_level
           FROM vocabulary_progress vp
           JOIN vocabulary_words vw ON vp.word_id = vw.id
           GROUP BY vw.topic
           ORDER BY vw.topic"""
    )
    topic_breakdown = [
        {
            "topic": tr["topic"],
            "word_count": tr["word_count"],
            "mastered_count": tr["mastered_count"] or 0,
            "avg_level": tr["avg_level"] or 0.0,
        }
        for tr in topic_rows
    ]

    return {
        "total_words": total_words,
        "total_mastered": total_mastered,
        "total_reviews": total_reviews,
        "accuracy_rate": accuracy_rate,
        "level_distribution": level_distribution,
        "topic_breakdown": topic_breakdown,
    }


async def reset_progress(db: aiosqlite.Connection, topic: str | None = None) -> int:
    """Delete vocabulary progress rows. If topic is given, only for that topic."""
    if topic:
        cursor = await db.execute(
            """DELETE FROM vocabulary_progress WHERE word_id IN (
                   SELECT id FROM vocabulary_words WHERE topic = ?
               )""",
            (topic,),
        )
    else:
        cursor = await db.execute("DELETE FROM vocabulary_progress")
    await db.commit()
    return cursor.rowcount


async def get_weak_words(db: aiosqlite.Connection, limit: int = 10) -> list[dict[str, Any]]:
    """Return words with highest error rate (min 2 attempts)."""
    rows = await db.execute_fetchall(
        """SELECT vw.id, vw.word, vw.meaning, vw.topic,
                  vp.correct_count, vp.incorrect_count, vp.level,
                  ROUND(CAST(vp.incorrect_count AS REAL) / (vp.correct_count + vp.incorrect_count), 2) as error_rate
           FROM vocabulary_progress vp
           JOIN vocabulary_words vw ON vp.word_id = vw.id
           WHERE (vp.correct_count + vp.incorrect_count) >= 2
           ORDER BY error_rate DESC, vp.level ASC
           LIMIT ?""",
        (limit,),
    )
    return [dict(r) for r in rows]
