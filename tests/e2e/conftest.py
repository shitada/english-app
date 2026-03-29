"""Playwright E2E test fixtures."""

import asyncio
import multiprocessing
import time
from typing import Generator

import pytest
import uvicorn


def _run_server():
    """Run the app server in a subprocess."""
    uvicorn.run("app.main:app", host="localhost", port=8099, log_level="warning")


@pytest.fixture(scope="session")
def server() -> Generator[str, None, None]:
    """Start the app server for E2E tests."""
    proc = multiprocessing.Process(target=_run_server, daemon=True)
    proc.start()
    # Wait for server to be ready
    import httpx
    base = "http://localhost:8099"
    for _ in range(30):
        try:
            r = httpx.get(f"{base}/api/conversation/topics", timeout=2)
            if r.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(0.5)
    else:
        proc.kill()
        pytest.fail("Server did not start in time")

    yield base
    proc.kill()
    proc.join(timeout=5)


@pytest.fixture(scope="session")
def browser_context_args():
    """Grant microphone permission for speech recognition tests."""
    return {
        "permissions": ["microphone"],
    }
