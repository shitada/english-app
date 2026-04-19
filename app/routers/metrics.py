"""Internal metrics endpoint — Copilot call latency."""

from __future__ import annotations

from fastapi import APIRouter

from app.copilot_client import get_latency_tracker

router = APIRouter(prefix="/api/internal", tags=["internal"])


@router.get("/copilot-metrics")
async def copilot_metrics() -> dict:
    """Return aggregated Copilot call latency (per label and overall)."""
    return get_latency_tracker().snapshot()
