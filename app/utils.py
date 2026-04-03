"""Shared utility functions."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
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


def get_topic_label(topics: list[dict[str, Any]], topic_id: str) -> str:
    """Look up a topic's display label by its ID. Returns the ID if not found."""
    for t in topics:
        if t["id"] == topic_id:
            return t["label"]
    return topic_id


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
