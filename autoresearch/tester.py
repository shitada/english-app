"""Test runner for autoresearch — executes pytest, tsc, smoke test."""

from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class TestResult:
    passed: int
    total: int
    ts_check: str  # "pass" or "fail"
    smoke_ok: bool | None  # None if not run
    all_passed: bool

    @property
    def summary(self) -> str:
        parts = [f"pytest: {self.passed}/{self.total}"]
        parts.append(f"tsc: {self.ts_check}")
        if self.smoke_ok is not None:
            parts.append(f"smoke: {'OK' if self.smoke_ok else 'FAIL'}")
        return ", ".join(parts)


def _run(cmd: str, timeout: int = 120) -> subprocess.CompletedProcess:
    """Run a command with timeout."""
    return subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=str(ROOT), timeout=timeout,
    )


def run_pytest() -> tuple[int, int, str]:
    """Run unit + integration tests. Returns (passed, total, output_tail)."""
    result = _run(
        "uv run pytest tests/unit tests/integration -v 2>&1",
        timeout=120,
    )
    output = result.stdout + result.stderr

    # Parse "X passed" from pytest output
    passed_match = re.search(r"(\d+) passed", output)
    failed_match = re.search(r"(\d+) failed", output)

    passed = int(passed_match.group(1)) if passed_match else 0
    failed = int(failed_match.group(1)) if failed_match else 0
    total = passed + failed

    # Get last 30 lines for logging
    lines = output.strip().splitlines()
    tail = "\n".join(lines[-30:])

    return passed, total, tail


def run_tsc() -> str:
    """Run TypeScript check. Returns 'pass' or 'fail'."""
    result = _run(
        "cd frontend && npx tsc --noEmit 2>&1",
        timeout=60,
    )
    output = (result.stdout + result.stderr).strip()
    if result.returncode == 0 and not output:
        return "pass"
    if "error" in output.lower():
        logger.warning("TSC errors:\n%s", output[:500])
        return "fail"
    return "pass"


def run_smoke() -> bool:
    """Run smoke test against real DB. Returns True if OK."""
    result = _run(
        "uv run python tests/smoke_test.py 2>&1",
        timeout=30,
    )
    output = result.stdout + result.stderr
    return "SMOKE OK" in output


def run_all(changed_files: list[str] | None = None) -> TestResult:
    """Run all tests and return aggregated result."""
    logger.info("Running pytest...")
    passed, total, output = run_pytest()
    pytest_ok = passed == total and total > 0

    logger.info("Running tsc...")
    ts_check = run_tsc()
    tsc_ok = ts_check == "pass"

    # Smoke test only if db/router/dal changed
    smoke_ok = None
    if changed_files:
        needs_smoke = any(
            "database.py" in f or "app/routers/" in f or "app/dal/" in f
            for f in changed_files
        )
        if needs_smoke:
            logger.info("Running smoke test...")
            smoke_ok = run_smoke()

    all_passed = pytest_ok and tsc_ok and (smoke_ok is None or smoke_ok)

    result = TestResult(
        passed=passed,
        total=total,
        ts_check=ts_check,
        smoke_ok=smoke_ok,
        all_passed=all_passed,
    )
    logger.info("Test results: %s (all_passed=%s)", result.summary, all_passed)
    return result
