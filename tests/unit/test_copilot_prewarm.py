"""Unit tests for CopilotService.prewarm()."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.copilot_client import CopilotService


@pytest.mark.unit
@pytest.mark.asyncio
async def test_prewarm_creates_and_destroys_session(monkeypatch):
    svc = CopilotService()

    fake_session = MagicMock()
    fake_session.destroy = AsyncMock()

    fake_client = MagicMock()
    fake_client.create_session = AsyncMock(return_value=fake_session)

    async def _fake_ensure_client():
        return fake_client

    monkeypatch.setattr(svc, "_ensure_client", _fake_ensure_client)

    await svc.prewarm()

    assert fake_client.create_session.await_count == 1
    kwargs = fake_client.create_session.await_args.kwargs
    assert kwargs["model"] == svc._model
    sysmsg = kwargs["system_message"]
    assert sysmsg == {"content": "ping", "mode": "replace"}
    assert callable(kwargs["on_permission_request"])
    fake_session.destroy.assert_awaited_once()
    assert svc._prewarmed is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_prewarm_swallows_exceptions(monkeypatch):
    svc = CopilotService()

    fake_client = MagicMock()
    fake_client.create_session = AsyncMock(side_effect=RuntimeError("boom"))

    async def _fake_ensure_client():
        return fake_client

    monkeypatch.setattr(svc, "_ensure_client", _fake_ensure_client)

    # Must not raise
    await svc.prewarm()

    assert svc._prewarmed is False
    assert fake_client.create_session.await_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_prewarm_is_idempotent(monkeypatch):
    svc = CopilotService()

    fake_session = MagicMock()
    fake_session.destroy = AsyncMock()
    fake_client = MagicMock()
    fake_client.create_session = AsyncMock(return_value=fake_session)

    async def _fake_ensure_client():
        return fake_client

    monkeypatch.setattr(svc, "_ensure_client", _fake_ensure_client)

    await svc.prewarm()
    await svc.prewarm()

    assert fake_client.create_session.await_count == 1
    fake_session.destroy.assert_awaited_once()
