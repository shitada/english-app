"""Shared utility functions."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from difflib import SequenceMatcher
from typing import Any, TypeVar

from fastapi import HTTPException

logger = logging.getLogger(__name__)

T = TypeVar("T")

_BACKOFF_DELAYS = [1, 3]  # seconds between retries


async def safe_llm_call(
    coro_or_factory: Awaitable[T] | Callable[[], Awaitable[T]],
    *,
    context: str,
    max_retries: int = 2,
) -> T:
    """Execute an LLM coroutine with retry and standardized error handling.

    Args:
        coro_or_factory: An awaitable or a zero-arg callable that returns one.
            A callable is needed for retries (awaitables can only be awaited once).
        context: Description for log messages.
        max_retries: How many times to retry after the first failure (default 2,
            so up to 3 total attempts). Set to 0 for no retries.
    """
    attempts = max_retries + 1
    last_exc: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            if callable(coro_or_factory) and not asyncio.isfuture(coro_or_factory) and not asyncio.iscoroutine(coro_or_factory):
                return await coro_or_factory()
            else:
                return await coro_or_factory  # type: ignore[misc]
        except Exception as e:
            last_exc = e
            if attempt < attempts:
                delay = _BACKOFF_DELAYS[min(attempt - 1, len(_BACKOFF_DELAYS) - 1)]
                logger.warning(
                    "LLM retry %d/%d in %s: %s (waiting %ds)",
                    attempt, attempts, context, e, delay,
                )
                await asyncio.sleep(delay)
            else:
                logger.error("LLM error in %s after %d attempts: %s", context, attempts, e)

    raise HTTPException(status_code=502, detail="AI service temporarily unavailable")


def clamp_score(val: Any, lo: float = 1.0, hi: float = 10.0) -> float:
    """Convert *val* to float clamped between *lo* and *hi*.

    Falls back to 5.0 when the value cannot be converted to a number.
    """
    try:
        return min(hi, max(lo, float(val)))
    except (TypeError, ValueError):
        return 5.0


def get_topic_label(topics: list[dict[str, Any]], topic_id: str) -> str:
    """Look up a topic's display label by its ID. Returns the ID if not found."""
    for t in topics:
        if t["id"] == topic_id:
            return t["label"]
    return topic_id


def extract_role(scenario: str) -> str:
    """Extract the AI role from a scenario string like 'You are a hotel clerk. The user is...'."""
    first_sentence = scenario.split(".")[0].strip()
    prefix = "You are "
    if first_sentence.startswith(prefix):
        return first_sentence[len(prefix):]
    return first_sentence


def validate_topic(topics: list[dict[str, Any]], topic_id: str) -> dict[str, Any]:
    """Validate that a topic ID exists in the config. Raises 422 if not found."""
    for t in topics:
        if t["id"] == topic_id:
            return t
    valid_ids = [t["id"] for t in topics]
    raise HTTPException(
        status_code=422,
        detail=f"Unknown topic '{topic_id}'. Valid topics: {valid_ids}",
    )


def escape_like(value: str) -> str:
    """Escape SQL LIKE wildcard characters (%, _, \\) for safe use in LIKE patterns."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def coerce_bool(value: Any, *, default: bool = True) -> bool:
    """Coerce a value to bool, handling string representations from LLM output.

    String values like "false", "0", "no" are correctly treated as False.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower().strip() not in ("false", "0", "no", "")
    if value is None:
        return default
    return bool(value)


def _tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase words, stripping punctuation."""
    return re.findall(r"[a-zA-Z']+", text.lower())


def compute_dictation_score(reference: str, typed: str) -> dict[str, Any]:
    """Compare a reference sentence with user-typed text word-by-word.

    Returns a dict with score (0-10), word counts, and per-word results.
    """
    ref_words = _tokenize(reference)
    typed_words = _tokenize(typed)

    if not ref_words:
        return {
            "score": 0.0,
            "total_words": 0,
            "correct_words": 0,
            "word_results": [],
        }

    matcher = SequenceMatcher(None, ref_words, typed_words)
    word_results: list[dict[str, Any]] = []
    matched_ref: set[int] = set()

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                word_results.append({
                    "expected": ref_words[i1 + k],
                    "typed": typed_words[j1 + k],
                    "is_correct": True,
                })
                matched_ref.add(i1 + k)
        elif tag == "replace":
            for k in range(max(i2 - i1, j2 - j1)):
                ref_idx = i1 + k if k < (i2 - i1) else None
                typ_idx = j1 + k if k < (j2 - j1) else None
                word_results.append({
                    "expected": ref_words[ref_idx] if ref_idx is not None else "",
                    "typed": typed_words[typ_idx] if typ_idx is not None else "",
                    "is_correct": False,
                })
                if ref_idx is not None:
                    matched_ref.add(ref_idx)
        elif tag == "delete":
            for k in range(i1, i2):
                word_results.append({
                    "expected": ref_words[k],
                    "typed": "",
                    "is_correct": False,
                })
                matched_ref.add(k)
        elif tag == "insert":
            for k in range(j1, j2):
                word_results.append({
                    "expected": "",
                    "typed": typed_words[k],
                    "is_correct": False,
                })

    correct_words = sum(1 for r in word_results if r["is_correct"])
    total_words = len(ref_words)
    score = round((correct_words / total_words) * 10.0, 1) if total_words > 0 else 0.0

    return {
        "score": score,
        "total_words": total_words,
        "correct_words": correct_words,
        "word_results": word_results,
    }
