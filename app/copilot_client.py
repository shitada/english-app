"""GitHub Copilot SDK wrapper — all SDK calls go through this module."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import deque
from threading import Lock
from typing import Any, Deque

from copilot import CopilotClient
from copilot.types import PermissionRequestResult, SystemMessageReplaceConfig

from app.config import get_copilot_config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Latency tracking
# ---------------------------------------------------------------------------

_RING_BUFFER_CAP = 200
_REPORT_EVERY = 20


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Compute percentile (0-100) from a pre-sorted list using nearest-rank."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    # nearest-rank: index = ceil(pct/100 * N) - 1, clamped
    import math
    rank = max(1, math.ceil(pct / 100.0 * len(sorted_values)))
    rank = min(rank, len(sorted_values))
    return float(sorted_values[rank - 1])


class LatencyTracker:
    """In-memory bounded ring buffer of Copilot call latencies, per label."""

    def __init__(self, cap: int = _RING_BUFFER_CAP) -> None:
        self._cap = cap
        self._lock = Lock()
        # label -> list of (session_s, llm_s, total_s)
        self._records: dict[str, Deque[tuple[float, float, float]]] = {}
        # cumulative count per label (not bounded by ring buffer)
        self._counts: dict[str, int] = {}

    def record(self, label: str, session_s: float, llm_s: float, total_s: float) -> int:
        """Append a measurement. Returns the new cumulative count for this label."""
        with self._lock:
            buf = self._records.get(label)
            if buf is None:
                buf = deque(maxlen=self._cap)
                self._records[label] = buf
            buf.append((float(session_s), float(llm_s), float(total_s)))
            self._counts[label] = self._counts.get(label, 0) + 1
            return self._counts[label]

    @staticmethod
    def _stats(values: list[float]) -> dict[str, float]:
        if not values:
            return {"count": 0, "p50_s": 0.0, "p95_s": 0.0, "p99_s": 0.0,
                    "mean_s": 0.0, "max_s": 0.0, "last_s": 0.0}
        s = sorted(values)
        return {
            "count": len(values),
            "p50_s": round(_percentile(s, 50), 4),
            "p95_s": round(_percentile(s, 95), 4),
            "p99_s": round(_percentile(s, 99), 4),
            "mean_s": round(sum(values) / len(values), 4),
            "max_s": round(max(values), 4),
            "last_s": round(values[-1], 4),
        }

    def _label_snapshot(self, records: list[tuple[float, float, float]]) -> dict[str, Any]:
        llm = [r[1] for r in records]
        total = [r[2] for r in records]
        return {
            "count": len(records),
            "llm": self._stats(llm),
            "total": self._stats(total),
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            per_label: dict[str, Any] = {}
            all_records: list[tuple[float, float, float]] = []
            for label, buf in self._records.items():
                recs = list(buf)
                per_label[label] = self._label_snapshot(recs)
                # include cumulative count too
                per_label[label]["cumulative_count"] = self._counts.get(label, len(recs))
                all_records.extend(recs)
            return {
                "labels": per_label,
                "all": self._label_snapshot(all_records),
                "buffer_cap": self._cap,
            }

    def reset(self) -> None:
        with self._lock:
            self._records.clear()
            self._counts.clear()


_latency_tracker: LatencyTracker | None = None


def get_latency_tracker() -> LatencyTracker:
    global _latency_tracker
    if _latency_tracker is None:
        _latency_tracker = LatencyTracker()
    return _latency_tracker


class CopilotService:
    """Thin wrapper around the Copilot SDK for the English app."""

    def __init__(self) -> None:
        cfg = get_copilot_config()
        self._model = cfg.get("model", "claude-sonnet-4-20250514")
        self._timeout = cfg.get("timeout", 120)
        self._max_retries = cfg.get("max_retries", 3)
        self._retry_delays = cfg.get("retry_delays", [5, 15, 45])
        self._client: CopilotClient | None = None
        self._init_lock = asyncio.Lock()
        logger.info(
            "CopilotService configured: model=%s, timeout=%d, retries=%d",
            self._model, self._timeout, self._max_retries,
        )

    async def _ensure_client(self) -> CopilotClient:
        if self._client is not None:
            return self._client
        async with self._init_lock:
            # Double-check after acquiring lock
            if self._client is not None:
                return self._client
            client = CopilotClient()
            for attempt in range(self._max_retries):
                try:
                    await client.start()
                    logger.info("CopilotClient started (model=%s)", self._model)
                    self._client = client
                    return self._client
                except Exception as exc:
                    delay = self._retry_delays[min(attempt, len(self._retry_delays) - 1)]
                    logger.warning(
                        "CopilotClient.start() failed (attempt %d/%d): %s — retrying in %ds",
                        attempt + 1, self._max_retries, exc, delay,
                    )
                    if attempt < self._max_retries - 1:
                        await asyncio.sleep(delay)
                    else:
                        raise
        return self._client  # type: ignore[return-value]

    async def ask(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: int | None = None,
        label: str = "default",
    ) -> str:
        """Send a prompt and return the text response."""
        client = await self._ensure_client()
        timeout = timeout or self._timeout

        def _on_permission_request(req: Any, ctx: dict[str, str]) -> PermissionRequestResult:
            return PermissionRequestResult(kind="approved")

        t0 = time.monotonic()
        session = await client.create_session(
            model=self._model,
            system_message=SystemMessageReplaceConfig(mode="replace", content=system_prompt),
            on_permission_request=_on_permission_request,
        )
        t_session = time.monotonic()
        logger.info("Session created (%.1fs)", t_session - t0)

        try:
            response = await session.send_and_wait(
                user_prompt,
                timeout=float(timeout),
            )
            t_response = time.monotonic()
            session_s = t_session - t0
            llm_s = t_response - t_session
            total_s = t_response - t0
            logger.info(
                "Copilot response (session=%.1fs, llm=%.1fs, total=%.1fs)",
                session_s, llm_s, total_s,
            )
            try:
                tracker = get_latency_tracker()
                count = tracker.record(label, session_s, llm_s, total_s)
                if count > 0 and count % _REPORT_EVERY == 0:
                    snap = tracker.snapshot()["labels"].get(label)
                    if snap:
                        logger.info(
                            "Copilot latency [%s] n=%d llm p50=%.2fs p95=%.2fs total p50=%.2fs p95=%.2fs",
                            label, count,
                            snap["llm"]["p50_s"], snap["llm"]["p95_s"],
                            snap["total"]["p50_s"], snap["total"]["p95_s"],
                        )
            except Exception as exc:  # never fail a real request because of metrics
                logger.debug("Latency tracking failed: %s", exc)

            if response and hasattr(response, "data") and hasattr(response.data, "content"):
                return str(response.data.content)
            logger.warning("Empty response from Copilot SDK")
            return ""
        finally:
            await session.destroy()

    async def ask_json(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: int | None = None,
        label: str = "default",
    ) -> dict[str, Any]:
        """Send a prompt and parse the response as JSON."""
        raw = await self.ask(system_prompt, user_prompt, timeout, label=label)
        return self._parse_json(raw)

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        """Extract JSON from a response that may contain markdown fences."""
        # Try ```json ... ``` block first
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group(1))
                return {"items": parsed} if isinstance(parsed, list) else parsed
            except json.JSONDecodeError:
                pass

        # Try raw_decode at each '{' or '[' position for precise parsing
        decoder = json.JSONDecoder()
        for i, ch in enumerate(raw):
            if ch == '{':
                try:
                    obj, _ = decoder.raw_decode(raw, i)
                    if isinstance(obj, dict):
                        return obj
                except (json.JSONDecodeError, ValueError):
                    continue
            elif ch == '[':
                try:
                    obj, _ = decoder.raw_decode(raw, i)
                    if isinstance(obj, list):
                        return {"items": obj}
                except (json.JSONDecodeError, ValueError):
                    continue

        logger.error("Failed to parse JSON from response: %s", raw[:300])
        raise ValueError(f"Failed to parse JSON: {raw[:200]}")

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.stop()
            except Exception:
                pass
            self._client = None


# Module-level singleton
_service: CopilotService | None = None


def get_copilot_service() -> CopilotService:
    global _service
    if _service is None:
        _service = CopilotService()
    return _service
