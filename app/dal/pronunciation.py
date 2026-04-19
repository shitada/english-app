"""Data access layer for pronunciation attempts."""

from __future__ import annotations

import json
import math
import re
from typing import Any

import aiosqlite

from app.utils import coerce_bool


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
                if len(sentences) >= limit:
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
    score: float | None,
    difficulty: str | None = None,
) -> int:
    clamped_score: float | None = None
    if score is not None:
        try:
            val = float(score)
            clamped_score = max(0.0, min(10.0, val)) if math.isfinite(val) else None
        except (TypeError, ValueError):
            clamped_score = None
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
    count_rows = await db.execute_fetchall(
        "SELECT COUNT(*) as total FROM pronunciation_attempts"
    )
    total = count_rows[0]["total"]
    score_rows = await db.execute_fetchall(
        """SELECT AVG(score) as avg_score, MAX(score) as best_score
           FROM pronunciation_attempts WHERE score IS NOT NULL"""
    )
    avg_score = round(score_rows[0]["avg_score"] or 0, 1)
    best_score = score_rows[0]["best_score"] or 0

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


async def get_sentence_stats(db: aiosqlite.Connection, reference_text: str) -> dict[str, Any]:
    """Get per-sentence statistics for a given reference text.

    Returns attempt_count, best_score, avg_score, and the last 5 scores.
    """
    agg_rows = await db.execute_fetchall(
        """SELECT COUNT(*) as attempt_count,
                  MAX(score) as best_score,
                  ROUND(AVG(score), 1) as avg_score
           FROM pronunciation_attempts
           WHERE reference_text = ? AND score IS NOT NULL""",
        (reference_text,),
    )
    row = agg_rows[0] if agg_rows else {}
    attempt_count = row["attempt_count"] if row["attempt_count"] else 0
    best_score = row["best_score"] if row["best_score"] is not None else 0
    avg_score = row["avg_score"] if row["avg_score"] is not None else 0

    recent_rows = await db.execute_fetchall(
        """SELECT score FROM pronunciation_attempts
           WHERE reference_text = ? AND score IS NOT NULL
           ORDER BY id DESC LIMIT 5""",
        (reference_text,),
    )
    recent_scores = [r["score"] for r in recent_rows]

    return {
        "attempt_count": attempt_count,
        "best_score": best_score,
        "avg_score": avg_score,
        "recent_scores": recent_scores,
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
        """SELECT
            COUNT(*) as total,
            COALESCE(SUM(CASE WHEN score < 3 THEN 1 ELSE 0 END), 0) as poor,
            COALESCE(SUM(CASE WHEN score >= 3 AND score < 5 THEN 1 ELSE 0 END), 0) as fair,
            COALESCE(SUM(CASE WHEN score >= 5 AND score < 7 THEN 1 ELSE 0 END), 0) as good,
            COALESCE(SUM(CASE WHEN score >= 7 AND score < 9 THEN 1 ELSE 0 END), 0) as very_good,
            COALESCE(SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END), 0) as excellent
        FROM pronunciation_attempts
        WHERE score IS NOT NULL"""
    )
    r = rows[0]
    bucket_counts = {
        "poor": r["poor"],
        "fair": r["fair"],
        "good": r["good"],
        "very_good": r["very_good"],
        "excellent": r["excellent"],
    }

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
        "total_attempts": r["total"],
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
           WHERE feedback_json IS NOT NULL
             AND created_at >= date('now', '-180 days')
           ORDER BY created_at DESC
           LIMIT 500"""
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
            if coerce_bool(wf.get("is_correct", True)):
                continue
            expected = (wf.get("expected") or wf.get("word") or "").lower().strip()
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
            heard = (wf.get("heard") or wf.get("actual") or "").lower().strip()
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
    # Compute summary from full history (not truncated by LIMIT)
    summary_row = await db.execute_fetchall(
        """SELECT COUNT(*) as total,
                  MAX(score) as best
           FROM pronunciation_attempts
           WHERE reference_text = ? AND score IS NOT NULL""",
        (reference_text,),
    )
    total = summary_row[0]["total"] if summary_row else 0

    if total > 0:
        first_row = await db.execute_fetchall(
            """SELECT score FROM pronunciation_attempts
               WHERE reference_text = ? AND score IS NOT NULL
               ORDER BY id ASC LIMIT 1""",
            (reference_text,),
        )
        latest_row = await db.execute_fetchall(
            """SELECT score FROM pronunciation_attempts
               WHERE reference_text = ? AND score IS NOT NULL
               ORDER BY id DESC LIMIT 1""",
            (reference_text,),
        )
        first_score = first_row[0]["score"]
        latest_score = latest_row[0]["score"]
        best_score = summary_row[0]["best"]
        summary = {
            "first_score": first_score,
            "latest_score": latest_score,
            "best_score": best_score,
            "attempt_count": total,
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

    # Paginated attempts list
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


async def get_common_mistake_patterns(
    db: aiosqlite.Connection, limit: int = 10
) -> list[dict[str, Any]]:
    """Aggregate phoneme-level mistake patterns from pronunciation feedback."""
    rows = await db.execute_fetchall(
        """SELECT feedback_json FROM pronunciation_attempts
           WHERE feedback_json IS NOT NULL
             AND created_at >= date('now', '-180 days')
           ORDER BY created_at DESC
           LIMIT 500"""
    )

    pattern_stats: dict[tuple[str, str], dict[str, Any]] = {}
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
            if coerce_bool(wf.get("is_correct", True)):
                continue
            phoneme_issues = wf.get("phoneme_issues") or []
            if not isinstance(phoneme_issues, list):
                continue
            expected_word = (wf.get("expected") or wf.get("word") or "").strip()
            for pi in phoneme_issues:
                if not isinstance(pi, dict):
                    continue
                target = str(pi.get("target") or pi.get("target_sound") or "").strip()
                produced = str(pi.get("produced") or pi.get("produced_sound") or "").strip()
                if not target or not produced:
                    continue
                key = (target, produced)
                if key not in pattern_stats:
                    pattern_stats[key] = {
                        "target_sound": target,
                        "produced_sound": produced,
                        "occurrence_count": 0,
                        "example_words": set(),
                    }
                pattern_stats[key]["occurrence_count"] += 1
                if expected_word:
                    pattern_stats[key]["example_words"].add(expected_word.lower())

    ranked = sorted(
        pattern_stats.values(), key=lambda x: x["occurrence_count"], reverse=True
    )[:limit]

    return [
        {
            "target_sound": p["target_sound"],
            "produced_sound": p["produced_sound"],
            "occurrence_count": p["occurrence_count"],
            "example_words": sorted(p["example_words"])[:5],
        }
        for p in ranked
    ]


# ── Minimal pairs: static curated data ──────────────────────────────

_MINIMAL_PAIRS: list[dict[str, str]] = [
    # Vowels: ɪ vs iː
    {"word_a": "ship", "word_b": "sheep", "phoneme_contrast": "ɪ / iː", "example_a": "The ship sailed across the sea.", "example_b": "The sheep grazed on the hill.", "difficulty": "beginner"},
    {"word_a": "sit", "word_b": "seat", "phoneme_contrast": "ɪ / iː", "example_a": "Please sit down.", "example_b": "Is this seat taken?", "difficulty": "beginner"},
    {"word_a": "hit", "word_b": "heat", "phoneme_contrast": "ɪ / iː", "example_a": "He hit the ball.", "example_b": "I can't stand the heat.", "difficulty": "beginner"},
    {"word_a": "fit", "word_b": "feet", "phoneme_contrast": "ɪ / iː", "example_a": "These shoes fit well.", "example_b": "My feet are tired.", "difficulty": "beginner"},
    {"word_a": "lip", "word_b": "leap", "phoneme_contrast": "ɪ / iː", "example_a": "She bit her lip.", "example_b": "The cat made a big leap.", "difficulty": "intermediate"},
    # Vowels: æ vs ɛ
    {"word_a": "bat", "word_b": "bet", "phoneme_contrast": "æ / ɛ", "example_a": "He swung the bat.", "example_b": "I bet you can do it.", "difficulty": "beginner"},
    {"word_a": "pan", "word_b": "pen", "phoneme_contrast": "æ / ɛ", "example_a": "Heat the pan first.", "example_b": "Can I borrow your pen?", "difficulty": "beginner"},
    {"word_a": "bad", "word_b": "bed", "phoneme_contrast": "æ / ɛ", "example_a": "That was a bad idea.", "example_b": "Time to go to bed.", "difficulty": "beginner"},
    {"word_a": "man", "word_b": "men", "phoneme_contrast": "æ / ɛ", "example_a": "The man waved hello.", "example_b": "The men worked together.", "difficulty": "beginner"},
    # Consonants: θ vs s
    {"word_a": "think", "word_b": "sink", "phoneme_contrast": "θ / s", "example_a": "Let me think about it.", "example_b": "Wash the dishes in the sink.", "difficulty": "intermediate"},
    {"word_a": "thick", "word_b": "sick", "phoneme_contrast": "θ / s", "example_a": "This book is very thick.", "example_b": "She felt sick this morning.", "difficulty": "intermediate"},
    {"word_a": "mouth", "word_b": "mouse", "phoneme_contrast": "θ / s", "example_a": "Open your mouth wide.", "example_b": "I saw a mouse in the kitchen.", "difficulty": "intermediate"},
    {"word_a": "path", "word_b": "pass", "phoneme_contrast": "θ / s", "example_a": "Follow the path through the park.", "example_b": "Can you pass me the salt?", "difficulty": "intermediate"},
    # Consonants: r vs l
    {"word_a": "right", "word_b": "light", "phoneme_contrast": "r / l", "example_a": "Turn right at the corner.", "example_b": "Turn on the light.", "difficulty": "beginner"},
    {"word_a": "rock", "word_b": "lock", "phoneme_contrast": "r / l", "example_a": "He sat on a rock.", "example_b": "Don't forget to lock the door.", "difficulty": "beginner"},
    {"word_a": "rice", "word_b": "lice", "phoneme_contrast": "r / l", "example_a": "I'd like some rice.", "example_b": "The school had a lice outbreak.", "difficulty": "intermediate"},
    {"word_a": "rate", "word_b": "late", "phoneme_contrast": "r / l", "example_a": "What's the exchange rate?", "example_b": "Sorry I'm late.", "difficulty": "beginner"},
    {"word_a": "red", "word_b": "led", "phoneme_contrast": "r / l", "example_a": "She wore a red dress.", "example_b": "He led the team to victory.", "difficulty": "intermediate"},
    # Consonants: b vs v
    {"word_a": "berry", "word_b": "very", "phoneme_contrast": "b / v", "example_a": "I picked a berry from the bush.", "example_b": "That's very kind of you.", "difficulty": "beginner"},
    {"word_a": "ban", "word_b": "van", "phoneme_contrast": "b / v", "example_a": "They will ban smoking here.", "example_b": "We rented a van for moving.", "difficulty": "intermediate"},
    {"word_a": "best", "word_b": "vest", "phoneme_contrast": "b / v", "example_a": "She is the best player.", "example_b": "He wore a vest under his jacket.", "difficulty": "intermediate"},
    # Consonants: n vs ŋ
    {"word_a": "thin", "word_b": "thing", "phoneme_contrast": "n / ŋ", "example_a": "The ice is too thin.", "example_b": "What's that thing over there?", "difficulty": "advanced"},
    {"word_a": "sin", "word_b": "sing", "phoneme_contrast": "n / ŋ", "example_a": "Greed is a sin.", "example_b": "She loves to sing.", "difficulty": "intermediate"},
    {"word_a": "win", "word_b": "wing", "phoneme_contrast": "n / ŋ", "example_a": "I hope we win the game.", "example_b": "The bird hurt its wing.", "difficulty": "intermediate"},
    # Vowels: ʌ vs ɑː
    {"word_a": "cut", "word_b": "cart", "phoneme_contrast": "ʌ / ɑː", "example_a": "Be careful not to cut yourself.", "example_b": "Put the items in the cart.", "difficulty": "advanced"},
    {"word_a": "hut", "word_b": "heart", "phoneme_contrast": "ʌ / ɑː", "example_a": "They stayed in a small hut.", "example_b": "Follow your heart.", "difficulty": "advanced"},
    # Mixed: f vs v
    {"word_a": "fan", "word_b": "van", "phoneme_contrast": "f / v", "example_a": "Turn on the fan.", "example_b": "The delivery van arrived.", "difficulty": "beginner"},
    {"word_a": "fine", "word_b": "vine", "phoneme_contrast": "f / v", "example_a": "The weather is fine today.", "example_b": "Grapes grow on a vine.", "difficulty": "intermediate"},
    # Consonants: p vs b
    {"word_a": "pack", "word_b": "back", "phoneme_contrast": "p / b", "example_a": "Pack your bags.", "example_b": "I'll be right back.", "difficulty": "beginner"},
    {"word_a": "pat", "word_b": "bat", "phoneme_contrast": "p / b", "example_a": "She gave the dog a pat.", "example_b": "He swung the bat hard.", "difficulty": "beginner"},
]


def get_minimal_pairs(
    difficulty: str | None = None,
    count: int = 10,
) -> list[dict[str, str]]:
    """Return randomized minimal pairs, optionally filtered by difficulty."""
    import random

    pool = _MINIMAL_PAIRS
    if difficulty:
        pool = [p for p in pool if p["difficulty"] == difficulty]
    selected = random.sample(pool, min(count, len(pool)))

    result = []
    for pair in selected:
        play_word = random.choice(["a", "b"])
        result.append({
            **pair,
            "play_word": play_word,
        })
    return result


async def save_minimal_pairs_results(
    db: aiosqlite.Connection,
    results: list[dict[str, Any]],
) -> int:
    """Batch-insert minimal pairs exercise results. Returns number of rows inserted."""
    if not results:
        return 0
    await db.executemany(
        "INSERT INTO minimal_pairs_results (phoneme_contrast, word_a, word_b, is_correct) VALUES (?, ?, ?, ?)",
        [(r["phoneme_contrast"], r["word_a"], r["word_b"], int(r["is_correct"])) for r in results],
    )
    await db.commit()
    return len(results)


async def get_phoneme_contrast_stats(
    db: aiosqlite.Connection,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Return per-phoneme-contrast accuracy aggregated across all sessions."""
    rows = await db.execute_fetchall(
        """SELECT phoneme_contrast,
                  COUNT(*) AS attempts,
                  SUM(is_correct) AS correct
           FROM minimal_pairs_results
           GROUP BY phoneme_contrast
           ORDER BY CAST(SUM(is_correct) AS REAL) / COUNT(*) ASC
           LIMIT ?""",
        (limit,),
    )
    return [
        {
            "phoneme_contrast": r["phoneme_contrast"],
            "attempts": r["attempts"],
            "correct": r["correct"],
            "accuracy": round(r["correct"] / r["attempts"] * 100, 1) if r["attempts"] else 0,
        }
        for r in rows
    ]


async def save_listening_quiz_result(
    db: aiosqlite.Connection,
    title: str,
    difficulty: str,
    total_questions: int,
    correct_count: int,
    score: float,
    topic: str = "",
    passage: str = "",
    questions_json: str = "[]",
    first_listen_correct: int = 0,
    first_listen_total: int = 0,
) -> int:
    """Save a listening quiz result and return the ID."""
    cursor = await db.execute(
        """INSERT INTO listening_quiz_results (title, difficulty, total_questions, correct_count, score, topic, passage, questions_json, first_listen_correct, first_listen_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (title, difficulty, total_questions, correct_count, score, topic, passage, questions_json,
         first_listen_correct, first_listen_total),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore[return-value]


async def get_listening_quiz_history(
    db: aiosqlite.Connection, *, limit: int = 20
) -> list[dict[str, Any]]:
    """Get recent listening quiz results ordered by most recent."""
    rows = await db.execute_fetchall(
        """SELECT id, title, difficulty, total_questions, correct_count, score, topic,
                  first_listen_correct, first_listen_total, created_at
           FROM listening_quiz_results ORDER BY created_at DESC LIMIT ?""",
        (limit,),
    )
    return [dict(r) for r in rows]


async def get_listening_quiz_detail(
    db: aiosqlite.Connection, quiz_id: int
) -> dict[str, Any] | None:
    """Get a single listening quiz result including passage and questions for replay."""
    row = await db.execute(
        """SELECT id, title, difficulty, total_questions, correct_count, score, topic, passage, questions_json,
                  first_listen_correct, first_listen_total, created_at
           FROM listening_quiz_results WHERE id = ?""",
        (quiz_id,),
    )
    result = await row.fetchone()
    if result is None:
        return None
    d = dict(result)
    import json
    try:
        d["questions"] = json.loads(d.pop("questions_json"))
    except (json.JSONDecodeError, KeyError):
        d["questions"] = []
        d.pop("questions_json", None)
    return d


async def get_listening_difficulty_recommendation(
    db: aiosqlite.Connection,
) -> dict[str, Any]:
    """Analyze recent listening quiz results and recommend a difficulty level."""
    rows = await db.execute_fetchall(
        """SELECT difficulty, score FROM listening_quiz_results
           ORDER BY created_at DESC LIMIT 10""",
    )
    results = [dict(r) for r in rows]

    if not results:
        return {
            "recommended_difficulty": "beginner",
            "current_difficulty": None,
            "reason": "No quiz history — start with beginner to build confidence",
            "stats": {"avg_score": 0, "quizzes_analyzed": 0},
        }

    current_difficulty = results[0]["difficulty"]
    same_level = [r for r in results if r["difficulty"] == current_difficulty]
    analyze = same_level[:5] if len(same_level) >= 3 else results[:5]
    avg_score = sum(r["score"] for r in analyze) / len(analyze)

    difficulty_order = ["beginner", "intermediate", "advanced"]
    idx = difficulty_order.index(current_difficulty) if current_difficulty in difficulty_order else 1

    if avg_score >= 80 and idx < 2:
        recommended = difficulty_order[idx + 1]
        reason = f"You averaged {avg_score:.0f}% on {current_difficulty} — ready to level up!"
    elif avg_score < 50 and idx > 0:
        recommended = difficulty_order[idx - 1]
        reason = f"You averaged {avg_score:.0f}% on {current_difficulty} — try an easier level to build skills"
    else:
        recommended = current_difficulty
        reason = f"You averaged {avg_score:.0f}% on {current_difficulty} — this level suits you"

    return {
        "recommended_difficulty": recommended,
        "current_difficulty": current_difficulty,
        "reason": reason,
        "stats": {"avg_score": round(avg_score, 1), "quizzes_analyzed": len(analyze)},
    }


async def get_sentence_mastery_overview(
    db: aiosqlite.Connection, min_attempts: int = 2, limit: int = 20
) -> dict[str, Any]:
    """Get mastery overview for sentences practiced multiple times."""
    rows = await db.execute_fetchall(
        """
        SELECT
            reference_text,
            COUNT(*) as attempt_count,
            MIN(score) as min_score,
            MAX(score) as best_score,
            created_at,
            score
        FROM pronunciation_attempts
        WHERE score IS NOT NULL
        GROUP BY reference_text
        HAVING COUNT(*) >= ?
        ORDER BY MAX(score) ASC
        LIMIT ?
        """,
        (min_attempts, limit * 3),  # Fetch extra to compute per-sentence stats
    )

    # Need first/latest scores per sentence - query individual attempts
    sentences: list[dict[str, Any]] = []
    seen_texts: set[str] = set()

    for row in rows:
        text = row["reference_text"]
        if text in seen_texts:
            continue
        seen_texts.add(text)

        # Get first and latest scores for this sentence
        detail_rows = await db.execute_fetchall(
            """
            SELECT score, created_at
            FROM pronunciation_attempts
            WHERE reference_text = ? AND score IS NOT NULL
            ORDER BY created_at ASC
            """,
            (text,),
        )
        if len(detail_rows) < min_attempts:
            continue

        first_score = detail_rows[0]["score"]
        latest_score = detail_rows[-1]["score"]
        best_score = max(r["score"] for r in detail_rows)
        improvement = latest_score - first_score

        if latest_score >= 8:
            status = "mastered"
        elif improvement > 1:
            status = "improving"
        else:
            status = "needs_work"

        sentences.append({
            "reference_text": text,
            "attempt_count": len(detail_rows),
            "first_score": round(first_score, 1),
            "latest_score": round(latest_score, 1),
            "best_score": round(best_score, 1),
            "improvement": round(improvement, 1),
            "status": status,
        })

    # Sort by latest_score ascending (weakest first)
    sentences.sort(key=lambda s: s["latest_score"])
    sentences = sentences[:limit]

    mastered_count = sum(1 for s in sentences if s["status"] == "mastered")
    improving_count = sum(1 for s in sentences if s["status"] == "improving")
    needs_work_count = sum(1 for s in sentences if s["status"] == "needs_work")

    return {
        "sentences": sentences,
        "total_count": len(sentences),
        "mastered_count": mastered_count,
        "improving_count": improving_count,
        "needs_work_count": needs_work_count,
    }


async def save_speaking_journal_entry(
    db: aiosqlite.Connection,
    prompt: str,
    transcript: str,
    word_count: int,
    unique_word_count: int,
    duration_seconds: int,
    wpm: float,
    filler_word_count: int = 0,
) -> dict:
    """Save a speaking journal entry."""
    cursor = await db.execute(
        """INSERT INTO speaking_journal (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, filler_word_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (prompt, transcript, word_count, unique_word_count, duration_seconds, wpm, filler_word_count),
    )
    await db.commit()
    return {"id": cursor.lastrowid}


async def get_speaking_journal_entries(
    db: aiosqlite.Connection, limit: int = 10
) -> list[dict]:
    """Get recent speaking journal entries."""
    cursor = await db.execute(
        """SELECT id, prompt, transcript, word_count, unique_word_count,
                  duration_seconds, wpm, created_at, COALESCE(filler_word_count, 0)
           FROM speaking_journal ORDER BY created_at DESC LIMIT ?""",
        (limit,),
    )
    rows = await cursor.fetchall()
    return [
        {
            "id": row[0],
            "prompt": row[1],
            "transcript": row[2],
            "word_count": row[3],
            "unique_word_count": row[4],
            "duration_seconds": row[5],
            "wpm": row[6],
            "created_at": row[7],
            "filler_word_count": row[8],
        }
        for row in rows
    ]


async def get_speaking_journal_progress(db: aiosqlite.Connection) -> dict:
    """Compute speaking journal progress analytics."""
    cursor = await db.execute(
        """SELECT id, word_count, unique_word_count, duration_seconds, wpm,
                  DATE(created_at) as entry_date, created_at
           FROM speaking_journal ORDER BY created_at ASC"""
    )
    rows = await cursor.fetchall()

    if not rows:
        return {
            "total_entries": 0,
            "total_speaking_time_seconds": 0,
            "avg_wpm": 0.0,
            "avg_vocabulary_diversity": 0.0,
            "wpm_trend": "insufficient_data",
            "entries_by_date": [],
            "longest_entry": None,
            "highest_wpm": None,
            "best_vocabulary_diversity": None,
        }

    total_entries = len(rows)
    total_time = sum(r[3] for r in rows)
    avg_wpm = round(sum(r[4] for r in rows) / total_entries, 1)

    diversities = [
        (r[2] / r[1]) if r[1] > 0 else 0.0 for r in rows
    ]
    avg_diversity = round(sum(diversities) / total_entries, 3)

    # Entries by date
    date_groups: dict[str, list] = {}
    for r in rows:
        d = r[5]
        date_groups.setdefault(d, []).append(r)

    entries_by_date = []
    for d, group in date_groups.items():
        entries_by_date.append({
            "date": d,
            "count": len(group),
            "avg_wpm": round(sum(g[4] for g in group) / len(group), 1),
            "avg_vocabulary_diversity": round(
                sum((g[2] / g[1]) if g[1] > 0 else 0.0 for g in group) / len(group), 3
            ),
        })

    # WPM trend: compare recent half vs older half
    if total_entries < 4:
        wpm_trend = "insufficient_data"
    else:
        mid = total_entries // 2
        older_avg = sum(r[4] for r in rows[:mid]) / mid
        recent_avg = sum(r[4] for r in rows[mid:]) / (total_entries - mid)
        diff_pct = ((recent_avg - older_avg) / older_avg * 100) if older_avg > 0 else 0
        if diff_pct > 5:
            wpm_trend = "improving"
        elif diff_pct < -5:
            wpm_trend = "declining"
        else:
            wpm_trend = "stable"

    # Notable entries
    longest = max(rows, key=lambda r: r[3])
    highest_wpm = max(rows, key=lambda r: r[4])
    best_diversity_idx = max(range(len(rows)), key=lambda i: diversities[i])
    best_diversity = rows[best_diversity_idx]

    def entry_summary(r: tuple) -> dict:
        return {
            "id": r[0],
            "word_count": r[1],
            "wpm": r[4],
            "duration_seconds": r[3],
            "vocabulary_diversity": round((r[2] / r[1]) if r[1] > 0 else 0.0, 3),
            "created_at": r[6],
        }

    return {
        "total_entries": total_entries,
        "total_speaking_time_seconds": total_time,
        "avg_wpm": avg_wpm,
        "avg_vocabulary_diversity": avg_diversity,
        "wpm_trend": wpm_trend,
        "entries_by_date": entries_by_date,
        "longest_entry": entry_summary(longest),
        "highest_wpm": entry_summary(highest_wpm),
        "best_vocabulary_diversity": entry_summary(best_diversity),
    }


async def get_sentences_from_corrections(
    db: aiosqlite.Connection, limit: int = 10, difficulty: str | None = None
) -> list[dict[str, str]]:
    """Extract corrected sentences from grammar feedback for pronunciation practice."""
    params: list[Any] = []
    where_clauses = ["m.role = 'user'", "m.feedback_json IS NOT NULL", "m.feedback_json != ''"]
    if difficulty:
        where_clauses.append("c.difficulty = ?")
        params.append(difficulty)
    params.append(limit * 5)  # fetch more to filter
    query = f"""SELECT m.content, m.feedback_json, c.topic, c.difficulty
           FROM messages m
           JOIN conversations c ON m.conversation_id = c.id
           WHERE {' AND '.join(where_clauses)}
           ORDER BY m.created_at DESC
           LIMIT ?"""
    rows = await db.execute_fetchall(query, params)
    sentences: list[dict[str, str]] = []
    seen: set[str] = set()
    for r in rows:
        try:
            feedback = json.loads(r["feedback_json"]) if isinstance(r["feedback_json"], str) else r["feedback_json"]
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(feedback, dict):
            continue
        corrected = feedback.get("corrected_text", "").strip()
        errors = feedback.get("errors", [])
        if not corrected or not isinstance(errors, list) or len(errors) == 0:
            continue
        # Only use corrections where there were actual errors with corrections
        has_correction = any(
            isinstance(e, dict) and e.get("correction", "").strip()
            for e in errors
        )
        if not has_correction:
            continue
        if corrected in seen:
            continue
        word_count = len(corrected.split())
        if word_count < 3 or word_count > 30:
            continue
        seen.add(corrected)
        error_types = [
            e.get("explanation", "grammar") for e in errors
            if isinstance(e, dict) and e.get("correction", "").strip()
        ]
        sentences.append({
            "text": corrected,
            "original": r["content"],
            "topic": r["topic"] or "general",
            "difficulty": r["difficulty"] or "intermediate",
            "error_type": error_types[0] if error_types else "grammar",
        })
        if len(sentences) >= limit:
            break
    return sentences


_FILLER_PATTERN = re.compile(
    r"\b(um|uh|erm|er|ah|like|you know|basically|i mean|sort of|kind of|actually|literally|right|okay so|well)\b",
    re.IGNORECASE,
)


async def get_filler_word_analysis(db: aiosqlite.Connection) -> dict:
    """Analyze filler word usage across all speaking journal entries."""
    cursor = await db.execute(
        """SELECT id, transcript, duration_seconds, created_at, DATE(created_at) as entry_date
           FROM speaking_journal ORDER BY created_at ASC"""
    )
    rows = await cursor.fetchall()

    if not rows:
        return {
            "total_entries": 0,
            "filler_breakdown": [],
            "daily_trend": [],
            "trend_direction": "insufficient_data",
            "fluency_cleanliness_score": 100,
        }

    # Aggregate filler words by type
    filler_counts: dict[str, int] = {}
    daily_data: dict[str, dict] = {}
    total_filler_count = 0
    total_duration = 0

    for row in rows:
        entry_id, transcript, duration, created_at, entry_date = row
        matches = _FILLER_PATTERN.findall(transcript)
        entry_fillers = len(matches)
        total_filler_count += entry_fillers
        total_duration += duration or 0

        for m in matches:
            word = m.lower()
            filler_counts[word] = filler_counts.get(word, 0) + 1

        if entry_date not in daily_data:
            daily_data[entry_date] = {"total_fillers": 0, "total_duration": 0, "entries": 0}
        daily_data[entry_date]["total_fillers"] += entry_fillers
        daily_data[entry_date]["total_duration"] += duration or 0
        daily_data[entry_date]["entries"] += 1

    # Ranked breakdown
    filler_breakdown = sorted(
        [{"word": w, "count": c} for w, c in filler_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )

    # Daily trend with density (fillers per minute)
    daily_trend = []
    for date, data in daily_data.items():
        density = round(data["total_fillers"] / (data["total_duration"] / 60), 2) if data["total_duration"] > 0 else 0.0
        daily_trend.append({
            "date": date,
            "filler_count": data["total_fillers"],
            "density_per_min": density,
            "entries": data["entries"],
        })

    # Determine trend by comparing first half vs second half
    trend_direction = "stable"
    if len(daily_trend) >= 4:
        mid = len(daily_trend) // 2
        first_half = daily_trend[:mid]
        second_half = daily_trend[mid:]
        avg_first = sum(d["density_per_min"] for d in first_half) / len(first_half) if first_half else 0
        avg_second = sum(d["density_per_min"] for d in second_half) / len(second_half) if second_half else 0
        if avg_second < avg_first * 0.8:
            trend_direction = "improving"
        elif avg_second > avg_first * 1.2:
            trend_direction = "declining"

    # Fluency cleanliness score (0-100)
    # Based on filler density: 0 fillers/min = 100, 10+ fillers/min = 0
    overall_density = (total_filler_count / (total_duration / 60)) if total_duration > 0 else 0
    cleanliness = max(0, min(100, round(100 - overall_density * 10)))

    return {
        "total_entries": len(rows),
        "filler_breakdown": filler_breakdown,
        "daily_trend": daily_trend,
        "trend_direction": trend_direction,
        "fluency_cleanliness_score": cleanliness,
    }


async def get_today_used_journal_prompts(db: aiosqlite.Connection) -> list[str]:
    """Return distinct prompts already used in today's speaking journal entries."""
    cursor = await db.execute(
        "SELECT DISTINCT prompt FROM speaking_journal WHERE DATE(created_at) = DATE('now')"
    )
    rows = await cursor.fetchall()
    return [row[0] for row in rows]
