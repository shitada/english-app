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
    proposer_instructions = _read_agent_md("proposer")

    priority_note = ""
    if iteration <= 2:
        priority_note = "\nPRIORITY: Focus on test coverage improvements.\n"

    user_prompt = f"""Current iteration: {iteration}
{priority_note}
Results TSV (past experiments — avoid duplicates):
```
{results_tsv}
```

Backlog:
```
{backlog}
```

Read the codebase files as needed, then return exactly one focused proposal as JSON."""

    raw = await copilot.ask(proposer_instructions, user_prompt, timeout=300)
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
    evaluator_instructions = _read_agent_md("evaluator")

    user_prompt = f"""Proposal title: {proposal.title}
Proposal description: {proposal.description}

Test results:
- tests_passed: {test_passed}
- tests_total: {test_total}
- ts_check: {ts_check}

QA tester results:
- qa_passed: {qa_passed if qa_passed is not None else 'not run'}
- qa_ux_score: {qa_ux_score if qa_ux_score is not None else 'not run'}
- qa_issues: {qa_issues or 'none'}

Git diff:
```
{diff[:8000]}
```

Return your evaluation as JSON."""

    raw = await copilot.ask(evaluator_instructions, user_prompt, timeout=300)
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
