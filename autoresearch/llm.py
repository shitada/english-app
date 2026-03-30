"""LLM wrapper for autoresearch — propose, implement, evaluate via Copilot SDK."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.copilot_client import CopilotService

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Proposal:
    type: str
    title: str
    description: str
    files_to_modify: list[str]
    priority: str
    estimated_complexity: str


@dataclass
class Evaluation:
    code_quality: float
    feature_value: float
    maintainability: float
    ux_quality: float
    total_score: float
    verdict: str
    reason: str


@dataclass
class FileChange:
    path: str
    content: str


def _read_agent_md(name: str) -> str:
    """Read the body (below frontmatter) of an agent md file."""
    path = ROOT / ".github" / "agents" / f"{name}.agent.md"
    text = path.read_text(encoding="utf-8")
    # Strip YAML frontmatter
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            text = text[end + 3:].strip()
    return text


def _parse_json(raw: str) -> dict[str, Any]:
    """Extract JSON from LLM response (handles markdown fences)."""
    json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    brace_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Failed to parse JSON: {raw[:200]}")


async def propose(
    copilot: CopilotService,
    iteration: int,
    results_tsv: str,
    backlog: str,
) -> Proposal:
    """Ask the LLM to propose one improvement."""
    # Use a compact system prompt instead of the full proposer.agent.md
    system = """You are an analyst for an English learning app (FastAPI + React + TypeScript + SQLite).
Propose exactly ONE focused improvement. Return ONLY a JSON object:
{"type":"test|bugfix|feature|refactor","title":"short title","description":"what to change and why, include file paths","files_to_modify":["path/to/file.py"],"priority":"high|medium|low","estimated_complexity":"small|medium|large"}
Constraints: max 5 files, no duplicates from past experiments, respect async/await and DAL separation conventions."""

    # Only send the description column from past results (not full TSV)
    past_descriptions = []
    for line in results_tsv.strip().splitlines()[1:]:  # skip header
        parts = line.split("\t")
        if len(parts) >= 14:
            past_descriptions.append(f"  {parts[0]}: [{parts[12]}] {parts[13]}")

    # Trim backlog to only uncompleted items
    backlog_lines = []
    for line in backlog.splitlines():
        if line.strip().startswith("- [ ]"):
            backlog_lines.append(line.strip())

    priority_note = ""
    if iteration <= 2:
        priority_note = "PRIORITY: Focus on test coverage improvements.\n"

    user_prompt = f"""Iteration {iteration}. {priority_note}
Past experiments (avoid duplicates):
{chr(10).join(past_descriptions[-10:]) if past_descriptions else "  (none)"}

Uncompleted backlog:
{chr(10).join(backlog_lines) if backlog_lines else "  (none)"}

Return one JSON proposal."""

    raw = await copilot.ask(system, user_prompt, timeout=300)
    data = _parse_json(raw)
    return Proposal(
        type=data.get("type", "unknown"),
        title=data.get("title", "untitled"),
        description=data.get("description", ""),
        files_to_modify=data.get("files_to_modify", []),
        priority=data.get("priority", "medium"),
        estimated_complexity=data.get("estimated_complexity", "medium"),
    )


async def implement(
    copilot: CopilotService,
    proposal: Proposal,
) -> list[FileChange]:
    """Ask the LLM to generate code changes for the proposal."""
    # Read current content of files to modify
    file_contexts = []
    for fp in proposal.files_to_modify:
        full = ROOT / fp
        if full.exists():
            content = full.read_text(encoding="utf-8")
            file_contexts.append(f"=== {fp} (current content) ===\n{content}\n")
        else:
            file_contexts.append(f"=== {fp} (NEW FILE — does not exist yet) ===\n")

    system = """You are an expert Python/TypeScript developer implementing changes to an English learning app.
Project conventions: async/await for all I/O, DAL separation (DB ops in app/dal/), Pydantic models, HTTPException for errors, pytest for tests.
When modifying database.py SCHEMA, always add corresponding ALTER TABLE to _MIGRATIONS list.

You MUST return your changes as a JSON array of file objects:
```json
[
  {"path": "relative/path/to/file.py", "content": "full file content here"},
  {"path": "relative/path/to/new_file.py", "content": "full file content here"}
]
```
Return the COMPLETE file content (not diffs). Include ALL files that need to be created or modified."""

    user_prompt = f"""## Proposal
Type: {proposal.type}
Title: {proposal.title}
Description: {proposal.description}
Files to modify: {', '.join(proposal.files_to_modify)}

## Current File Contents
{''.join(file_contexts)}

Implement this proposal. Return the complete updated content for each file as a JSON array."""

    raw = await copilot.ask(system, user_prompt, timeout=300)

    # Parse the JSON array of file changes
    # Try to find a JSON array in the response
    bracket_match = re.search(r"\[.*\]", raw, re.DOTALL)
    if bracket_match:
        try:
            items = json.loads(bracket_match.group(0))
            return [FileChange(path=item["path"], content=item["content"]) for item in items]
        except (json.JSONDecodeError, KeyError):
            pass

    # Fallback: try to find individual ```json blocks with path/content
    changes = []
    for m in re.finditer(r"```(?:json)?\s*\n(\{.*?\})\s*```", raw, re.DOTALL):
        try:
            item = json.loads(m.group(1))
            if "path" in item and "content" in item:
                changes.append(FileChange(path=item["path"], content=item["content"]))
        except json.JSONDecodeError:
            continue
    if changes:
        return changes

    raise ValueError(f"Failed to parse file changes from LLM response ({len(raw)} chars)")


async def evaluate(
    copilot: CopilotService,
    proposal: Proposal,
    diff: str,
    test_passed: int,
    test_total: int,
    ts_check: str,
    qa_passed: bool | None = None,
    qa_ux_score: float | None = None,
    qa_issues: str = "",
) -> Evaluation:
    """Ask the LLM to evaluate the changes."""
    system = """You are a code reviewer for an English learning app. Score changes on:
- code_quality (1-10, weight 25%): conventions, security, readability. If database.py SCHEMA changed but _MIGRATIONS not updated, score ≤3.
- feature_value (1-10, weight 25%): value to English learners
- maintainability (1-10, weight 30%): test coverage, coupling, backward compatibility
- ux_quality (1-10, weight 20%): user experience quality
Formula: total = code*0.25 + feature*0.25 + maintain*0.3 + ux*0.2
Verdict: keep if total≥6.0 AND tests pass, else discard.
Return ONLY JSON: {"code_quality":N,"feature_value":N,"maintainability":N,"ux_quality":N,"total_score":N.N,"verdict":"keep|discard","reason":"one sentence"}"""

    # Truncate diff to avoid token overflow
    diff_truncated = diff[:6000] if len(diff) > 6000 else diff

    user_prompt = f"""Proposal: {proposal.title}
Tests: {test_passed}/{test_total}, tsc: {ts_check}
QA: passed={qa_passed}, ux_score={qa_ux_score}

Diff:
```
{diff_truncated}
```

Return JSON evaluation."""

    raw = await copilot.ask(system, user_prompt, timeout=300)
    data = _parse_json(raw)
    return Evaluation(
        code_quality=data.get("code_quality", 5),
        feature_value=data.get("feature_value", 5),
        maintainability=data.get("maintainability", 5),
        ux_quality=data.get("ux_quality", 7),
        total_score=data.get("total_score", 5),
        verdict=data.get("verdict", "discard"),
        reason=data.get("reason", "no reason"),
    )
