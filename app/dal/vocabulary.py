"""Data access layer for vocabulary words and progress."""

from __future__ import annotations

import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import aiosqlite

from app.utils import escape_like

# SM-2 simplified intervals (days)
SM2_INTERVALS = [0, 1, 3, 7, 14, 30, 60]


def _safe_difficulty(val: Any) -> int:
    """Coerce a difficulty value to int in range [1, 5]."""
    try:
        d = int(val)
    except (TypeError, ValueError):
        return 1
    return max(1, min(5, d))


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
    """Save LLM-generated words to DB, skipping duplicates (case-insensitive)."""
    words = []
    seen_lower: set[str] = set()
    for q in questions:
        if not isinstance(q, dict):
            continue
        word = q.get("word") or q.get("term") or ""
        meaning = q.get("correct_meaning") or q.get("meaning") or q.get("definition") or ""
        if not word or not meaning:
            continue
        word_key = word.lower()
        if word_key in seen_lower:
            continue
        seen_lower.add(word_key)
        # Check for existing word in same topic (case-insensitive)
        existing = await db.execute_fetchall(
            "SELECT id, word, meaning, example_sentence, difficulty FROM vocabulary_words WHERE topic = ? AND LOWER(word) = LOWER(?) LIMIT 1",
            (topic, word),
        )
        if existing:
            row = existing[0]
            words.append({
                "id": row["id"],
                "word": row["word"],
                "meaning": row["meaning"],
                "example_sentence": row["example_sentence"],
                "difficulty": row["difficulty"],
                "wrong_options": q.get("wrong_options") or [],
            })
        else:
            cursor = await db.execute(
                """INSERT INTO vocabulary_words (topic, word, meaning, example_sentence, difficulty)
                   VALUES (?, ?, ?, ?, ?)""",
                (topic, word, meaning, q.get("example_sentence") or "", _safe_difficulty(q.get("difficulty"))),
            )
            words.append({
                "id": cursor.lastrowid,
                "word": word,
                "meaning": meaning,
                "example_sentence": q.get("example_sentence") or "",
                "difficulty": _safe_difficulty(q.get("difficulty")),
                "wrong_options": q.get("wrong_options") or [],
            })
    await db.commit()
    return words


async def get_due_word_ids(db: aiosqlite.Connection, topic: str, count: int) -> set[int]:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    rows = await db.execute_fetchall(
        """SELECT vp.word_id
           FROM vocabulary_progress vp
           JOIN vocabulary_words vw ON vp.word_id = vw.id
           WHERE vw.topic = ? AND (vp.next_review_at IS NULL OR vp.next_review_at <= ?)
           ORDER BY vp.next_review_at ASC NULLS FIRST
           LIMIT ?""",
        (topic, now, count),
    )
    return {r["word_id"] for r in rows}


def build_quiz(words: list[dict[str, Any]], all_meanings: list[str]) -> list[dict[str, Any]]:
    """Build quiz questions with wrong options from available meanings."""
    questions = []
    for w in words:
        w_dict = dict(w)
        wrong = list({m for m in all_meanings if m != w_dict["meaning"]})
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
        # Replace whole word in sentence (case-insensitive) with ___
        if sentence:
            pattern = r"\b" + re.escape(word) + r"\b"
            blanked = re.sub(pattern, "___", sentence, flags=re.IGNORECASE)
            if blanked == sentence:
                blanked = ""
        else:
            blanked = ""
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
    now_dt = datetime.now(timezone.utc)
    now = now_dt.strftime('%Y-%m-%d %H:%M:%S')

    if progress:
        p = progress[0]
        level = min(max(p["level"], 0), len(SM2_INTERVALS) - 1)
        if is_correct:
            level = min(level + 1, len(SM2_INTERVALS) - 1)
            correct = p["correct_count"] + 1
            incorrect = p["incorrect_count"]
        else:
            level = max(level - 1, 0)
            correct = p["correct_count"]
            incorrect = p["incorrect_count"] + 1

        next_review = (now_dt + timedelta(days=SM2_INTERVALS[level])).strftime('%Y-%m-%d %H:%M:%S')
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
        next_review = (now_dt + timedelta(days=SM2_INTERVALS[level])).strftime('%Y-%m-%d %H:%M:%S')
        await db.execute(
            """INSERT INTO vocabulary_progress
               (word_id, correct_count, incorrect_count, level, last_reviewed, next_review_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(word_id) DO UPDATE SET
               correct_count = excluded.correct_count,
               incorrect_count = excluded.incorrect_count,
               level = excluded.level,
               last_reviewed = excluded.last_reviewed,
               next_review_at = excluded.next_review_at""",
            (word_id, correct, incorrect, level, now, next_review),
        )

    await log_attempt(db, word_id, is_correct)
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
               ORDER BY vp.level ASC, vw.word ASC""",
            (topic,),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT vw.word, vw.topic, vp.correct_count, vp.incorrect_count,
                      vp.level, vp.last_reviewed, vp.next_review_at
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               ORDER BY vp.level ASC, vw.word ASC""",
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
               WHERE (vp.next_review_at IS NULL OR vp.next_review_at <= ?) AND vw.topic = ?
               ORDER BY vp.next_review_at ASC NULLS FIRST
               LIMIT ?""",
            (now, topic, limit),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT vw.id, vw.word, vw.meaning, vw.topic, vp.level, vp.next_review_at
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               WHERE vp.next_review_at IS NULL OR vp.next_review_at <= ?
               ORDER BY vp.next_review_at ASC NULLS FIRST
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
        conditions.append("(word LIKE ? ESCAPE '\\' OR meaning LIKE ? ESCAPE '\\')")
        like = f"%{escape_like(query)}%"
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
               (SELECT COUNT(*) FROM vocabulary_words) as total_words,
               COUNT(*) as reviewed_words,
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
    """Delete vocabulary progress and quiz attempts. If topic is given, only for that topic."""
    if topic:
        word_filter = "word_id IN (SELECT id FROM vocabulary_words WHERE topic = ?)"
        await db.execute(f"DELETE FROM quiz_attempts WHERE {word_filter}", (topic,))
        cursor = await db.execute(
            f"DELETE FROM vocabulary_progress WHERE {word_filter}",
            (topic,),
        )
    else:
        await db.execute("DELETE FROM quiz_attempts")
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
           ORDER BY error_rate DESC, vp.level ASC, vw.id ASC
           LIMIT ?""",
        (limit,),
    )
    return [dict(r) for r in rows]


async def get_drill_words(db: aiosqlite.Connection, count: int = 10) -> list[dict[str, Any]]:
    """Get words for quick drill: prioritize due and weak words, fill with random."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    # Due words first
    due_rows = await db.execute_fetchall(
        """SELECT vw.id, vw.word, vw.meaning, vw.topic, vw.difficulty
           FROM vocabulary_progress vp
           JOIN vocabulary_words vw ON vp.word_id = vw.id
           WHERE vp.next_review_at IS NULL OR vp.next_review_at <= ?
           ORDER BY vp.next_review_at ASC NULLS FIRST
           LIMIT ?""",
        (now, count),
    )
    results = [dict(r) for r in due_rows]
    seen_ids = {r["id"] for r in results}

    if len(results) < count:
        # Weak words next
        weak_rows = await db.execute_fetchall(
            """SELECT vw.id, vw.word, vw.meaning, vw.topic, vw.difficulty
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               WHERE (vp.correct_count + vp.incorrect_count) >= 2
               ORDER BY CAST(vp.incorrect_count AS REAL) / (vp.correct_count + vp.incorrect_count) DESC
               LIMIT ?""",
            (count,),
        )
        for r in weak_rows:
            d = dict(r)
            if d["id"] not in seen_ids and len(results) < count:
                results.append(d)
                seen_ids.add(d["id"])

    if len(results) < count:
        # Fill with random words
        remaining = count - len(results)
        placeholders = ",".join("?" for _ in seen_ids) if seen_ids else "0"
        random_rows = await db.execute_fetchall(
            f"""SELECT id, word, meaning, topic, difficulty
                FROM vocabulary_words
                WHERE id NOT IN ({placeholders})
                ORDER BY RANDOM()
                LIMIT ?""",
            (*seen_ids, remaining) if seen_ids else (remaining,),
        )
        results.extend(dict(r) for r in random_rows)

    random.shuffle(results)
    return results


async def delete_word(db: aiosqlite.Connection, word_id: int) -> bool:
    """Delete a vocabulary word and its progress. Returns True if found."""
    await db.execute("DELETE FROM vocabulary_progress WHERE word_id = ?", (word_id,))
    cursor = await db.execute("DELETE FROM vocabulary_words WHERE id = ?", (word_id,))
    await db.commit()
    return cursor.rowcount > 0


async def export_words(
    db: aiosqlite.Connection, topic: str | None = None
) -> list[dict[str, Any]]:
    """Export all vocabulary words with progress data."""
    if topic:
        rows = await db.execute_fetchall(
            """SELECT vw.id, vw.word, vw.meaning, vw.example_sentence, vw.topic, vw.difficulty,
                      COALESCE(vp.correct_count, 0) as correct_count,
                      COALESCE(vp.incorrect_count, 0) as incorrect_count,
                      COALESCE(vp.level, 0) as level,
                      vp.last_reviewed, vp.next_review_at
               FROM vocabulary_words vw
               LEFT JOIN vocabulary_progress vp ON vw.id = vp.word_id
               WHERE vw.topic = ?
               ORDER BY vw.word""",
            (topic,),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT vw.id, vw.word, vw.meaning, vw.example_sentence, vw.topic, vw.difficulty,
                      COALESCE(vp.correct_count, 0) as correct_count,
                      COALESCE(vp.incorrect_count, 0) as incorrect_count,
                      COALESCE(vp.level, 0) as level,
                      vp.last_reviewed, vp.next_review_at
               FROM vocabulary_words vw
               LEFT JOIN vocabulary_progress vp ON vw.id = vp.word_id
               ORDER BY vw.topic, vw.word"""
        )
    return [dict(r) for r in rows]


async def get_review_forecast(
    db: aiosqlite.Connection, days: int = 14
) -> dict[str, Any]:
    """Get review workload forecast for the next N days."""
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    end_date = (now + timedelta(days=days - 1)).strftime("%Y-%m-%d")

    # Count overdue words (next_review_at < today)
    row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM vocabulary_progress WHERE next_review_at IS NULL OR date(next_review_at) < ?",
        (today,),
    )
    overdue_count = row[0]["cnt"] if row else 0

    # Get daily counts for today through today+(days-1)
    rows = await db.execute_fetchall(
        """SELECT date(next_review_at) as review_date, COUNT(*) as count
           FROM vocabulary_progress
           WHERE date(next_review_at) >= ? AND date(next_review_at) <= ?
           GROUP BY date(next_review_at)
           ORDER BY date(next_review_at)""",
        (today, end_date),
    )
    daily_forecast = [
        {"date": r["review_date"], "count": r["count"]} for r in rows
    ]
    total_upcoming = sum(r["count"] for r in daily_forecast)

    return {
        "overdue_count": overdue_count,
        "total_upcoming": total_upcoming,
        "daily_forecast": daily_forecast,
    }


async def get_topic_summary(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Get per-topic summary with word counts and mastery stats."""
    rows = await db.execute_fetchall(
        """SELECT vw.topic,
                  COUNT(DISTINCT vw.id) as total_words,
                  COUNT(DISTINCT vp.word_id) as reviewed_words,
                  SUM(CASE WHEN vp.level >= 3 THEN 1 ELSE 0 END) as mastered_words,
                  ROUND(AVG(vp.level), 1) as avg_level
           FROM vocabulary_words vw
           LEFT JOIN vocabulary_progress vp ON vw.id = vp.word_id
           GROUP BY vw.topic
           ORDER BY vw.topic"""
    )
    return [
        {
            "topic": r["topic"],
            "total_words": r["total_words"],
            "reviewed_words": r["reviewed_words"],
            "mastered_words": r["mastered_words"] or 0,
            "avg_level": r["avg_level"] or 0,
        }
        for r in rows
    ]


async def log_attempt(
    db: aiosqlite.Connection, word_id: int, is_correct: bool
) -> None:
    """Log a single quiz attempt to the quiz_attempts table."""
    await db.execute(
        "INSERT INTO quiz_attempts (word_id, is_correct) VALUES (?, ?)",
        (word_id, int(is_correct)),
    )


async def get_attempt_history(
    db: aiosqlite.Connection,
    word_id: int | None = None,
    topic: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Get quiz attempt history with optional filters."""
    where_clauses: list[str] = []
    params: list[Any] = []

    if word_id is not None:
        where_clauses.append("qa.word_id = ?")
        params.append(word_id)
    if topic:
        where_clauses.append("vw.topic = ?")
        params.append(topic)

    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # Count total
    count_rows = await db.execute_fetchall(
        f"""SELECT COUNT(*) as cnt FROM quiz_attempts qa
            JOIN vocabulary_words vw ON qa.word_id = vw.id
            {where_sql}""",
        params,
    )
    total_count = count_rows[0]["cnt"] if count_rows else 0

    # Get attempts
    params_with_paging = params + [limit, offset]
    rows = await db.execute_fetchall(
        f"""SELECT qa.id, qa.word_id, vw.word, vw.topic, qa.is_correct, qa.answered_at
            FROM quiz_attempts qa
            JOIN vocabulary_words vw ON qa.word_id = vw.id
            {where_sql}
            ORDER BY qa.answered_at DESC
            LIMIT ? OFFSET ?""",
        params_with_paging,
    )
    attempts = [
        {
            "id": r["id"],
            "word_id": r["word_id"],
            "word": r["word"],
            "topic": r["topic"],
            "is_correct": bool(r["is_correct"]),
            "answered_at": r["answered_at"],
        }
        for r in rows
    ]
    return {"total_count": total_count, "attempts": attempts}


async def get_topic_accuracy(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Get per-topic quiz accuracy rates."""
    rows = await db.execute_fetchall(
        """SELECT vw.topic,
                  SUM(vp.correct_count) as correct_count,
                  SUM(vp.incorrect_count) as incorrect_count,
                  SUM(vp.correct_count) + SUM(vp.incorrect_count) as total_attempts,
                  ROUND(
                      CAST(SUM(vp.correct_count) AS REAL) /
                      NULLIF(SUM(vp.correct_count) + SUM(vp.incorrect_count), 0) * 100,
                      1
                  ) as accuracy_rate
           FROM vocabulary_progress vp
           JOIN vocabulary_words vw ON vp.word_id = vw.id
           GROUP BY vw.topic
           ORDER BY accuracy_rate ASC"""
    )
    return [
        {
            "topic": r["topic"],
            "correct_count": r["correct_count"] or 0,
            "incorrect_count": r["incorrect_count"] or 0,
            "total_attempts": r["total_attempts"] or 0,
            "accuracy_rate": r["accuracy_rate"] or 0.0,
        }
        for r in rows
    ]


async def batch_import_words(
    db: aiosqlite.Connection, words: list[dict[str, Any]]
) -> dict[str, Any]:
    """Import a batch of vocabulary words, skipping case-insensitive duplicates."""
    imported = []
    skipped = 0
    for w in words:
        existing = await db.execute_fetchall(
            "SELECT id FROM vocabulary_words WHERE topic = ? AND LOWER(word) = LOWER(?) LIMIT 1",
            (w["topic"], w["word"]),
        )
        if existing:
            skipped += 1
        else:
            cursor = await db.execute(
                """INSERT INTO vocabulary_words (topic, word, meaning, example_sentence, difficulty)
                   VALUES (?, ?, ?, ?, ?)""",
                (w["topic"], w["word"], w["meaning"], w.get("example_sentence", ""), w.get("difficulty", 1)),
            )
            imported.append({
                "id": cursor.lastrowid,
                "word": w["word"],
                "meaning": w["meaning"],
                "topic": w["topic"],
            })
    await db.commit()
    return {
        "imported_count": len(imported),
        "skipped_count": skipped,
        "words": imported,
    }


async def update_word(
    db: aiosqlite.Connection,
    word_id: int,
    meaning: str | None = None,
    example_sentence: str | None = None,
    difficulty: int | None = None,
) -> dict[str, Any] | None:
    """Update a vocabulary word's meaning, example, or difficulty. Returns updated word or None."""
    updates: list[str] = []
    params: list[Any] = []
    if meaning is not None:
        updates.append("meaning = ?")
        params.append(meaning)
    if example_sentence is not None:
        updates.append("example_sentence = ?")
        params.append(example_sentence)
    if difficulty is not None:
        updates.append("difficulty = ?")
        params.append(difficulty)

    if updates:
        params.append(word_id)
        await db.execute(
            f"UPDATE vocabulary_words SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        await db.commit()

    rows = await db.execute_fetchall(
        "SELECT id, topic, word, meaning, example_sentence, difficulty FROM vocabulary_words WHERE id = ?",
        (word_id,),
    )
    return dict(rows[0]) if rows else None


async def toggle_favorite(
    db: aiosqlite.Connection, word_id: int
) -> dict[str, Any] | None:
    """Toggle a word's favorite status. Returns {word_id, is_favorite} or None."""
    cursor = await db.execute(
        "UPDATE vocabulary_words SET is_favorite = 1 - is_favorite WHERE id = ?",
        (word_id,),
    )
    if cursor.rowcount == 0:
        return None
    await db.commit()
    rows = await db.execute_fetchall(
        "SELECT is_favorite FROM vocabulary_words WHERE id = ?",
        (word_id,),
    )
    return {"word_id": word_id, "is_favorite": bool(rows[0]["is_favorite"])}


async def get_favorites(
    db: aiosqlite.Connection,
    topic: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Get favorited vocabulary words with optional topic filter."""
    where_clauses = ["is_favorite = 1"]
    params: list[Any] = []
    if topic:
        where_clauses.append("topic = ?")
        params.append(topic)

    where_sql = " AND ".join(where_clauses)

    count_rows = await db.execute_fetchall(
        f"SELECT COUNT(*) as cnt FROM vocabulary_words WHERE {where_sql}",
        params,
    )
    total = count_rows[0]["cnt"] if count_rows else 0

    params_paged = params + [limit, offset]
    rows = await db.execute_fetchall(
        f"""SELECT id, topic, word, meaning, example_sentence, difficulty
            FROM vocabulary_words
            WHERE {where_sql}
            ORDER BY word ASC
            LIMIT ? OFFSET ?""",
        params_paged,
    )
    return {
        "total_count": total,
        "words": [dict(r) for r in rows],
    }


async def update_notes(
    db: aiosqlite.Connection, word_id: int, notes: str | None
) -> bool:
    """Update or clear notes for a vocabulary word."""
    cursor = await db.execute(
        "UPDATE vocabulary_words SET notes = ? WHERE id = ?",
        (notes, word_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def get_word_with_notes(
    db: aiosqlite.Connection, word_id: int
) -> dict[str, Any] | None:
    """Get a vocabulary word including its notes."""
    rows = await db.execute_fetchall(
        "SELECT id, topic, word, meaning, example_sentence, difficulty, is_favorite, notes FROM vocabulary_words WHERE id = ?",
        (word_id,),
    )
    if not rows:
        return None
    result = dict(rows[0])
    result["is_favorite"] = bool(result.get("is_favorite", 0))
    return result


async def auto_adjust_difficulty(
    db: aiosqlite.Connection, word_id: int
) -> dict[str, Any] | None:
    """Auto-adjust word difficulty based on quiz history.

    Rules:
    - If last 5 attempts are all correct and difficulty > 1, decrease difficulty
    - If last 5 attempts have 4+ incorrect and difficulty < 5, increase difficulty
    - Returns None if no adjustment needed.
    """
    attempts = await db.execute_fetchall(
        """SELECT is_correct FROM quiz_attempts
           WHERE word_id = ? ORDER BY answered_at DESC, id DESC LIMIT 5""",
        (word_id,),
    )
    if len(attempts) < 5:
        return None

    correct_count = sum(1 for a in attempts if a["is_correct"])
    incorrect_count = len(attempts) - correct_count

    word_rows = await db.execute_fetchall(
        "SELECT id, difficulty FROM vocabulary_words WHERE id = ?",
        (word_id,),
    )
    if not word_rows:
        return None

    current_difficulty = word_rows[0]["difficulty"]
    new_difficulty = current_difficulty

    if correct_count == 5 and current_difficulty > 1:
        new_difficulty = current_difficulty - 1
    elif incorrect_count >= 4 and current_difficulty < 5:
        new_difficulty = current_difficulty + 1

    if new_difficulty != current_difficulty:
        await db.execute(
            "UPDATE vocabulary_words SET difficulty = ? WHERE id = ?",
            (new_difficulty, word_id),
        )
        await db.commit()
        return {
            "word_id": word_id,
            "old_difficulty": current_difficulty,
            "new_difficulty": new_difficulty,
            "reason": "too_easy" if new_difficulty < current_difficulty else "too_hard",
        }
    return None


async def get_similar_words(
    db: aiosqlite.Connection, word_id: int, limit: int = 5
) -> list[dict[str, Any]]:
    """Find words in the same topic with similar difficulty level."""
    word_rows = await db.execute_fetchall(
        "SELECT topic, difficulty FROM vocabulary_words WHERE id = ?",
        (word_id,),
    )
    if not word_rows:
        return []
    topic = word_rows[0]["topic"]
    difficulty = word_rows[0]["difficulty"]
    rows = await db.execute_fetchall(
        """SELECT id, word, meaning, example_sentence, difficulty
           FROM vocabulary_words
           WHERE topic = ? AND id != ? AND ABS(difficulty - ?) <= 1
           ORDER BY ABS(difficulty - ?) ASC, word ASC
           LIMIT ?""",
        (topic, word_id, difficulty, difficulty, limit),
    )
    return [dict(r) for r in rows]


async def get_srs_analytics(db: aiosqlite.Connection) -> dict[str, Any]:
    """Compute spaced repetition analytics from vocabulary progress data."""
    # Retention by level: count and accuracy at each SRS level (0-6)
    level_rows = await db.execute_fetchall(
        """SELECT level,
                  COUNT(*) as word_count,
                  SUM(correct_count) as total_correct,
                  SUM(incorrect_count) as total_incorrect
           FROM vocabulary_progress
           GROUP BY level
           ORDER BY level"""
    )
    retention_by_level = []
    for r in level_rows:
        total = r["total_correct"] + r["total_incorrect"]
        accuracy = round(r["total_correct"] / total * 100, 1) if total > 0 else 0.0
        retention_by_level.append({
            "level": r["level"],
            "word_count": r["word_count"],
            "accuracy": accuracy,
            "total_reviews": total,
        })

    # Review efficiency: avg reviews needed to reach each level
    efficiency_rows = await db.execute_fetchall(
        """SELECT level,
                  AVG(correct_count + incorrect_count) as avg_reviews
           FROM vocabulary_progress
           WHERE level > 0
           GROUP BY level
           ORDER BY level"""
    )
    review_efficiency = [
        {"level": r["level"], "avg_reviews": round(r["avg_reviews"], 2)}
        for r in efficiency_rows
    ]

    # Level progression summary (single query instead of 5)
    summary_rows = await db.execute_fetchall(
        """SELECT
               (SELECT COUNT(*) FROM vocabulary_words) as total_words,
               COUNT(*) as with_progress,
               SUM(CASE WHEN level > 0 AND level < 3 THEN 1 ELSE 0 END) as progressing,
               SUM(CASE WHEN level = 0 AND (correct_count + incorrect_count) > 0 THEN 1 ELSE 0 END) as stalled,
               SUM(CASE WHEN level >= 3 THEN 1 ELSE 0 END) as mastered
           FROM vocabulary_progress"""
    )
    s = summary_rows[0]
    not_reviewed = (s["total_words"] or 0) - (s["with_progress"] or 0)

    level_summary = {
        "total_words": s["total_words"] or 0,
        "with_progress": s["with_progress"] or 0,
        "progressing": s["progressing"] or 0,
        "stalled": s["stalled"] or 0,
        "mastered": s["mastered"] or 0,
        "not_reviewed": max(not_reviewed, 0),
    }

    # Mastery velocity: words reaching level >= 3, grouped by approximate mastery date
    velocity_rows = await db.execute_fetchall(
        """SELECT strftime('%Y-W%W', mastery_date) as week, COUNT(*) as words_mastered
           FROM (
               SELECT vp.word_id,
                   (SELECT qa.answered_at FROM quiz_attempts qa
                    WHERE qa.word_id = vp.word_id AND qa.is_correct = 1
                    ORDER BY qa.answered_at ASC, qa.id ASC
                    LIMIT 1 OFFSET 2) as mastery_date
               FROM vocabulary_progress vp WHERE vp.level >= 3
           )
           WHERE mastery_date IS NOT NULL
           GROUP BY week ORDER BY week"""
    )
    mastery_velocity = [
        {"week": r["week"], "words_mastered": r["words_mastered"]}
        for r in velocity_rows
    ]

    return {
        "retention_by_level": retention_by_level,
        "review_efficiency": review_efficiency,
        "level_summary": level_summary,
        "mastery_velocity": mastery_velocity,
    }


async def get_word_detail(
    db: aiosqlite.Connection, word_id: int
) -> dict[str, Any] | None:
    """Get full word detail including progress and notes."""
    word_rows = await db.execute_fetchall(
        """SELECT w.id, w.topic, w.word, w.meaning, w.example_sentence,
                  w.difficulty, w.is_favorite, w.notes
           FROM vocabulary_words w
           WHERE w.id = ?""",
        (word_id,),
    )
    if not word_rows:
        return None
    word = dict(word_rows[0])
    word["is_favorite"] = bool(word.get("is_favorite", 0))

    progress_rows = await db.execute_fetchall(
        """SELECT correct_count, incorrect_count, level, last_reviewed, next_review_at
           FROM vocabulary_progress WHERE word_id = ?""",
        (word_id,),
    )
    if progress_rows:
        word["progress"] = dict(progress_rows[0])
    else:
        word["progress"] = None

    word["similar_words"] = await get_similar_words(db, word_id)
    return word
