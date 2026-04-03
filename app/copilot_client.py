"""GitHub Copilot SDK wrapper — all SDK calls go through this module."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from copilot import CopilotClient
from copilot.types import PermissionRequestResult, SystemMessageReplaceConfig

from app.config import get_copilot_config

logger = logging.getLogger(__name__)


class CopilotService:
    """Thin wrapper around the Copilot SDK for the English app."""

    def __init__(self) -> None:
        cfg = get_copilot_config()
        self._model = cfg.get("model", "claude-sonnet-4-20250514")
        self._timeout = cfg.get("timeout", 120)
        self._max_retries = cfg.get("max_retries", 3)
        self._retry_delays = cfg.get("retry_delays", [5, 15, 45])
        self._client: CopilotClient | None = None
        logger.info(
            "CopilotService configured: model=%s, timeout=%d, retries=%d",
            self._model, self._timeout, self._max_retries,
        )

    async def _ensure_client(self) -> CopilotClient:
        if self._client is None:
            self._client = CopilotClient()
            for attempt in range(self._max_retries):
                try:
                    await self._client.start()
                    logger.info("CopilotClient started (model=%s)", self._model)
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
                        self._client = None
                        raise
        return self._client

    async def ask(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: int | None = None,
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
            logger.info(
                "Copilot response (session=%.1fs, llm=%.1fs, total=%.1fs)",
                t_session - t0, t_response - t_session, t_response - t0,
            )

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
    ) -> dict[str, Any]:
        """Send a prompt and parse the response as JSON."""
        raw = await self.ask(system_prompt, user_prompt, timeout)
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

        # Try raw JSON object
        brace_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        # Try raw JSON array
        bracket_match = re.search(r"\[.*\]", raw, re.DOTALL)
        if bracket_match:
            try:
                result = json.loads(bracket_match.group(0))
                return {"items": result} if isinstance(result, list) else result
            except json.JSONDecodeError:
                pass

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
