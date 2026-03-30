"""In-memory sliding-window rate limiter for LLM endpoints."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class RateLimiter:
    """Sliding window rate limiter that tracks requests per client IP."""

    def __init__(self, max_requests: int = 20, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)

    def _client_key(self, request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def check(self, request: Request) -> None:
        """Raise HTTP 429 if the client has exceeded the rate limit."""
        key = self._client_key(request)
        now = time.monotonic()
        dq = self._requests[key]

        # Prune expired entries
        cutoff = now - self.window_seconds
        while dq and dq[0] < cutoff:
            dq.popleft()

        if len(dq) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please try again later.",
            )
        dq.append(now)


# Global default limiter for LLM endpoints
llm_rate_limiter = RateLimiter(max_requests=20, window_seconds=60)


def require_rate_limit(request: Request) -> None:
    """FastAPI dependency that enforces the global LLM rate limit."""
    llm_rate_limiter.check(request)
