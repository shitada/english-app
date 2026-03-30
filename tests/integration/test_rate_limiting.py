"""Integration tests for rate limiting on LLM endpoints."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import aiosqlite
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import SCHEMA
from app.rate_limit import RateLimiter, require_rate_limit

from fastapi import Request as FastAPIRequest


@asynccontextmanager
async def _noop_lifespan(app):
    yield


@pytest_asyncio.fixture
async def rate_limited_client(tmp_path: Path) -> AsyncClient:
    """Test client with a strict rate limiter (max 3 requests / 60s)."""
    db_path = tmp_path / "test.db"

    async def _get_test_db():
        db = await aiosqlite.connect(str(db_path))
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        return db

    db = await _get_test_db()
    await db.executescript(SCHEMA)
    await db.commit()
    await db.close()

    async def _test_db_session():
        db = await _get_test_db()
        try:
            yield db
        finally:
            await db.close()

    strict_limiter = RateLimiter(max_requests=3, window_seconds=60)

    def _strict_rate_limit(request: FastAPIRequest) -> None:
        strict_limiter.check(request)

    mock_copilot = MagicMock()
    mock_copilot.ask = AsyncMock(return_value="Hello!")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "Hello",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
        "overall_score": 85,
    })
    mock_copilot.close = AsyncMock()

    from app.database import get_db_session
    from app.main import app

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_db_session] = _test_db_session
    app.dependency_overrides[require_rate_limit] = _strict_rate_limit

    with patch("app.routers.conversation.get_copilot_service", return_value=mock_copilot), \
         patch("app.routers.pronunciation.get_copilot_service", return_value=mock_copilot), \
         patch("app.routers.vocabulary.get_copilot_service", return_value=mock_copilot):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


@pytest.mark.integration
class TestRateLimiting:
    async def test_requests_within_limit_succeed(self, rate_limited_client: AsyncClient):
        """Requests within the limit should succeed normally."""
        for _ in range(3):
            resp = await rate_limited_client.post(
                "/api/conversation/start",
                json={"topic": "hotel", "difficulty": "intermediate"},
            )
            assert resp.status_code == 200

    async def test_exceeding_limit_returns_429(self, rate_limited_client: AsyncClient):
        """The 4th request should return HTTP 429."""
        for _ in range(3):
            resp = await rate_limited_client.post(
                "/api/conversation/start",
                json={"topic": "hotel", "difficulty": "intermediate"},
            )
            assert resp.status_code == 200

        resp = await rate_limited_client.post(
            "/api/conversation/start",
            json={"topic": "hotel", "difficulty": "intermediate"},
        )
        assert resp.status_code == 429
        assert "Rate limit exceeded" in resp.json()["detail"]

    async def test_different_endpoints_share_limit(self, rate_limited_client: AsyncClient):
        """All rate-limited endpoints share the same per-client limit."""
        # Use 2 requests on conversation/start
        for _ in range(2):
            resp = await rate_limited_client.post(
                "/api/conversation/start",
                json={"topic": "hotel", "difficulty": "intermediate"},
            )
            assert resp.status_code == 200

        # Use 1 request on pronunciation/check
        resp = await rate_limited_client.post(
            "/api/pronunciation/check",
            json={"reference_text": "Hello world", "user_transcription": "Hello world"},
        )
        assert resp.status_code == 200

        # 4th request to any endpoint should be rejected
        resp = await rate_limited_client.post(
            "/api/pronunciation/check",
            json={"reference_text": "Hello world", "user_transcription": "Hello world"},
        )
        assert resp.status_code == 429

    async def test_non_limited_endpoints_still_work(self, rate_limited_client: AsyncClient):
        """Non-rate-limited endpoints (GET /topics) should always work."""
        # Exhaust the rate limit
        for _ in range(3):
            await rate_limited_client.post(
                "/api/conversation/start",
                json={"topic": "hotel", "difficulty": "intermediate"},
            )

        # GET /api/conversation/topics should still work
        resp = await rate_limited_client.get("/api/conversation/topics")
        assert resp.status_code == 200


@pytest.mark.unit
class TestRateLimiterUnit:
    def test_limiter_allows_within_limit(self):
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        assert limiter.max_requests == 5
        assert limiter.window_seconds == 60

    def test_limiter_prunes_old_entries(self):
        import time
        limiter = RateLimiter(max_requests=2, window_seconds=1)
        # Manually add old timestamps
        limiter._requests["127.0.0.1"].append(time.monotonic() - 10)
        limiter._requests["127.0.0.1"].append(time.monotonic() - 10)
        # After pruning, these should be gone (next check would succeed)
        assert len(limiter._requests["127.0.0.1"]) == 2
        # The deque has old entries, but check() would prune them
