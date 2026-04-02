"""Data access layer for pronunciation attempts."""

from __future__ import annotations

import json
import re
from typing import Any

import aiosqlite


async def get_sentences_from_conversations(
    db: aiosqlite.Connection, limit: int = 20, difficulty: str | None = None
) -> list[dict[str, str]]:
    params: list[Any] = []
    where_clauses = ["m.role = 'assistant'"]
    # Pre-filter by conversation difficulty when a specific difficulty is requested
    if difficulty:
        where_clauses.append("c.difficulty = ?")
        params.append(difficulty)
        fetch_limit = limit * 5
    else:
        fetch_limit = limit
    params.append(fetch_limit)
    query = f"""SELECT DISTINCT m.content, c.topic, c.difficulty
           FROM messages m
           JOIN conversations c ON m.conversation_id = c.id
           WHERE {' AND '.join(where_clauses)}
           ORDER BY m.created_at DESC
           LIMIT ?"""
    rows = await db.execute_fetchall(query, params)
    sentences: list[dict[str, str]] = []
    seen: set[str] = set()
    for r in rows:
        content = r["content"]
        conv_difficulty = r["difficulty"] or "intermediate"
        # Split on sentence boundaries, preserving trailing punctuation
        fragments = re.split(r'(?<=[.!?])\s+', content)
        for sent in fragments:
            sent = sent.strip()
            # Ensure sentence ends with punctuation
            if sent and sent[-1] not in '.!?':
                sent += '.'
            word_count = len(sent.rstrip('.!?').split())
            if 5 <= word_count <= 20 and sent not in seen:
                # Use conversation difficulty or estimate from word count
                est_difficulty = _estimate_difficulty(word_count, conv_difficulty)
                if difficulty and est_difficulty != difficulty:
                    continue
                seen.add(sent)
                sentences.append({"text": sent, "topic": r["topic"], "difficulty": est_difficulty})
                if len(sentences) >= 10:
                    return sentences
    return sentences


def _estimate_difficulty(word_count: int, conv_difficulty: str) -> str:
    """Estimate sentence difficulty from word count, falling back to conversation difficulty."""
    if word_count <= 8:
        return "beginner"
    elif word_count <= 14:
        valid_levels = {"beginner", "intermediate", "advanced"}
        return conv_difficulty if conv_difficulty in valid_levels else "intermediate"
    else:
        return "advanced"


async def save_attempt(
    db: aiosqlite.Connection,
    reference_text: str,
    user_transcription: str,
    feedback: dict[str, Any],
    score: float,
    difficulty: str | None = None,
) -> int:
    clamped_score: float | None = None
    if score is not None:
        try:
            clamped_score = max(0.0, min(10.0, float(score)))
        except (TypeError, ValueError):
            clamped_score = 0.0
    cursor = await db.execute(
        """INSERT INTO pronunciation_attempts
           (reference_text, user_transcription, feedback_json, score, difficulty)
           VALUES (?, ?, ?, ?, ?)""",
        (reference_text, user_transcription, json.dumps(feedback), clamped_score, difficulty),
    )
    await db.commit()
    return cursor.lastrowid


async def get_history(db: aiosqlite.Connection, limit: int = 20) -> list[dict[str, Any]]:
    rows = await db.execute_fetchall(
        """SELECT id, reference_text, user_transcription, feedback_json, score, difficulty, created_at
           FROM pronunciation_attempts
           ORDER BY created_at DESC, id DESC LIMIT ?""",
        (limit,),
    )
    result = []
    for r in rows:
        feedback = None
        if r["feedback_json"]:
            try:
                feedback = json.loads(r["feedback_json"])
            except (json.JSONDecodeError, TypeError):
                pass
        result.append({
            "id": r["id"],
            "reference_text": r["reference_text"],
            "user_transcription": r["user_transcription"],
            "feedback": feedback,
            "score": r["score"],
            "difficulty": r["difficulty"],
            "created_at": r["created_at"],
        })
    return result


async def get_progress(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get aggregate pronunciation progress stats."""

    # Total attempts and scores
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) as total, AVG(score) as avg_score,
                  MAX(score) as best_score
           FROM pronunciation_attempts WHERE score IS NOT NULL"""
    )
    total = rows[0]["total"]
    avg_score = round(rows[0]["avg_score"] or 0, 1)
    best_score = rows[0]["best_score"] or 0

    # Daily average scores for trend
    daily_rows = await db.execute_fetchall(
        """SELECT date(created_at) as day, AVG(score) as avg_score, COUNT(*) as count
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
           GROUP BY date(created_at)
           ORDER BY day DESC
           LIMIT 30"""
    )
    scores_by_date = [
        {"date": r["day"], "avg_score": round(r["avg_score"], 1), "count": r["count"]}
        for r in daily_rows
    ]

    # Most practiced sentences
    sentence_rows = await db.execute_fetchall(
        """SELECT reference_text, COUNT(*) as attempt_count,
                  AVG(score) as avg_score
           FROM pronunciation_attempts
           GROUP BY reference_text
           ORDER BY attempt_count DESC
           LIMIT 5"""
    )
    most_practiced = [
        {
            "text": r["reference_text"],
            "attempt_count": r["attempt_count"],
            "avg_score": round(r["avg_score"] or 0, 1),
        }
        for r in sentence_rows
    ]

    return {
        "total_attempts": total,
        "avg_score": avg_score,
        "best_score": best_score,
        "scores_by_date": scores_by_date,
        "most_practiced": most_practiced,
    }


async def clear_history(db: aiosqlite.Connection) -> int:
    """Delete all pronunciation attempts."""
    cursor = await db.execute("DELETE FROM pronunciation_attempts")
    await db.commit()
    return cursor.rowcount


async def delete_attempt(db: aiosqlite.Connection, attempt_id: int) -> bool:
    """Delete a single pronunciation attempt. Returns True if deleted."""
    cursor = await db.execute("DELETE FROM pronunciation_attempts WHERE id = ?", (attempt_id,))
    await db.commit()
    return cursor.rowcount > 0


async def get_score_trend(db: aiosqlite.Connection, window: int = 5) -> dict[str, Any]:
    """Calculate pronunciation score trend (improving/declining/stable).
    
    Compares average of last `window` attempts to the `window` before that.
    """
    rows = await db.execute_fetchall(
        "SELECT score FROM pronunciation_attempts WHERE score IS NOT NULL ORDER BY id DESC LIMIT ?",
        (window * 2,),
    )
    if len(rows) < window:
        return {"trend": "insufficient_data", "recent_avg": 0, "previous_avg": 0, "change": 0}
    
    recent = [r["score"] for r in rows[:window]]
    previous = [r["score"] for r in rows[window:]]
    recent_avg = round(sum(recent) / len(recent), 2)
    if not previous:
        return {"trend": "insufficient_data", "recent_avg": recent_avg, "previous_avg": 0, "change": 0}
    previous_avg = round(sum(previous) / len(previous), 2)
    change = round(recent_avg - previous_avg, 2)
    
    if change > 0.5:
        trend = "improving"
    elif change < -0.5:
        trend = "declining"
    else:
        trend = "stable"
    
    return {"trend": trend, "recent_avg": recent_avg, "previous_avg": previous_avg, "change": change}


_SCORE_BUCKETS = [
    ("poor", 0, 3),
    ("fair", 3, 5),
    ("good", 5, 7),
    ("very_good", 7, 9),
    ("excellent", 9, 10),
]


def _classify_score(score: float) -> str:
    """Classify a score into a quality bucket using contiguous ranges.

    Ranges: poor [0,3), fair [3,5), good [5,7), very_good [7,9), excellent [9,10].
    """
    if score < 3:
        return "poor"
    elif score < 5:
        return "fair"
    elif score < 7:
        return "good"
    elif score < 9:
        return "very_good"
    else:
        return "excellent"


async def get_score_distribution(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get pronunciation scores grouped into quality buckets."""
    rows = await db.execute_fetchall(
        "SELECT score FROM pronunciation_attempts WHERE score IS NOT NULL"
    )
    bucket_counts = {name: 0 for name, _, _ in _SCORE_BUCKETS}
    for r in rows:
        bucket = _classify_score(r["score"])
        bucket_counts[bucket] += 1

    distribution = [
        {
            "bucket": name,
            "label": name.replace("_", " ").title(),
            "min_score": lo,
            "max_score": hi,
            "count": bucket_counts[name],
        }
        for name, lo, hi in _SCORE_BUCKETS
    ]
    return {
        "total_attempts": len(rows),
        "distribution": distribution,
    }


async def get_personal_records(db: aiosqlite.Connection) -> dict[str, Any]:
    """Get pronunciation personal records (best, worst, average scores)."""
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) as total_attempts,
                  ROUND(AVG(score), 2) as avg_score,
                  MAX(score) as best_score,
                  MIN(score) as worst_score
           FROM pronunciation_attempts
           WHERE score IS NOT NULL"""
    )
    r = dict(rows[0]) if rows else {}

    # Best and worst sentences
    best_rows = await db.execute_fetchall(
        """SELECT reference_text, score, created_at
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
           ORDER BY score DESC, id ASC LIMIT 3"""
    )
    worst_rows = await db.execute_fetchall(
        """SELECT reference_text, score, created_at
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
           ORDER BY score ASC, id ASC LIMIT 3"""
    )

    return {
        "total_attempts": r.get("total_attempts", 0),
        "avg_score": r.get("avg_score") or 0,
        "best_score": r.get("best_score") or 0,
        "worst_score": r.get("worst_score") or 0,
        "best_attempts": [
            {"text": row["reference_text"], "score": row["score"], "date": row["created_at"]}
            for row in best_rows
        ],
        "worst_attempts": [
            {"text": row["reference_text"], "score": row["score"], "date": row["created_at"]}
            for row in worst_rows
        ],
    }


async def get_weekly_progress(
    db: aiosqlite.Connection, weeks: int = 8
) -> dict[str, Any]:
    """Get pronunciation score averages grouped by week."""
    rows = await db.execute_fetchall(
        """SELECT strftime('%Y-W%W', created_at) as week,
                  COUNT(*) as attempt_count,
                  ROUND(AVG(score), 2) as avg_score,
                  MAX(score) as best_score
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
             AND created_at >= datetime('now', ?)
           GROUP BY week
           ORDER BY week ASC""",
        (f"-{weeks * 7} days",),
    )
    weekly = [
        {
            "week": row["week"],
            "attempt_count": row["attempt_count"],
            "avg_score": row["avg_score"] or 0,
            "best_score": row["best_score"] or 0,
        }
        for row in rows
    ]
    # Calculate improvement trend
    if len(weekly) >= 2:
        first_avg = weekly[0]["avg_score"]
        last_avg = weekly[-1]["avg_score"]
        improvement = round(last_avg - first_avg, 2)
    else:
        improvement = 0.0

    return {
        "weeks": weekly,
        "total_weeks": len(weekly),
        "improvement": improvement,
    }


_VOCAB_DIFFICULTY_MAP = {
    1: "beginner",
    2: "beginner",
    3: "intermediate",
    4: "advanced",
    5: "advanced",
}


async def get_sentences_from_vocabulary(
    db: aiosqlite.Connection,
    limit: int = 10,
    difficulty: str | None = None,
    topic: str | None = None,
) -> list[dict[str, Any]]:
    """Get pronunciation practice sentences from vocabulary example_sentence column."""
    where_clauses = ["example_sentence IS NOT NULL", "example_sentence != ''"]
    params: list[Any] = []

    if difficulty:
        levels = [k for k, v in _VOCAB_DIFFICULTY_MAP.items() if v == difficulty]
        if levels:
            placeholders = ",".join("?" * len(levels))
            where_clauses.append(f"difficulty IN ({placeholders})")
            params.extend(levels)

    if topic:
        where_clauses.append("topic = ?")
        params.append(topic)

    params.append(limit)
    where = " AND ".join(where_clauses)

    rows = await db.execute_fetchall(
        f"""SELECT word, meaning, example_sentence, difficulty, topic
            FROM vocabulary_words
            WHERE {where}
            ORDER BY RANDOM()
            LIMIT ?""",
        params,
    )
    return [
        {
            "text": r["example_sentence"],
            "word": r["word"],
            "meaning": r["meaning"],
            "topic": r["topic"],
            "difficulty": _VOCAB_DIFFICULTY_MAP.get(r["difficulty"], "intermediate"),
        }
        for r in rows
    ]


async def get_pronunciation_weaknesses(
    db: aiosqlite.Connection, limit: int = 10
) -> list[dict[str, Any]]:
    """Aggregate commonly mispronounced words from pronunciation feedback data."""
    rows = await db.execute_fetchall(
        """SELECT feedback_json FROM pronunciation_attempts
           WHERE feedback_json IS NOT NULL"""
    )

    word_stats: dict[str, dict[str, Any]] = {}
    for r in rows:
        try:
            feedback = json.loads(r["feedback_json"])
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(feedback, dict):
            continue
        word_feedback = feedback.get("word_feedback") or []
        if not isinstance(word_feedback, list):
            continue
        for wf in word_feedback:
            if not isinstance(wf, dict):
                continue
            if wf.get("is_correct", True):
                continue
            expected = (wf.get("expected") or "").lower().strip()
            if not expected:
                continue
            if expected not in word_stats:
                word_stats[expected] = {
                    "word": expected,
                    "occurrence_count": 0,
                    "heard_as": {},
                    "tips": set(),
                }
            word_stats[expected]["occurrence_count"] += 1
            heard = (wf.get("heard") or "").lower().strip()
            if heard:
                word_stats[expected]["heard_as"][heard] = (
                    word_stats[expected]["heard_as"].get(heard, 0) + 1
                )
            tip = wf.get("tip") or ""
            if tip:
                word_stats[expected]["tips"].add(tip)

    ranked = sorted(word_stats.values(), key=lambda x: x["occurrence_count"], reverse=True)[:limit]

    return [
        {
            "word": w["word"],
            "occurrence_count": w["occurrence_count"],
            "common_heard_as": sorted(
                w["heard_as"].items(), key=lambda x: x[1], reverse=True
            )[:3],
            "tips": list(w["tips"])[:3],
        }
        for w in ranked
    ]


async def get_sentence_attempts(
    db: aiosqlite.Connection, reference_text: str, limit: int = 20
) -> dict[str, Any]:
    """Return all pronunciation attempts for a specific sentence with summary stats."""
    rows = await db.execute_fetchall(
        """SELECT id, user_transcription, score, difficulty, created_at
           FROM pronunciation_attempts
           WHERE reference_text = ?
           ORDER BY id ASC
           LIMIT ?""",
        (reference_text, limit),
    )
    attempts = [
        {
            "id": r["id"],
            "user_transcription": r["user_transcription"],
            "score": r["score"],
            "difficulty": r["difficulty"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]

    if attempts:
        scores = [a["score"] for a in attempts if a["score"] is not None]
        first_score = scores[0] if scores else 0.0
        latest_score = scores[-1] if scores else 0.0
        best_score = max(scores) if scores else 0.0
        summary = {
            "first_score": first_score,
            "latest_score": latest_score,
            "best_score": best_score,
            "attempt_count": len(attempts),
            "improvement": round(latest_score - first_score, 2),
        }
    else:
        summary = {
            "first_score": 0.0,
            "latest_score": 0.0,
            "best_score": 0.0,
            "attempt_count": 0,
            "improvement": 0.0,
        }

    return {"attempts": attempts, "summary": summary}


async def get_progress_by_difficulty(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    """Get pronunciation progress stats grouped by difficulty level."""
    rows = await db.execute_fetchall(
        """SELECT COALESCE(difficulty, 'unknown') as diff_level,
                  COUNT(*) as attempt_count,
                  ROUND(AVG(score), 1) as avg_score,
                  MAX(score) as best_score
           FROM pronunciation_attempts
           WHERE score IS NOT NULL
           GROUP BY diff_level
           ORDER BY diff_level"""
    )

    results: list[dict[str, Any]] = []
    for r in rows:
        diff_level = r["diff_level"]
        # Get latest score for this difficulty
        latest_row = await db.execute_fetchall(
            """SELECT score FROM pronunciation_attempts
               WHERE COALESCE(difficulty, 'unknown') = ? AND score IS NOT NULL
               ORDER BY created_at DESC, id DESC LIMIT 1""",
            (diff_level,),
        )
        latest_score = latest_row[0]["score"] if latest_row else 0.0
        results.append({
            "difficulty": diff_level,
            "attempt_count": r["attempt_count"],
            "avg_score": r["avg_score"] or 0.0,
            "best_score": r["best_score"] or 0.0,
            "latest_score": latest_score,
        })

    return results


async def get_retry_suggestions(
    db: aiosqlite.Connection, threshold: float = 7.0, limit: int = 10
) -> list[dict[str, Any]]:
    """Get sentences that should be re-practiced based on low latest scores."""
    rows = await db.execute_fetchall(
        """SELECT reference_text,
                  COUNT(*) as attempt_count,
                  MIN(score) as worst_score,
                  MAX(score) as best_score,
                  (SELECT pa2.score FROM pronunciation_attempts pa2
                   WHERE pa2.reference_text = pa.reference_text AND pa2.score IS NOT NULL
                   ORDER BY pa2.created_at DESC, pa2.id DESC LIMIT 1) as latest_score
           FROM pronunciation_attempts pa
           WHERE score IS NOT NULL
           GROUP BY reference_text
           HAVING latest_score < ?
           ORDER BY latest_score ASC
           LIMIT ?""",
        (threshold, limit),
    )
    return [
        {
            "text": r["reference_text"],
            "attempt_count": r["attempt_count"],
            "latest_score": r["latest_score"],
            "worst_score": r["worst_score"],
            "best_score": r["best_score"],
        }
        for r in rows
    ]
