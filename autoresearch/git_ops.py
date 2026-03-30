"""Git operations for autoresearch runner."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent


def _run(cmd: str, check: bool = True) -> str:
    """Run a shell command and return stdout."""
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True, cwd=str(ROOT)
    )
    if check and result.returncode != 0:
        logger.error("Command failed: %s\nstderr: %s", cmd, result.stderr)
        raise RuntimeError(f"Command failed: {cmd}\n{result.stderr}")
    return result.stdout.strip()


def commit(message: str) -> str:
    """Stage all changes and commit. Returns short commit hash."""
    _run("git add -A")
    _run(f'git commit -m "{message}"')
    return _run("git rev-parse --short HEAD")


def reset_hard(ref: str = "HEAD~1") -> None:
    """Hard reset to a ref (discard last commit)."""
    _run(f"git reset --hard {ref}")
    logger.info("Reset to %s", ref)


def diff(ref: str = "HEAD~1") -> str:
    """Get the diff between current and ref."""
    return _run(f"git diff {ref}", check=False)


def diff_name_only(ref: str = "HEAD~1") -> list[str]:
    """Get list of changed file paths."""
    output = _run(f"git diff {ref} --name-only", check=False)
    return [line for line in output.splitlines() if line.strip()]


def log_oneline(count: int = 5) -> str:
    """Get recent git log."""
    return _run(f"git log --oneline -{count}", check=False)
