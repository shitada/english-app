---
name: autoresearch-report
description: "Generate a detailed report of recent autoresearch iterations. Use when the user asks about iteration results, autoresearch run status, what changed recently, or for a summary of the latest improvements. Also use when asked about feature vs bugfix ratio, test counts, agent invocations, or Playwright test quality."
allowed-tools: shell
---

# Autoresearch Report Skill

Generate a formatted report of autoresearch iteration results.

## How to use

Run the `report.sh` script from this skill's directory to collect raw data, then format it into a readable report.

### Step 1: Determine the iteration range

If the user specifies a range (e.g., "last 10 iterations" or "iter 250-269"), use that.
Otherwise, determine the latest iteration from results.tsv:

```bash
tail -1 autoresearch/results.tsv | cut -f1
```

For "latest run", look at the most recent 20 iterations. For "all", use the full range.

### Step 2: Run the report script

```bash
bash .github/skills/autoresearch-report/report.sh -f <FROM> -t <TO>
```

### Step 3: Format the output

Parse the script output and present it as a well-formatted report with these sections:

#### Iteration Details Table

Format each `ITER|...` line as a table row:

| iter | Category | Score | Status | Description | Commit | Changes | Files | Timing |
|------|----------|-------|--------|-------------|--------|---------|-------|--------|

- **Category**: `feature` in bold green, `bugfix` normal, `perf` in italic
- **Status**: `keep`/`kept` = ✅, `discard` = ❌
- **Commit**: Link format `[hash](hash)` using the 7-char hash
- **Description**: Use the detailed description from the report (includes commit body if available)
- **Changes**: Show as `+N/-M` (insertions/deletions)
- **Timing**: Show total seconds

#### Summary Statistics

From the `=== SUMMARY ===` section, present:
- Total iterations, keep/discard counts and rates
- Feature vs bugfix ratio (highlight if features are below 20%)
- Score stats (avg, min, max)
- Test count progression (start → end, delta)

#### Premium Requests

From `=== PREMIUM REQUESTS ===`, show total count.

#### Agent Invocation Status

From `=== AGENT INVOCATIONS ===`:
- Show Proposer/Tester/Evaluator call rates
- List any `AGENT_SKIP` iterations with which agents were skipped
- Flag if any agent has >20% skip rate as a warning

#### Playwright Test Details

From `=== PLAYWRIGHT TEST DETAILS ===`:
- Show which iterations had Playwright tests
- List the Playwright tools used per iteration
- Flag if any tested iteration used fewer than 5 tools as "shallow test"
- If no Playwright tests were run, note whether that's expected (all bugfixes, no frontend changes)

#### Audit Findings

From `=== AUDIT FINDINGS ===`:
- Parse the JSON and present issues by severity (error > warning)
- Include root cause and confidence level
- Suggest improvements for any HIGH confidence issues

#### Most Changed Files

From `=== MOST CHANGED FILES ===`:
- Show top 5 most frequently modified files as a list

#### Backlog Status

From `=== BACKLOG STATUS ===`:
- Show completed vs remaining counts
- List remaining items

### Step 4: Provide analysis

After the formatted data, add a brief analysis section:

- **Highlights**: What went well (high scores, feature completions, test additions)
- **Concerns**: Issues found (agent skips, low scores, discard rate)
- **Recommendations**: Actionable next steps based on the data
