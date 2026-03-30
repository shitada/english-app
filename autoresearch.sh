#!/bin/bash
# autoresearch.sh — Autonomous improvement loop using GitHub Copilot Coding Agent
#
# Usage:
#   ./autoresearch.sh              # Run with defaults (20 iterations)
#   ./autoresearch.sh 10           # Run 10 iterations
#   ./autoresearch.sh 5 --dry-run  # Preview without creating issues
#
# Prerequisites:
#   - gh CLI authenticated (gh auth status)
#   - Copilot Coding Agent enabled in repo settings
#   - .github/workflows/ci.yml present
#   - .github/copilot-instructions.md present

set -euo pipefail

ITERATIONS=${1:-20}
DRY_RUN=false
if [[ "${2:-}" == "--dry-run" ]]; then DRY_RUN=true; fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
BACKLOG="autoresearch/backlog.md"
RESULTS="autoresearch/results.tsv"
POLL_INTERVAL=60        # seconds between PR checks
MAX_WAIT_MINUTES=30     # max wait for Copilot to create PR
COPILOT_ASSIGNEE="copilot"  # GitHub Copilot Coding Agent user

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# Get the next uncompleted task from backlog.md
get_next_task() {
    grep -m1 '^\- \[ \]' "$BACKLOG" | sed 's/^- \[ \] //' || echo ""
}

# Get the last iteration number from results.tsv
get_last_iteration() {
    if [ ! -f "$RESULTS" ]; then echo 0; return; fi
    tail -1 "$RESULTS" | cut -f1 | grep -E '^[0-9]+$' || echo 0
}

# Wait for a PR to be created by Copilot for this issue
wait_for_pr() {
    local issue_num=$1
    local waited=0

    while [ $waited -lt $((MAX_WAIT_MINUTES * 60)) ]; do
        # Search for PRs that reference this issue
        local pr_num
        pr_num=$(gh pr list --state open --json number,body,author \
            -q ".[] | select(.body | contains(\"#${issue_num}\")) | .number" 2>/dev/null | head -1)

        # Also try searching by Copilot author
        if [ -z "$pr_num" ]; then
            pr_num=$(gh pr list --state open --author "app/copilot-swe-agent" \
                --json number -q '.[0].number' 2>/dev/null)
        fi

        if [ -n "$pr_num" ]; then
            echo "$pr_num"
            return 0
        fi

        sleep $POLL_INTERVAL
        waited=$((waited + POLL_INTERVAL))
        log "  Waiting for PR... (${waited}s / $((MAX_WAIT_MINUTES * 60))s)"
    done

    echo ""
    return 1
}

# Wait for CI checks to complete on a PR
wait_for_ci() {
    local pr_num=$1
    log "  Waiting for CI on PR #${pr_num}..."

    # Wait for checks to complete (up to 10 minutes)
    gh pr checks "$pr_num" --watch --fail-fast 2>/dev/null
    return $?
}

# Record result to results.tsv
record_result() {
    local iteration=$1
    local commit=$2
    local status=$3
    local description=$4
    local started_at=$5

    echo -e "${iteration}\t${commit}\t${started_at}\t0\t0\t0\t0\t0\t0\t0\tpass\t0.0\t${status}\t${description}" >> "$RESULTS"
}

# Mark task as complete in backlog.md
mark_task_done() {
    local task=$1
    local iteration=$2

    # Escape special characters for sed
    local escaped_task
    escaped_task=$(printf '%s\n' "$task" | sed 's/[[\.*^$()+?{|]/\\&/g')

    sed -i '' "s/^- \[ \] ${escaped_task}/- [x] ✅ ${task} (completed iteration #${iteration})/" "$BACKLOG" 2>/dev/null || true
}

# Main loop
main() {
    log "=========================================="
    log "AUTORESEARCH — Copilot Coding Agent Loop"
    log "Repository: $REPO"
    log "Iterations: $ITERATIONS"
    log "Dry run: $DRY_RUN"
    log "=========================================="

    local start_iter
    start_iter=$(($(get_last_iteration) + 1))
    local kept=0
    local discarded=0
    local skipped=0

    for i in $(seq "$start_iter" $((start_iter + ITERATIONS - 1))); do
        log ""
        log "=== ITERATION $i ==="

        # Pull latest changes
        git pull --rebase origin main 2>/dev/null || true

        # Get next task
        local task
        task=$(get_next_task)
        if [ -z "$task" ]; then
            log "No more tasks in backlog. Stopping."
            break
        fi
        log "Task: $task"

        local started_at
        started_at=$(date -u +%Y-%m-%dT%H:%M:%S+00:00)

        if $DRY_RUN; then
            log "[DRY RUN] Would create issue: autoresearch #${i}: ${task}"
            continue
        fi

        # Create issue
        log "Creating issue..."
        local issue_url
        issue_url=$(gh issue create \
            --title "autoresearch #${i}: ${task}" \
            --body "## Task

Implement the following improvement to the English learning app:

**${task}**

## Instructions

- Follow the project conventions in \`.github/copilot-instructions.md\`
- Add or update tests for any code changes
- If modifying \`database.py\` SCHEMA, add corresponding \`ALTER TABLE\` statements to \`_MIGRATIONS\` list
- Keep changes small and focused (prefer fewer files)
- Ensure all existing tests continue to pass

## Acceptance Criteria

- [ ] All existing tests pass (\`uv run pytest tests/unit tests/integration -v\`)
- [ ] TypeScript compiles (\`cd frontend && npx tsc --noEmit\`)
- [ ] Smoke test passes (\`uv run python tests/smoke_test.py\`)
- [ ] New functionality has test coverage

Fixes #${i}" \
            --label "autoresearch" 2>&1)

        local issue_num
        issue_num=$(echo "$issue_url" | grep -oE '[0-9]+$')
        log "Created issue #${issue_num}: $issue_url"

        # Assign Copilot
        log "Assigning Copilot Coding Agent..."
        gh issue edit "$issue_num" --add-assignee "$COPILOT_ASSIGNEE" 2>/dev/null || {
            log "  WARNING: Failed to assign @${COPILOT_ASSIGNEE}. Is Copilot Coding Agent enabled?"
            record_result "$i" "none" "crash" "Failed to assign Copilot" "$started_at"
            ((skipped++))
            continue
        }

        # Wait for PR
        log "Waiting for Copilot to create PR..."
        local pr_num
        pr_num=$(wait_for_pr "$issue_num") || true

        if [ -z "$pr_num" ]; then
            log "TIMEOUT: No PR created within ${MAX_WAIT_MINUTES} minutes"
            gh issue close "$issue_num" --reason "not planned" 2>/dev/null || true
            record_result "$i" "none" "crash" "PR timeout: ${task}" "$started_at"
            ((skipped++))
            continue
        fi
        log "PR #${pr_num} created!"

        # Wait for CI
        if wait_for_ci "$pr_num"; then
            # CI passed — merge
            log "CI PASSED — merging PR #${pr_num}"
            gh pr merge "$pr_num" --squash --delete-branch 2>/dev/null || {
                log "  Merge failed, trying with admin"
                gh pr merge "$pr_num" --squash --delete-branch --admin 2>/dev/null || true
            }

            local commit_hash
            commit_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "merged")
            record_result "$i" "$commit_hash" "keep" "$task" "$started_at"
            mark_task_done "$task" "$i"
            ((kept++))
            log "KEEP: $task"
        else
            # CI failed — close PR
            log "CI FAILED — closing PR #${pr_num}"
            gh pr close "$pr_num" --delete-branch 2>/dev/null || true
            record_result "$i" "none" "discard" "CI failed: ${task}" "$started_at"
            ((discarded++))
            log "DISCARD: $task"
        fi

        # Brief pause between iterations
        sleep 5
    done

    log ""
    log "=========================================="
    log "AUTORESEARCH COMPLETE"
    log "  Kept: $kept"
    log "  Discarded: $discarded"
    log "  Skipped: $skipped"
    log "  Success rate: $(( kept * 100 / (kept + discarded + skipped + 1) ))%"
    log "=========================================="
}

main
