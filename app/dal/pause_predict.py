"""DAL for the Pause & Predict listening drill.

Generates prediction items (sentence + strict prefix + expected completion) via
LLM with a curated static fallback, scores learner attempts, and persists
session aggregates to ``pause_predict_sessions``.
"""

from __future__ import annotations

import json
import logging
import random
import re
from typing import Any

import aiosqlite

from app.prompts import PAUSE_PREDICT_PROMPT

logger = logging.getLogger(__name__)


VALID_DIFFICULTIES: tuple[str, ...] = ("beginner", "intermediate", "advanced")


def normalize_difficulty(value: str | None) -> str:
    if not value:
        return "beginner"
    v = str(value).strip().lower()
    return v if v in VALID_DIFFICULTIES else "beginner"


# ---------------------------------------------------------------------------
# Static fallback bank — used when LLM is unavailable or returns junk.
# Each item has: full_sentence, prefix_text (strict prefix), expected_completion,
# alternatives (list of acceptable variants), context_hint.
# The prefix + " " + expected_completion should reproduce the full sentence
# (punctuation aside).
# ---------------------------------------------------------------------------

STATIC_BANK: dict[str, list[dict[str, Any]]] = {
    "beginner": [
        {
            "full_sentence": "I need to go to the grocery store.",
            "prefix_text": "I need to go to the grocery",
            "expected_completion": "store",
            "alternatives": ["store."],
            "context_hint": "Everyday errand",
        },
        {
            "full_sentence": "She is reading a really interesting book.",
            "prefix_text": "She is reading a really interesting",
            "expected_completion": "book",
            "alternatives": ["book.", "novel"],
            "context_hint": "What someone is doing",
        },
        {
            "full_sentence": "Please turn off the lights before you leave.",
            "prefix_text": "Please turn off the lights before you",
            "expected_completion": "leave",
            "alternatives": ["leave.", "go"],
            "context_hint": "Polite request",
        },
        {
            "full_sentence": "I will call you back in five minutes.",
            "prefix_text": "I will call you back in five",
            "expected_completion": "minutes",
            "alternatives": ["minutes.", "min"],
            "context_hint": "Phone conversation",
        },
        {
            "full_sentence": "He usually drinks coffee in the morning.",
            "prefix_text": "He usually drinks coffee in the",
            "expected_completion": "morning",
            "alternatives": ["morning.", "a.m."],
            "context_hint": "Daily routine",
        },
        {
            "full_sentence": "The train leaves from platform number three.",
            "prefix_text": "The train leaves from platform number",
            "expected_completion": "three",
            "alternatives": ["three.", "3"],
            "context_hint": "Travel announcement",
        },
        {
            "full_sentence": "Can you pass me the salt, please?",
            "prefix_text": "Can you pass me the",
            "expected_completion": "salt",
            "alternatives": ["salt?", "salt, please", "salt please"],
            "context_hint": "At the dinner table",
        },
    ],
    "intermediate": [
        {
            "full_sentence": "If you hurry, you can still catch the bus.",
            "prefix_text": "If you hurry, you can still catch the",
            "expected_completion": "bus",
            "alternatives": ["bus.", "train"],
            "context_hint": "Giving advice",
        },
        {
            "full_sentence": "Despite the rain, the festival went ahead as planned.",
            "prefix_text": "Despite the rain, the festival went ahead as",
            "expected_completion": "planned",
            "alternatives": ["planned.", "scheduled"],
            "context_hint": "News-style update",
        },
        {
            "full_sentence": "After a long day, all I want is a hot shower.",
            "prefix_text": "After a long day, all I want is a hot",
            "expected_completion": "shower",
            "alternatives": ["shower.", "bath", "meal"],
            "context_hint": "Talking about relaxing",
        },
        {
            "full_sentence": "The recipe says to bake the cake for forty minutes.",
            "prefix_text": "The recipe says to bake the cake for forty",
            "expected_completion": "minutes",
            "alternatives": ["minutes."],
            "context_hint": "Cooking instruction",
        },
        {
            "full_sentence": "She apologized for being late to the meeting.",
            "prefix_text": "She apologized for being late to the",
            "expected_completion": "meeting",
            "alternatives": ["meeting.", "call"],
            "context_hint": "Workplace situation",
        },
        {
            "full_sentence": "The coach told the team to stay focused until the final whistle.",
            "prefix_text": "The coach told the team to stay focused until the final",
            "expected_completion": "whistle",
            "alternatives": ["whistle.", "buzzer"],
            "context_hint": "Sports commentary",
        },
    ],
    "advanced": [
        {
            "full_sentence": "The committee concluded that the evidence was, at best, inconclusive.",
            "prefix_text": "The committee concluded that the evidence was, at best,",
            "expected_completion": "inconclusive",
            "alternatives": ["inconclusive.", "unclear", "ambiguous"],
            "context_hint": "Formal report",
        },
        {
            "full_sentence": "Had the warnings been heeded, the disaster could have been averted.",
            "prefix_text": "Had the warnings been heeded, the disaster could have been",
            "expected_completion": "averted",
            "alternatives": ["averted.", "prevented", "avoided"],
            "context_hint": "Editorial tone",
        },
        {
            "full_sentence": "Her argument was compelling, but ultimately unpersuasive.",
            "prefix_text": "Her argument was compelling, but ultimately",
            "expected_completion": "unpersuasive",
            "alternatives": ["unpersuasive.", "unconvincing"],
            "context_hint": "Debate feedback",
        },
        {
            "full_sentence": "The new policy is unlikely to take effect before next quarter.",
            "prefix_text": "The new policy is unlikely to take effect before next",
            "expected_completion": "quarter",
            "alternatives": ["quarter.", "year", "month"],
            "context_hint": "Business briefing",
        },
        {
            "full_sentence": "Far from being a setback, the feedback proved remarkably useful.",
            "prefix_text": "Far from being a setback, the feedback proved remarkably",
            "expected_completion": "useful",
            "alternatives": ["useful.", "helpful", "valuable"],
            "context_hint": "Reflective commentary",
        },
    ],
}


# ---------------------------------------------------------------------------
# Answer normalization + scoring
# ---------------------------------------------------------------------------

_NORMALIZE_RE = re.compile(r"[^a-z0-9\s']+")
_WS_RE = re.compile(r"\s+")


def normalize_answer(text: str | None) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    if not text:
        return ""
    s = str(text).strip().lower()
    s = _NORMALIZE_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def _is_semantic_close(user: str, expected: str) -> bool:
    """Crude check: the user answer shares the first 3+ letters of stem
    with the expected answer, or one is a substring of the other.
    Both inputs must already be normalized.
    """
    if not user or not expected:
        return False
    if user == expected:
        return True
    if len(user) >= 3 and (user in expected or expected in user):
        return True
    # compare head letters ≥ 4 chars
    prefix_len = 4
    if (
        len(user) >= prefix_len
        and len(expected) >= prefix_len
        and user[:prefix_len] == expected[:prefix_len]
    ):
        return True
    return False


def score_answer(
    user_answer: str,
    expected: str,
    alternatives: list[str] | None,
) -> dict[str, Any]:
    """Grade a single prediction attempt.

    Scoring:
        exact match          → score 1.0 (is_correct)
        alternative match    → score 0.9 (is_correct)
        semantic-close       → score 0.6 (is_close)
        otherwise            → score 0.0
    """
    user_norm = normalize_answer(user_answer)
    exp_norm = normalize_answer(expected)
    alt_norms = {normalize_answer(a) for a in (alternatives or []) if a}
    alt_norms.discard("")

    if not user_norm:
        return {
            "is_correct": False,
            "is_close": False,
            "score": 0.0,
            "expected": expected,
            "user_answer_normalized": user_norm,
            "feedback": "Please type a predicted completion.",
        }

    if user_norm == exp_norm:
        return {
            "is_correct": True,
            "is_close": False,
            "score": 1.0,
            "expected": expected,
            "user_answer_normalized": user_norm,
            "feedback": "Exact match — excellent prediction!",
        }

    if user_norm in alt_norms:
        return {
            "is_correct": True,
            "is_close": False,
            "score": 0.9,
            "expected": expected,
            "user_answer_normalized": user_norm,
            "feedback": "Accepted alternative — good prediction!",
        }

    if _is_semantic_close(user_norm, exp_norm) or any(
        _is_semantic_close(user_norm, a) for a in alt_norms
    ):
        return {
            "is_correct": False,
            "is_close": True,
            "score": 0.6,
            "expected": expected,
            "user_answer_normalized": user_norm,
            "feedback": f"Close — the expected word was '{expected}'.",
        }

    return {
        "is_correct": False,
        "is_close": False,
        "score": 0.0,
        "expected": expected,
        "user_answer_normalized": user_norm,
        "feedback": f"Not quite — the expected completion was '{expected}'.",
    }


# ---------------------------------------------------------------------------
# Item validation
# ---------------------------------------------------------------------------

def _is_strict_prefix(prefix_text: str, full_sentence: str) -> bool:
    if not prefix_text or not full_sentence:
        return False
    p = prefix_text.strip()
    f = full_sentence.strip()
    if not p or not f:
        return False
    if len(p) >= len(f):
        return False
    return f.startswith(p) and p != f


def _clean_item(raw: dict[str, Any], difficulty: str, idx: int) -> dict[str, Any] | None:
    try:
        full_sentence = str(raw.get("full_sentence") or "").strip()
        prefix_text = str(raw.get("prefix_text") or "").strip()
        expected = str(raw.get("expected_completion") or "").strip()
        alts_raw = raw.get("alternatives") or []
        if not isinstance(alts_raw, list):
            alts_raw = []
        alts = [str(a).strip() for a in alts_raw if str(a).strip()]
        context_hint = str(raw.get("context_hint") or "").strip()
    except Exception:  # noqa: BLE001
        return None

    if not full_sentence or not prefix_text or not expected:
        return None
    if not _is_strict_prefix(prefix_text, full_sentence):
        return None

    item_id = str(raw.get("id") or f"{difficulty}-{idx}").strip()
    return {
        "id": item_id,
        "full_sentence": full_sentence,
        "prefix_text": prefix_text,
        "expected_completion": expected,
        "alternatives": alts,
        "context_hint": context_hint,
    }


def _fallback_items(difficulty: str, count: int) -> list[dict[str, Any]]:
    bank = list(STATIC_BANK.get(difficulty) or STATIC_BANK["beginner"])
    random.shuffle(bank)
    chosen = bank[: max(1, count)]
    # Cycle through if the bank is smaller than the requested count.
    while len(chosen) < count:
        chosen.append(bank[len(chosen) % len(bank)])
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(chosen[:count]):
        it = _clean_item({**raw, "id": f"static-{difficulty}-{i}"}, difficulty, i)
        if it:
            out.append(it)
    return out


async def generate_items(
    copilot: Any,
    *,
    difficulty: str,
    count: int,
) -> list[dict[str, Any]]:
    """Generate ``count`` prediction items. LLM first, static bank on failure."""
    diff = normalize_difficulty(difficulty)
    n = max(1, min(int(count or 5), 10))

    system = PAUSE_PREDICT_PROMPT()
    user = (
        f"Generate {n} pause-and-predict items for a "
        f"{diff} learner. Return STRICT JSON object with key 'items', whose "
        "value is a list. Each item MUST include:\n"
        '  "full_sentence": "...",\n'
        '  "prefix_text": "...",\n'
        '  "expected_completion": "...",\n'
        '  "alternatives": ["...", "..."],\n'
        '  "context_hint": "..."\n'
        "prefix_text MUST be a strict prefix of full_sentence (full_sentence "
        "begins with prefix_text, and the remaining text is the final "
        "1-3 word chunk that expected_completion represents). "
        "Use everyday, natural English. JSON only."
    )

    raw_items: list[dict[str, Any]] = []
    try:
        raw = await copilot.ask_json(system, user, label="pause_predict_items")
        if isinstance(raw, dict):
            maybe = raw.get("items")
            if isinstance(maybe, list):
                raw_items = [r for r in maybe if isinstance(r, dict)]
            elif isinstance(raw.get("full_sentence"), str):
                raw_items = [raw]
        elif isinstance(raw, list):
            raw_items = [r for r in raw if isinstance(r, dict)]
    except Exception:  # noqa: BLE001
        logger.exception("Pause-predict generation failed; using static bank")
        raw_items = []

    cleaned: list[dict[str, Any]] = []
    for i, r in enumerate(raw_items):
        it = _clean_item(r, diff, i)
        if it:
            cleaned.append(it)
        if len(cleaned) >= n:
            break

    if len(cleaned) < n:
        filler = _fallback_items(diff, n - len(cleaned))
        cleaned.extend(filler)

    return cleaned[:n]


# ---------------------------------------------------------------------------
# DB access
# ---------------------------------------------------------------------------

async def insert_session(
    db: aiosqlite.Connection,
    *,
    difficulty: str,
    total: int,
    correct: int,
    close: int,
    avg_score: float,
    user_id: int | None = None,
) -> int:
    """Persist one completed Pause & Predict session."""
    cur = await db.execute(
        """INSERT INTO pause_predict_sessions
               (user_id, difficulty, total, correct, close, avg_score)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            user_id,
            normalize_difficulty(difficulty),
            int(total),
            int(correct),
            int(close),
            float(avg_score),
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


def _row_to_session(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "difficulty": row["difficulty"],
        "total": row["total"],
        "correct": row["correct"],
        "close": row["close"],
        "avg_score": row["avg_score"],
        "created_at": row["created_at"],
    }


async def recent_sessions(
    db: aiosqlite.Connection,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 20), 100))
    rows = await db.execute_fetchall(
        """SELECT * FROM pause_predict_sessions
            ORDER BY created_at DESC, id DESC
            LIMIT ?""",
        (limit,),
    )
    return [_row_to_session(r) for r in rows]


async def stats(db: aiosqlite.Connection) -> dict[str, Any]:
    """Return aggregate stats across all Pause & Predict sessions."""
    rows = await db.execute_fetchall(
        """SELECT
               COUNT(*) AS sessions,
               COALESCE(SUM(total), 0) AS total_items,
               COALESCE(SUM(correct), 0) AS total_correct,
               COALESCE(SUM(close), 0) AS total_close,
               COALESCE(AVG(avg_score), 0.0) AS avg_score
             FROM pause_predict_sessions"""
    )
    if not rows:
        return {
            "sessions": 0,
            "total_items": 0,
            "total_correct": 0,
            "total_close": 0,
            "avg_score": 0.0,
            "accuracy": 0.0,
        }
    r = rows[0]
    total_items = int(r["total_items"] or 0)
    total_correct = int(r["total_correct"] or 0)
    accuracy = round(total_correct / total_items, 4) if total_items else 0.0
    return {
        "sessions": int(r["sessions"] or 0),
        "total_items": total_items,
        "total_correct": total_correct,
        "total_close": int(r["total_close"] or 0),
        "avg_score": round(float(r["avg_score"] or 0.0), 4),
        "accuracy": accuracy,
    }


# Expose json for potential future feedback_json storage
__all__ = [
    "STATIC_BANK",
    "VALID_DIFFICULTIES",
    "generate_items",
    "insert_session",
    "normalize_answer",
    "normalize_difficulty",
    "recent_sessions",
    "score_answer",
    "stats",
]

# silence unused-import warning in static analyzers
_ = json
