"""Unit tests for CopilotService warm-pool prefetch (autoresearch #636).

Verifies that:
  (a) After the first ask() call, a background task pre-creates a session for
      the same system_prompt and stashes it in the warm pool.
  (b) The second ask() with the same system_prompt consumes the warm session
      instead of calling create_session inline (overlap = saved ~0.6s).
  (c) Calls with a different system_prompt do not consume the warm session.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.copilot_client import CopilotService


def _make_session() -> MagicMock:
    session = MagicMock()
    session.destroy = AsyncMock()
    response = MagicMock()
    response.data = MagicMock()
    response.data.content = "ok"
    session.send_and_wait = AsyncMock(return_value=response)
    return session


async def _drain_background_tasks() -> None:
    """Yield repeatedly so background asyncio tasks (warm-pool prefetch) can run."""
    for _ in range(20):
        await asyncio.sleep(0)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_warm_session_consumed_on_second_call(monkeypatch):
    svc = CopilotService()

    sessions = [_make_session(), _make_session(), _make_session()]
    fake_client = MagicMock()
    fake_client.create_session = AsyncMock(side_effect=sessions)

    async def _fake_ensure_client():
        return fake_client

    monkeypatch.setattr(svc, "_ensure_client", _fake_ensure_client)

    # First call: cold path — must call create_session inline.
    out1 = await svc.ask("SYS", "hello")
    assert out1 == "ok"
    assert fake_client.create_session.await_count == 1

    # Let the background prefetch task run.
    await _drain_background_tasks()
    # Background prefetch must have created a second session and stashed it.
    assert fake_client.create_session.await_count == 2
    assert "SYS" in svc._warm_pool

    # Second call with same system prompt: must NOT call create_session inline.
    out2 = await svc.ask("SYS", "world")
    assert out2 == "ok"
    # Still 2 inline create_session calls (the warm one was popped, not created here).
    # After ask() returns it schedules another prefetch — drain to settle.
    await _drain_background_tasks()
    # Now create_session has been called a 3rd time by the background prefetch
    # following the second ask() — but crucially NOT a 3rd time inline before
    # send_and_wait of the second call. Verify by checking call ordering on sessions.
    assert sessions[0].send_and_wait.await_count == 1  # used by first ask
    assert sessions[1].send_and_wait.await_count == 1  # warm-pool session used by second ask
    assert sessions[0].destroy.await_count == 1
    assert sessions[1].destroy.await_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_warm_pool_miss_for_different_prompt(monkeypatch):
    svc = CopilotService()

    sessions = [_make_session() for _ in range(5)]
    fake_client = MagicMock()
    fake_client.create_session = AsyncMock(side_effect=sessions)

    async def _fake_ensure_client():
        return fake_client

    monkeypatch.setattr(svc, "_ensure_client", _fake_ensure_client)

    # First call with prompt A.
    await svc.ask("PROMPT_A", "u1")
    await _drain_background_tasks()
    assert "PROMPT_A" in svc._warm_pool
    creates_after_first = fake_client.create_session.await_count  # 2 (inline + prewarm)

    # Second call with DIFFERENT prompt B: must NOT consume A's warm session.
    await svc.ask("PROMPT_B", "u2")
    # Inline create_session for B should have happened.
    assert fake_client.create_session.await_count == creates_after_first + 1
    # A's warm session should still be in the pool.
    assert "PROMPT_A" in svc._warm_pool


@pytest.mark.unit
@pytest.mark.asyncio
async def test_warm_pool_prefetch_failure_is_swallowed(monkeypatch):
    svc = CopilotService()

    good_session = _make_session()
    call_count = {"n": 0}

    async def _create(**kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return good_session
        raise RuntimeError("prefetch boom")

    fake_client = MagicMock()
    fake_client.create_session = AsyncMock(side_effect=_create)

    async def _fake_ensure_client():
        return fake_client

    monkeypatch.setattr(svc, "_ensure_client", _fake_ensure_client)

    # First ask succeeds; background prefetch raises but must not crash anything.
    out = await svc.ask("S", "hi")
    assert out == "ok"
    await _drain_background_tasks()
    # Prefetch failed → pool is empty.
    assert "S" not in svc._warm_pool
    # in-flight set was cleared
    assert "S" not in svc._warm_in_flight


@pytest.mark.unit
@pytest.mark.asyncio
async def test_close_drains_warm_pool(monkeypatch):
    svc = CopilotService()

    sessions = [_make_session(), _make_session()]
    fake_client = MagicMock()
    fake_client.create_session = AsyncMock(side_effect=sessions)
    fake_client.stop = AsyncMock()

    async def _fake_ensure_client():
        return fake_client

    monkeypatch.setattr(svc, "_ensure_client", _fake_ensure_client)
    # Pre-populate the client so close() will call stop()
    svc._client = fake_client

    await svc.ask("SYS", "u")
    await _drain_background_tasks()
    warm = svc._warm_pool.get("SYS")
    assert warm is not None

    await svc.close()
    # Warm session should have been destroyed during close().
    warm.destroy.assert_awaited()
    assert svc._warm_pool == {}


@pytest.mark.unit
def test_latency_snapshot_includes_session_stats():
    """LatencyTracker snapshot must expose session_s percentiles alongside llm/total."""
    from app.copilot_client import LatencyTracker

    tracker = LatencyTracker()
    tracker.record("conversation", session_s=0.6, llm_s=2.0, total_s=2.6)
    tracker.record("conversation", session_s=0.4, llm_s=1.8, total_s=2.2)
    snap = tracker.snapshot()["labels"]["conversation"]
    assert "session" in snap
    assert snap["session"]["count"] == 2
    assert snap["session"]["max_s"] == pytest.approx(0.6)
