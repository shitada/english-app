"""Unit tests for the RateLimiter class in app/rate_limit.py."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from fastapi import Response

from app.rate_limit import RateLimiter, require_rate_limit, llm_rate_limiter


def _make_request(host: str = "127.0.0.1") -> MagicMock:
    """Create a mock FastAPI Request with the given client host."""
    request = MagicMock()
    request.client.host = host
    return request


def _make_request_no_client() -> MagicMock:
    """Create a mock Request where client is None."""
    request = MagicMock()
    request.client = None
    return request


@pytest.mark.unit
class TestRateLimiter:
    def test_allows_requests_within_limit(self):
        """Requests within max_requests should not raise."""
        limiter = RateLimiter(max_requests=3, window_seconds=60)
        request = _make_request()
        for _ in range(3):
            limiter.check(request)  # Should not raise

    def test_check_returns_remaining_count(self):
        """check() should return the number of remaining requests."""
        limiter = RateLimiter(max_requests=3, window_seconds=60)
        request = _make_request()
        assert limiter.check(request) == 2  # 3 - 1
        assert limiter.check(request) == 1  # 3 - 2
        assert limiter.check(request) == 0  # 3 - 3

    def test_blocks_requests_exceeding_limit(self):
        """The (max_requests + 1)th request should raise HTTP 429."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)
        request = _make_request()
        limiter.check(request)
        limiter.check(request)
        with pytest.raises(HTTPException) as exc_info:
            limiter.check(request)
        assert exc_info.value.status_code == 429
        assert "Rate limit exceeded" in exc_info.value.detail

    def test_expired_entries_are_pruned(self):
        """After the window expires, old entries should be pruned and new requests allowed."""
        limiter = RateLimiter(max_requests=2, window_seconds=10)
        request = _make_request()

        # Simulate old timestamps by patching time.monotonic
        with patch("app.rate_limit.time.monotonic", return_value=100.0):
            limiter.check(request)
            limiter.check(request)

        # Now at time 120 (beyond 10s window), old entries should be pruned
        with patch("app.rate_limit.time.monotonic", return_value=120.0):
            limiter.check(request)  # Should succeed after pruning

    def test_different_ips_tracked_independently(self):
        """Each client IP should have its own request counter."""
        limiter = RateLimiter(max_requests=1, window_seconds=60)
        req_a = _make_request("10.0.0.1")
        req_b = _make_request("10.0.0.2")

        limiter.check(req_a)
        limiter.check(req_b)  # Different IP, should succeed

        with pytest.raises(HTTPException):
            limiter.check(req_a)  # Same IP, should fail

        # req_b should still have one more allowed
        with pytest.raises(HTTPException):
            limiter.check(req_b)

    def test_client_key_returns_unknown_when_no_client(self):
        """When request.client is None, key should be 'unknown'."""
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        request = _make_request_no_client()
        key = limiter._client_key(request)
        assert key == "unknown"

    def test_client_key_returns_host(self):
        """When request.client exists, key should be the host."""
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        request = _make_request("192.168.1.1")
        key = limiter._client_key(request)
        assert key == "192.168.1.1"

    def test_custom_window_and_limit(self):
        """Constructor parameters should be stored correctly."""
        limiter = RateLimiter(max_requests=100, window_seconds=300)
        assert limiter.max_requests == 100
        assert limiter.window_seconds == 300


@pytest.mark.unit
class TestRequireRateLimit:
    def test_delegates_to_global_limiter(self):
        """require_rate_limit should call llm_rate_limiter.check."""
        request = _make_request()
        response = Response()
        with patch.object(llm_rate_limiter, "check", return_value=19) as mock_check:
            require_rate_limit(request, response)
            mock_check.assert_called_once_with(request)

    def test_raises_on_limit_exceeded(self):
        """require_rate_limit should propagate 429 from the global limiter."""
        request = _make_request()
        response = Response()
        with patch.object(llm_rate_limiter, "check", side_effect=HTTPException(status_code=429, detail="Rate limit exceeded.")):
            with pytest.raises(HTTPException) as exc_info:
                require_rate_limit(request, response)
            assert exc_info.value.status_code == 429

    def test_sets_rate_limit_headers(self):
        """require_rate_limit should set X-RateLimit-* headers on the response."""
        request = _make_request()
        response = Response()
        with patch.object(llm_rate_limiter, "check", return_value=15):
            require_rate_limit(request, response)
        assert response.headers["X-RateLimit-Limit"] == "20"
        assert response.headers["X-RateLimit-Remaining"] == "15"
        assert response.headers["X-RateLimit-Window"] == "60"

    def test_headers_set_on_last_allowed_request(self):
        """Headers should still be set when remaining is 0."""
        request = _make_request()
        response = Response()
        with patch.object(llm_rate_limiter, "check", return_value=0):
            require_rate_limit(request, response)
        assert response.headers["X-RateLimit-Remaining"] == "0"
