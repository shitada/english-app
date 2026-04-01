"""Smoke test: start the real server against the real DB and verify key endpoints."""

import subprocess
import sys
import time

import httpx

PORT = 8099
BASE = f"http://localhost:{PORT}"
ENDPOINTS = [
    "/api/health",
    "/api/conversation/topics",
    "/api/conversation/grammar-accuracy",
    "/api/conversation/topic-recommendations",
    "/api/pronunciation/sentences",
    "/api/pronunciation/distribution",
    "/api/pronunciation/records",
    "/api/pronunciation/weekly-progress",
    "/api/vocabulary/topics",
    "/api/vocabulary/favorites",
    "/api/vocabulary/forecast",
    "/api/vocabulary/attempts",
    "/api/vocabulary/topic-accuracy",
    "/api/dashboard/stats",
    "/api/dashboard/activity-history",
    "/api/dashboard/streak-milestones",
    "/api/dashboard/conversation-duration",
    "/api/dashboard/config",
    "/api/dashboard/summary",
    "/api/dashboard/goals",
    "/api/preferences",
]


def main() -> int:
    # Start server as subprocess
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "localhost", "--port", str(PORT), "--log-level", "warning"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Wait for server readiness
    ready = False
    for _ in range(30):
        try:
            r = httpx.get(f"{BASE}/api/health", timeout=2)
            if r.status_code < 500:
                ready = True
                break
        except Exception:
            pass
        time.sleep(0.5)

    if not ready:
        proc.kill()
        print("SMOKE FAIL: server did not start")
        return 1

    # Test endpoints
    failed = False
    for ep in ENDPOINTS:
        try:
            r = httpx.get(f"{BASE}{ep}", timeout=10)
            code = r.status_code
        except Exception as e:
            code = f"ERR:{e}"
        ok = isinstance(code, int) and code < 500
        status = "OK" if ok else "FAIL"
        print(f"  {ep} -> {code} [{status}]")
        if not ok:
            failed = True

    proc.kill()
    proc.wait(timeout=5)

    if failed:
        print("SMOKE FAIL")
        return 1
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
