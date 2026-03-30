"""Autoresearch runner — autonomous improvement loop for the English learning app.

Usage:
    uv run python -m autoresearch.runner --iterations 20
    uv run python -m autoresearch.runner --iterations 5 --start 14
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import io
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import load_config
from app.copilot_client import CopilotService

from autoresearch import git_ops, llm, tester

logger = logging.getLogger(__name__)

RESULTS_TSV = ROOT / "autoresearch" / "results.tsv"
BACKLOG_MD = ROOT / "autoresearch" / "backlog.md"


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(ROOT / "autoresearch" / "runner.log", encoding="utf-8"),
        ],
    )


def read_results_tsv() -> str:
    return RESULTS_TSV.read_text(encoding="utf-8")


def read_backlog() -> str:
    return BACKLOG_MD.read_text(encoding="utf-8")


def get_last_iteration() -> int:
    """Parse results.tsv and return the last iteration number (0 if empty)."""
    text = read_results_tsv()
    lines = [l for l in text.strip().splitlines() if l.strip() and not l.startswith("iteration")]
    if not lines:
        return 0
    last_line = lines[-1]
    try:
        return int(last_line.split("\t")[0])
    except (ValueError, IndexError):
        return 0


def append_result(row: dict) -> None:
    """Append a result row to results.tsv."""
    cols = [
        "iteration", "commit", "started_at", "propose_sec", "implement_sec",
        "test_sec", "evaluate_sec", "total_sec", "tests_passed", "tests_total",
        "ts_check", "score", "status", "description",
    ]
    line = "\t".join(str(row.get(c, "")) for c in cols)
    with open(RESULTS_TSV, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def apply_file_changes(changes: list[llm.FileChange]) -> None:
    """Write file changes to disk."""
    for change in changes:
        path = ROOT / change.path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(change.content, encoding="utf-8")
        logger.info("  Wrote %s (%d bytes)", change.path, len(change.content))


async def run_iteration(copilot: CopilotService, iteration: int) -> dict:
    """Run a single autoresearch iteration. Returns result dict."""
    started_at = datetime.now(timezone.utc).isoformat()
    logger.info("=" * 60)
    logger.info("ITERATION %d", iteration)
    logger.info("=" * 60)

    t0 = time.monotonic()

    # Step 1: Context restore
    results_tsv = read_results_tsv()
    backlog = read_backlog()
    git_log = git_ops.log_oneline(5)
    logger.info("Context: %d past results, git HEAD: %s", results_tsv.count("\n") - 1, git_log.split("\n")[0])

    # Step 2: Propose
    logger.info("Step 2: Proposing...")
    try:
        proposal = await llm.propose(copilot, iteration, results_tsv, backlog)
    except Exception as e:
        logger.error("Propose failed: %s", e)
        return _crash_result(iteration, started_at, t0, "Propose failed")
    t1 = time.monotonic()
    logger.info("Proposal: [%s] %s", proposal.type, proposal.title)

    # Step 3: Implement
    logger.info("Step 3: Implementing...")
    try:
        changes = await llm.implement(copilot, proposal)
        apply_file_changes(changes)
    except Exception as e:
        logger.error("Implement failed: %s", e)
        return _crash_result(iteration, started_at, t0, f"Implement failed: {e}")
    t2 = time.monotonic()
    logger.info("  Applied %d file changes", len(changes))

    # Step 4: Commit
    try:
        commit_hash = git_ops.commit(f"autoresearch #{iteration}: {proposal.title}")
    except Exception as e:
        logger.error("Commit failed: %s", e)
        return _crash_result(iteration, started_at, t0, f"Commit failed: {e}")
    logger.info("  Committed: %s", commit_hash)

    # Step 5: Test
    logger.info("Step 5: Testing...")
    changed_files = git_ops.diff_name_only("HEAD~1")
    test_result = tester.run_all(changed_files)
    t3 = time.monotonic()

    # Step 6: Evaluate
    logger.info("Step 6: Evaluating...")
    diff_text = git_ops.diff("HEAD~1")
    try:
        evaluation = await llm.evaluate(
            copilot, proposal, diff_text,
            test_result.passed, test_result.total, test_result.ts_check,
        )
    except Exception as e:
        logger.error("Evaluate failed: %s", e)
        evaluation = llm.Evaluation(
            code_quality=5, feature_value=5, maintainability=5,
            ux_quality=7, total_score=5, verdict="discard", reason=str(e),
        )
    t4 = time.monotonic()

    # Step 7: Keep or Discard
    keep = test_result.all_passed and evaluation.total_score >= 6.0
    status = "keep" if keep else "discard"

    if not keep:
        logger.info("DISCARD: score=%.1f, tests_passed=%s, reason=%s",
                     evaluation.total_score, test_result.all_passed, evaluation.reason)
        git_ops.reset_hard("HEAD~1")
        commit_hash = "none"
    else:
        logger.info("KEEP: score=%.1f — %s", evaluation.total_score, evaluation.reason)

    result = {
        "iteration": iteration,
        "commit": commit_hash,
        "started_at": started_at,
        "propose_sec": int(t1 - t0),
        "implement_sec": int(t2 - t1),
        "test_sec": int(t3 - t2),
        "evaluate_sec": int(t4 - t3),
        "total_sec": int(t4 - t0),
        "tests_passed": test_result.passed,
        "tests_total": test_result.total,
        "ts_check": test_result.ts_check,
        "score": evaluation.total_score,
        "status": status,
        "description": proposal.title,
    }
    append_result(result)
    return result


def _crash_result(iteration: int, started_at: str, t0: float, reason: str) -> dict:
    """Create a crash result entry."""
    result = {
        "iteration": iteration,
        "commit": "none",
        "started_at": started_at,
        "propose_sec": 0,
        "implement_sec": 0,
        "test_sec": 0,
        "evaluate_sec": 0,
        "total_sec": int(time.monotonic() - t0),
        "tests_passed": 0,
        "tests_total": 0,
        "ts_check": "skip",
        "score": 0.0,
        "status": "crash",
        "description": reason,
    }
    append_result(result)
    return result


async def main(iterations: int, start: int | None = None) -> None:
    """Run the autoresearch loop."""
    load_config()

    if start is None:
        start = get_last_iteration() + 1

    logger.info("Starting autoresearch: iterations %d-%d", start, start + iterations - 1)

    copilot = CopilotService()
    try:
        kept = 0
        discarded = 0
        crashed = 0

        for i in range(start, start + iterations):
            result = await run_iteration(copilot, i)
            if result["status"] == "keep":
                kept += 1
            elif result["status"] == "discard":
                discarded += 1
            else:
                crashed += 1

            logger.info(
                "Progress: %d/%d complete (kept=%d, discarded=%d, crashed=%d)",
                i - start + 1, iterations, kept, discarded, crashed,
            )

        logger.info("=" * 60)
        logger.info("AUTORESEARCH COMPLETE")
        logger.info("  Iterations: %d (kept=%d, discarded=%d, crashed=%d)",
                     iterations, kept, discarded, crashed)
        logger.info("  Success rate: %.0f%%", (kept / iterations * 100) if iterations else 0)
        logger.info("=" * 60)

    finally:
        await copilot.close()


def cli() -> None:
    parser = argparse.ArgumentParser(description="Autoresearch runner")
    parser.add_argument("--iterations", type=int, default=20, help="Number of iterations to run")
    parser.add_argument("--start", type=int, default=None, help="Starting iteration (default: auto-detect)")
    args = parser.parse_args()

    setup_logging()
    asyncio.run(main(args.iterations, args.start))


if __name__ == "__main__":
    cli()
