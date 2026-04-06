"""In-memory sliding-window rate limiter for LLM endpoints."""

from __future__ import annotations

import math
import time
from collections import deque

from fastapi import HTTPException, Request, Response


class RateLimiter:
    """Sliding window rate limiter that tracks requests per client IP."""

    _SWEEP_INTERVAL = 100

    def __init__(self, max_requests: int = 20, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = {}
        self._check_count = 0

    def _client_key(self, request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def _sweep_stale(self, now: float) -> None:
        """Remove entries whose newest timestamp is older than the window."""
        cutoff = now - self.window_seconds
        stale_keys = [k for k, dq in self._requests.items() if not dq or dq[-1] < cutoff]
        for k in stale_keys:
            del self._requests[k]

    def check(self, request: Request) -> int:
        """Raise HTTP 429 if the client has exceeded the rate limit.

        Returns the number of remaining requests in the current window.
        """
        key = self._client_key(request)
        now = time.monotonic()

        self._check_count += 1
        if self._check_count % self._SWEEP_INTERVAL == 0:
            self._sweep_stale(now)

        if key not in self._requests:
            self._requests[key] = deque()
        dq = self._requests[key]

        # Prune expired entries
        cutoff = now - self.window_seconds
        while dq and dq[0] < cutoff:
            dq.popleft()

        if len(dq) >= self.max_requests:
            retry_after = max(1, math.ceil(dq[0] + self.window_seconds - now))
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please try again later.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(self.max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Window": str(self.window_seconds),
                },
            )
        dq.append(now)
        return self.max_requests - len(dq)


# Global default limiter for LLM endpoints
llm_rate_limiter = RateLimiter(max_requests=20, window_seconds=60)


def require_rate_limit(request: Request, response: Response) -> None:
    """FastAPI dependency that enforces the global LLM rate limit."""
    remaining = llm_rate_limiter.check(request)
    response.headers["X-RateLimit-Limit"] = str(llm_rate_limiter.max_requests)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Window"] = str(llm_rate_limiter.window_seconds)
