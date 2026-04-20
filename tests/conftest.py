"""Shared test fixtures."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import aiosqlite
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import SCHEMA, _apply_migrations


# ---------------------------------------------------------------------------
# In-memory SQLite DB fixture (for unit & integration tests)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def test_db(tmp_path: Path) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Create a temporary SQLite database with the full schema."""
    db_path = tmp_path / "test.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON")
    await db.executescript(SCHEMA)
    await db.commit()
    await _apply_migrations(db)
    yield db
    await db.close()


# ---------------------------------------------------------------------------
# Mock CopilotService fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_copilot():
    """Return a mock CopilotService with configurable responses."""
    service = MagicMock()
    service.ask = AsyncMock(return_value="Hello! Let's talk about business.")
    service.ask_json = AsyncMock(return_value={
        "corrected_text": "Hello, how are you?",
        "is_correct": True,
        "errors": [],
        "suggestions": [],
    })
    service.close = AsyncMock()
    return service


# ---------------------------------------------------------------------------
# FastAPI test client fixture (for integration tests)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _noop_lifespan(app):
    yield


@pytest_asyncio.fixture
async def client(tmp_path: Path, mock_copilot) -> AsyncGenerator[AsyncClient, None]:
    """Create a test HTTP client with mocked DB and CopilotService."""
    db_path = tmp_path / "test.db"

    async def _get_test_db():
        db = await aiosqlite.connect(str(db_path))
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        return db

    # Initialize schema and run migrations
    db = await _get_test_db()
    await db.executescript(SCHEMA)
    await db.commit()
    await _apply_migrations(db)
    await db.close()

    # Override the FastAPI Depends(get_db_session) with a test version
    async def _test_db_session():
        db = await _get_test_db()
        try:
            yield db
        finally:
            await db.close()

    from app.database import get_db_session
    from app.rate_limit import require_rate_limit
    from app.main import app

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_db_session] = _test_db_session
    app.dependency_overrides[require_rate_limit] = lambda: None

    with patch("app.routers.conversation.get_copilot_service", return_value=mock_copilot), \
         patch("app.routers.pronunciation.get_copilot_service", return_value=mock_copilot), \
         patch("app.routers.vocabulary.get_copilot_service", return_value=mock_copilot), \
         patch("app.routers.paraphrase.get_copilot_service", return_value=mock_copilot), \
         patch("app.routers.monologue.get_copilot_service", return_value=mock_copilot), \
         patch("app.routers.dashboard.get_copilot_service", return_value=mock_copilot):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()
