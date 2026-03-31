"""Shared utility functions."""

from __future__ import annotations

import logging
from collections.abc import Awaitable
from typing import Any, TypeVar

from fastapi import HTTPException

logger = logging.getLogger(__name__)

T = TypeVar("T")


async def safe_llm_call(coro: Awaitable[T], *, context: str) -> T:
    """Execute an LLM coroutine with standardized error handling.

    Catches any exception, logs it, and raises HTTPException(502).
    """
    try:
        return await coro
    except Exception as e:
        logger.error("LLM error in %s: %s", context, e)
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
