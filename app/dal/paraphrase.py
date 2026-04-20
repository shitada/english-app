"""Data access layer for the Paraphrase Practice mode.

Exposes:
    - ``SENTENCES``: a curated, CEFR-leveled bank (~30 sentences).
    - ``LEVELS`` / ``normalize_level``: input validation helpers.
    - ``get_random_sentences(level, count)``: select N source sentences.
    - ``score_paraphrase(copilot, source, attempt)``: ask the LLM to grade a
      user's paraphrase and return a normalized JSON dict with safe defaults
      on any failure.

This module is intentionally pure-Python (no DB) — paraphrase practice does
not yet persist attempts.
"""

from __future__ import annotations

import logging
import random
from typing import Any

logger = logging.getLogger(__name__)


LEVELS: tuple[str, ...] = ("easy", "medium", "hard")


def normalize_level(level: str | None) -> str:
    """Return a valid CEFR-bucket level, falling back to ``easy``."""
    if not level:
        return "easy"
    lvl = str(level).strip().lower()
    return lvl if lvl in LEVELS else "easy"


# ---------------------------------------------------------------------------
# Sentence bank — CEFR-roughly leveled "easy" (A2/B1) → "hard" (B2/C1).
# Each sentence is intentionally short-to-mid length and rephraseable in
# multiple natural ways.
# ---------------------------------------------------------------------------

SENTENCES: dict[str, list[str]] = {
    "easy": [
        "I usually take the bus to work because it is cheaper.",
        "She wants to learn how to cook Italian food.",
        "We watched a movie at home last night.",
        "The weather was very cold yesterday morning.",
        "He bought a new phone because his old one broke.",
        "My sister loves reading books before she goes to bed.",
        "They are planning a short trip to the mountains.",
        "I forgot my umbrella at the office today.",
        "The coffee shop near my house is always crowded on weekends.",
        "We need to leave early so we don't miss the train.",
    ],
    "medium": [
        "Although the meeting was long, it was actually quite productive.",
        "If you finish your homework now, you can watch TV later.",
        "The new policy was introduced to reduce traffic in the city center.",
        "She has been studying English for three years and can hold a conversation easily.",
        "Even though it was raining heavily, the festival was not cancelled.",
        "He decided to take a different route because of the construction work.",
        "Most of the employees agreed that the change would benefit the company.",
        "The book she recommended turned out to be much more interesting than I expected.",
        "We should probably leave a tip even though the service was a bit slow.",
        "Despite the high price, the restaurant is fully booked every weekend.",
    ],
    "hard": [
        "The committee unanimously rejected the proposal on the grounds that it lacked sufficient evidence.",
        "Had I known about the deadline earlier, I would have submitted the report on time.",
        "The author argues that economic growth and environmental protection are not necessarily in conflict.",
        "Researchers have long suspected that sleep plays a critical role in consolidating long-term memories.",
        "Far from being a nuisance, regular code reviews tend to improve overall software quality.",
        "Not only did the policy fail to address the original issue, it actually made things worse.",
        "The minister conceded that the reforms had been implemented with insufficient public consultation.",
        "Given the complexity of the case, the judge requested additional time to review the evidence.",
        "Such was the impact of the discovery that it fundamentally reshaped the field within a decade.",
        "What surprised me most was not the result itself, but the speed at which it was achieved.",
    ],
}


def get_random_sentences(level: str, count: int = 5) -> list[dict[str, str]]:
    """Return ``count`` random source sentences for the requested level.

    Falls back to ``easy`` for unknown levels. ``count`` is clamped to
    ``[1, len(bank)]`` so callers never receive an empty list when the bank
    has at least one sentence.
    """
    lvl = normalize_level(level)
    bank = list(SENTENCES.get(lvl) or SENTENCES["easy"])
    n = max(1, min(int(count or 1), len(bank)))
    random.shuffle(bank)
    chosen = bank[:n]
    return [{"text": s, "level": lvl} for s in chosen]


# ---------------------------------------------------------------------------
# LLM scoring
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are an English teacher grading a learner's paraphrase. "
    "Score how well the rewrite preserves meaning, uses correct grammar, "
    "and sounds natural. Return STRICT JSON only — no prose, no markdown."
)

_RESPONSE_KEYS_NUMERIC = (
    "meaning_score",
    "grammar_score",
    "naturalness_score",
    "overall",
)


def _user_prompt(source: str, attempt: str) -> str:
    return (
        "Grade the following paraphrase.\n\n"
        f"ORIGINAL: {source}\n"
        f"LEARNER REWRITE: {attempt}\n\n"
        "Return JSON with these EXACT keys:\n"
        '{\n'
        '  "meaning_score": <0-100 integer, how well meaning is preserved>,\n'
        '  "grammar_score": <0-100 integer, grammatical correctness>,\n'
        '  "naturalness_score": <0-100 integer, how natural it sounds>,\n'
        '  "overall": <0-100 integer, weighted overall>,\n'
        '  "kept_meaning": <true|false>,\n'
        '  "used_different_words": <true|false, did the learner actually rephrase>,\n'
        '  "feedback": "<one short sentence of constructive feedback>",\n'
        '  "suggested_paraphrase": "<one natural paraphrase of the original>"\n'
        '}\n'
        "Be encouraging but accurate. JSON only."
    )


def _safe_defaults(source: str, attempt: str) -> dict[str, Any]:
    """Return a neutral, non-failing scoring response."""
    return {
        "meaning_score": 0,
        "grammar_score": 0,
        "naturalness_score": 0,
        "overall": 0,
        "kept_meaning": False,
        "used_different_words": bool(
            (attempt or "").strip()
            and (attempt or "").strip().lower() != (source or "").strip().lower()
        ),
        "feedback": "Could not score this attempt. Please try again.",
        "suggested_paraphrase": source or "",
    }


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(0, min(100, n))


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1", "y"}
    return default


def _normalize_response(
    raw: dict[str, Any] | None, source: str, attempt: str
) -> dict[str, Any]:
    """Coerce LLM output into the strict schema, filling defaults as needed."""
    if not isinstance(raw, dict):
        return _safe_defaults(source, attempt)

    meaning = _coerce_int(raw.get("meaning_score"))
    grammar = _coerce_int(raw.get("grammar_score"))
    naturalness = _coerce_int(raw.get("naturalness_score"))
    overall_raw = raw.get("overall")
    if overall_raw is None:
        overall = round((meaning + grammar + naturalness) / 3)
    else:
        overall = _coerce_int(overall_raw)

    feedback = str(raw.get("feedback") or "").strip()
    if not feedback:
        feedback = "Nice try — keep practicing rephrasing."

    suggested = str(raw.get("suggested_paraphrase") or "").strip()
    if not suggested:
        suggested = source or ""

    return {
        "meaning_score": meaning,
        "grammar_score": grammar,
        "naturalness_score": naturalness,
        "overall": overall,
        "kept_meaning": _coerce_bool(raw.get("kept_meaning"), default=meaning >= 60),
        "used_different_words": _coerce_bool(
            raw.get("used_different_words"),
            default=(
                bool((attempt or "").strip())
                and (attempt or "").strip().lower()
                != (source or "").strip().lower()
            ),
        ),
        "feedback": feedback,
        "suggested_paraphrase": suggested,
    }


async def score_paraphrase(
    copilot: Any,
    source: str,
    attempt: str,
) -> dict[str, Any]:
    """Ask the LLM to score a paraphrase. Returns safe defaults on any error."""
    src = (source or "").strip()
    att = (attempt or "").strip()
    if not src or not att:
        return _safe_defaults(src, att)

    try:
        raw = await copilot.ask_json(
            _SYSTEM_PROMPT,
            _user_prompt(src, att),
            label="paraphrase_score",
        )
    except Exception:  # noqa: BLE001 — robustness > granular errors here
        logger.exception("Paraphrase scoring failed; returning safe defaults")
        return _safe_defaults(src, att)

    return _normalize_response(raw, src, att)
