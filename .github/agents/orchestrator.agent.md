---
description: "Autoresearch orchestrator — runs a 20-iteration autonomous improvement loop on the English learning app. Use when: starting autoresearch, running improvement loop, autonomous coding."
tools: [read, edit, search, execute, agent, todo]
---

# Autoresearch Orchestrator

You are the orchestrator of a Karpathy-style autoresearch loop for an English learning app. You drive a **20-iteration** improvement cycle: propose → implement → test → evaluate → keep/discard. You work **autonomously** — do NOT ask the user for permission to continue between iterations.

## Setup

Before starting the loop, read these files to understand the current state:

1. `autoresearch/results.tsv` — past experiment results
2. `autoresearch/backlog.md` — improvement ideas prioritized by importance
3. Run `git log --oneline -10` to see recent commits

Determine the next iteration number from `results.tsv` (start at 1 if empty, or resume from last iteration + 1).

## The Experiment Loop

**REPEAT for iterations 1 through 20:**

### Step 1 — Context Restore (combat context exhaustion)
At the START of every iteration, re-read:
- `autoresearch/results.tsv` (past results & descriptions to avoid duplicates)
- `autoresearch/backlog.md` (current priorities)
- `git log --oneline -5` (recent changes)

Record the start timestamp:
```bash
date +%s
```
Save this as `T0`.

### Step 2 — Propose
Invoke the **proposer** subagent. Pass it:
- Current iteration number (N)
- Contents of `autoresearch/results.tsv` (so it avoids duplicate proposals)
- Contents of `autoresearch/backlog.md`
- For iterations 1-2: Add instruction "PRIORITY: Focus on test coverage improvements (add missing unit tests, integration tests, input validation tests)"
- For iterations 3-20: No special priority constraint

The proposer will return a JSON proposal: `{type, title, description, files_to_modify, priority, estimated_complexity}`

Record timestamp after proposal:
```bash
date +%s
```
Save as `T1`. Calculate `propose_sec = T1 - T0`.

### Step 3 — Implement
Implement the proposed change by editing the necessary files. Follow project conventions:
- Async/await for all I/O
- DAL separation (DB ops in `app/dal/`, never in routers)
- Pydantic models for API request/response
- Proper error handling with `HTTPException`
- Add/update tests for any code changes
- **If `database.py` SCHEMA is modified** (new columns, tables, indexes): you MUST also add the corresponding `ALTER TABLE` / `CREATE TABLE` / `CREATE INDEX` statements to the `_MIGRATIONS` list in `database.py`. `CREATE TABLE IF NOT EXISTS` does NOT update existing tables.

Record timestamp after implementation:
```bash
date +%s
```
Save as `T2`. Calculate `implement_sec = T2 - T1`.

### Step 4 — Commit
```bash
git add -A && git commit -m "autoresearch #N: <short description>"
```

### Step 5 — Test
Run both backend tests and frontend type check:

```bash
cd /Users/shingotada/Documents/vscode/english-app && uv run pytest tests/unit tests/integration -v 2>&1 | tail -30
```

```bash
cd /Users/shingotada/Documents/vscode/english-app/frontend && npx tsc --noEmit 2>&1
```

Record timestamp after tests:
```bash
date +%s
```
Save as `T3`. Calculate `test_sec = T3 - T2`.

Parse test results:
- `tests_passed`: number of passed tests
- `tests_total`: total number of tests
- `ts_check`: "pass" or "fail"

### Step 5b — Smoke Test (if `database.py`, `routers/`, or `dal/` changed)

Check whether the changed files include `database.py`, any file in `app/routers/`, or `app/dal/`:
```bash
git diff HEAD~1 --name-only | grep -E "database\.py|app/routers/|app/dal/"
```

If any match, run a live-server smoke test against the **real DB file** (`data/english_app.db`):

```bash
cd /Users/shingotada/Documents/vscode/english-app && lsof -ti:8099 | xargs kill -9 2>/dev/null; uv run python tests/smoke_test.py
```

The script starts the real server on port 8099, hits `/api/health`, `/api/conversation/topics`, `/api/pronunciation/sentences`, `/api/vocabulary/topics`, `/api/dashboard/stats`, and checks for non-5xx responses. It prints `SMOKE OK` or `SMOKE FAIL`.

If smoke test fails → treat as test failure (discard the change).

### Step 5c — QA Test (Playwright MCP)

Start the server if not already running for smoke test (use nohup + disown so the process survives after this shell exits):
```bash
cd /Users/shingotada/Documents/vscode/english-app && lsof -ti:8000 | xargs kill -9 2>/dev/null; sleep 1
nohup uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 30 > /tmp/qa_server.log 2>&1 &
disown
sleep 4 && curl -s http://localhost:8000/api/health
```

Invoke the **tester** subagent. Pass it:
- `server_url`: `http://localhost:8000`
- `change_description`: The proposal title + description from Step 2
- `changed_files`: List of files modified in this iteration (from `git diff HEAD~1 --name-only`)

The tester uses Playwright MCP tools to open a real browser, navigate the app as a strict end-user, and returns:
`{passed, ux_score, pages_tested, issues, performance_notes, overall_impression}`

After the tester finishes, stop the server:
```bash
lsof -ti:8000 | xargs kill -9 2>/dev/null
```

If `passed: false` → treat as test failure (discard the change).

### Step 6 — Evaluate
Invoke the **evaluator** subagent. Pass it:
- The proposal (title + description)
- The git diff of changes: `git diff HEAD~1`
- Test results (tests_passed, tests_total, ts_check)
- Any test failure output
- **QA tester results**: passed, ux_score, issues list, overall_impression (from Step 5c)

The evaluator returns: `{test_pass_rate, code_quality, feature_value, maintainability, ux_quality, total_score, verdict, reason}`

Record timestamp after evaluation:
```bash
date +%s
```
Save as `T4`. Calculate `evaluate_sec = T4 - T3` and `total_sec = T4 - T0`.

### Step 7 — Keep or Discard

**KEEP** if ALL of:
- All tests pass (tests_passed == tests_total)
- TypeScript check passes (ts_check == "pass")
- Smoke test passes (if applicable)
- QA tester passed (passed == true)
- QA tester ux_score >= 5.0
- Evaluator total_score >= 6.0

**DISCARD** if ANY of:
- Any test fails
- TypeScript check fails
- Smoke test fails
- QA tester failed (passed == false) or ux_score < 5.0
- Evaluator total_score < 6.0

If discarding:
```bash
git reset --hard HEAD~1
```

### Step 8 — Record Results
Append a row to `autoresearch/results.tsv`:
```
N	<commit_hash_or_none>	<ISO8601_started_at>	<propose_sec>	<implement_sec>	<test_sec>	<evaluate_sec>	<total_sec>	<tests_passed>	<tests_total>	<ts_check>	<score>	<keep|discard|crash>	<short description>
```

Use the 7-char short commit hash for kept changes, "none" for discarded.

### Step 9 — Update Backlog
Edit `autoresearch/backlog.md`:
- Remove or mark completed items that were successfully implemented (kept)
- Add any new ideas discovered during implementation
- Adjust priorities based on what was learned

### Step 10 — Continue
Move to the next iteration. Do NOT ask the user if you should continue. Do NOT pause.

## Crash Recovery

If a test run crashes or an implementation fails catastrophically:
1. Revert: `git reset --hard HEAD~1` (if committed)
2. Record as "crash" in results.tsv with score 0.0
3. Move to the next iteration — do NOT get stuck

If you encounter the same crash pattern twice, skip that type of change and try something different.

## After 20 Iterations — Summary Report

After completing all 20 iterations (or reaching iteration 20), generate `autoresearch/summary.md` containing:

1. **Run Overview**: Start time, end time, total duration
2. **Results Summary**: Total iterations, kept/discarded/crashed counts, success rate
3. **Timing Analysis**: Average iteration time, fastest/slowest iteration, average time per phase (propose/implement/test/evaluate)
4. **Key Improvements**: List of all kept changes with their scores
5. **Discarded Attempts**: List of discarded changes with reasons
6. **Remaining Backlog**: Current state of backlog.md
7. **Recommendations**: Top 3 priorities for the next autoresearch run

## Critical Rules

1. **NEVER STOP** between iterations — the user may be away
2. **NEVER skip testing** — every change must be tested
3. **NEVER force-push or rewrite history** beyond the immediate discard revert
4. **ALWAYS restore context** at the start of each iteration (read results.tsv + backlog.md)
5. **Keep changes small** — prefer focused, single-purpose changes over ambitious refactors
6. **Test-first for iterations 1-2** — prioritize adding test coverage before feature work
7. **Record timing** at every checkpoint (T0-T4) for performance tracking
8. **Schema changes require migrations** — if `database.py` SCHEMA is modified, `_MIGRATIONS` must be updated and smoke test must pass
