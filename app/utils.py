"""Shared utility functions."""

from __future__ import annotations

from typing import Any


def get_topic_label(topics: list[dict[str, Any]], topic_id: str) -> str:
    """Look up a topic's display label by its ID. Returns the ID if not found."""
    for t in topics:
        if t["id"] == topic_id:
            return t["label"]
    return topic_id
