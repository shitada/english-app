#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Autoresearch CLI Runner
# Repeatedly invokes the orchestrator agent via GitHub Copilot CLI until
# the target number of iterations is reached in results.tsv.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_FILE="$SCRIPT_DIR/results.tsv"
LOG_FILE="$SCRIPT_DIR/runner.log"
LOGS_DIR="$SCRIPT_DIR/logs"
MAX_SESSION_LOGS=5

# Defaults
ADDITIONAL_ITERATIONS=20
MAX_INVOCATIONS=10
MAX_PER_INVOCATION=2
FEATURE_RATIO=20
DRY_RUN=false

# ============================================================================
# Usage
# ============================================================================
usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Runs the autoresearch orchestrator agent in a loop via GitHub Copilot CLI.
Each invocation typically completes 3-5 iterations before context exhaustion.
The script automatically re-invokes until the target iteration count is reached.

Options:
  -n, --iterations <N>      Number of additional iterations to run (default: $ADDITIONAL_ITERATIONS)
  -m, --max-invocations <N> Maximum copilot invocations to prevent runaway (default: $MAX_INVOCATIONS)
  --max-per-invocation <N>  Max iterations per copilot invocation (default: $MAX_PER_INVOCATION)
  --feature-ratio <N>       Percentage of iterations that should be features (default: $FEATURE_RATIO)
  --dry-run                 Show what would be executed without running
  -h, --help                Show this help message

Examples:
  $(basename "$0") -n 10                # Run 10 more iterations from current state
  $(basename "$0") -n 10 -m 5           # Run 10 more, max 5 copilot calls
  $(basename "$0") -n 10 --feature-ratio 30  # 30% features (3 of 10)
  $(basename "$0") --dry-run -n 20      # Preview without executing
EOF
    exit 0
}

# ============================================================================
# Argument parsing
# ============================================================================
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--iterations)
            ADDITIONAL_ITERATIONS="$2"; shift 2 ;;
        -m|--max-invocations)
            MAX_INVOCATIONS="$2"; shift 2 ;;
        --max-per-invocation)
            MAX_PER_INVOCATION="$2"; shift 2 ;;
        --feature-ratio)
            FEATURE_RATIO="$2"; shift 2 ;;
        --dry-run)
            DRY_RUN=true; shift ;;
        -h|--help)
            usage ;;
        *)
            echo "Unknown option: $1" >&2; usage ;;
    esac
done

# ============================================================================
# Helpers
# ============================================================================
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

get_current_iteration() {
    if [[ ! -f "$RESULTS_FILE" ]]; then
        echo 0
        return
    fi
    # Get the last line's first field (iteration number), skip header
    local last
    last=$(tail -1 "$RESULTS_FILE" | cut -f1)
    if [[ "$last" == "iteration" || -z "$last" ]]; then
        echo 0
    else
        echo "$last"
    fi
}

check_git_clean() {
    cd "$PROJECT_DIR"
    if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
        log "WARNING: Working tree has uncommitted changes"
        git status --short | head -5 | while read -r line; do log "  $line"; done
        log "Continuing anyway..."
    fi
}

# ============================================================================
# Signal handling
# ============================================================================
INTERRUPTED=false
cleanup() {
    INTERRUPTED=true
    log "Received interrupt signal — stopping after current invocation"
}
trap cleanup SIGINT SIGTERM

# ============================================================================
# Build prompt
# ============================================================================
build_prompt() {
    local current_iter="$1"
    local target="$2"
    local next_iter=$((current_iter + 1))
    local remaining=$((target - current_iter))

    # Cap iterations per invocation to prevent context exhaustion.
    # Controlled by --max-per-invocation CLI arg (not hardcoded, survives git resets).
    if [[ "$remaining" -gt "$MAX_PER_INVOCATION" ]]; then
        remaining=$MAX_PER_INVOCATION
    fi

    # Calculate feature quota for this run
    local feature_target=$(( ADDITIONAL_ITERATIONS * FEATURE_RATIO / 100 ))
    [[ "$feature_target" -lt 1 ]] && feature_target=1

    # Count features already kept in this run (from START_ITER onwards)
    local features_done=0
    if [[ -f "$RESULTS_FILE" ]]; then
        features_done=$(awk -F'\t' -v start="$START_ITER" \
            'NR>1 && $1>start && ($13=="keep" || $13=="kept" || $13=="KEPT") && $14 ~ /^(Add|Enhance|Implement|Wire|Create)/' \
            "$RESULTS_FILE" | wc -l | tr -d ' ')
    fi
    local features_remaining=$((feature_target - features_done))
    [[ "$features_remaining" -lt 0 ]] && features_remaining=0

    # Determine if this iteration should be forced to feature
    local feature_instruction=""
    if [[ "$features_remaining" -gt 0 ]]; then
        feature_instruction="7. **FEATURE REQUIRED**: This run targets ${feature_target} features (${features_done} done, ${features_remaining} remaining). Tell the proposer: 'You MUST return type=feature or type=ux. Do NOT return type=bugfix. Pick the highest priority uncompleted feature from the backlog.'"
    fi

    cat <<EOF
## MANDATORY RULES — read before doing ANYTHING:
1. You MUST call the **proposer** subagent via runSubagent for EVERY iteration. Do NOT propose changes yourself.
2. You MUST call the **evaluator** subagent via runSubagent for EVERY iteration. Do NOT assign scores yourself.
3. You MUST call the **tester** subagent via runSubagent when the proposal type is "feature" or "ux" AND any frontend .tsx file in pages/ or components/ was changed. Check with: \`git diff HEAD~1 --name-only | grep -E 'frontend/src/(pages|components)/.*\\.tsx$'\`
4. Use \`printf\` with explicit \\t to write to results.tsv. NEVER use \`echo -e\`.
5. Read only the last 20 rows of results.tsv (use \`tail -20\`), not the full file.
6. Before recording results, verify: Did I call proposer? Did I call evaluator? If frontend .tsx changed and type is feature/ux, did I call tester? If NO → STOP and call them NOW.
${feature_instruction}

## Task:
Resume the autoresearch improvement loop starting from iteration ${next_iter}.
**Run EXACTLY ${remaining} iteration(s), then STOP.** Do NOT run more than ${remaining}. After completing ${remaining} iteration(s), stop immediately — the runner will re-invoke you for more.
Read ONLY uncompleted backlog items: \`grep '^- \\[ \\]' autoresearch/backlog.md\` — do NOT read completed items.
Read \`tail -20 autoresearch/results.tsv\` to see recent results.
If a session log exists in \`autoresearch/logs/\`, read ONLY the last 50 lines (\`tail -50 <file>\`). Do NOT read the full session log.
Follow your orchestrator instructions for each iteration: propose → implement → test → evaluate → keep/discard.
EOF
}

# ============================================================================
# Main loop
# ============================================================================
main() {
    cd "$PROJECT_DIR"

    # Calculate absolute target from current state + additional
    local start_iter
    start_iter=$(get_current_iteration)
    START_ITER=$start_iter
    TARGET_ITERATIONS=$((start_iter + ADDITIONAL_ITERATIONS))

    log "=========================================="
    log "Autoresearch CLI Runner started"
    log "Current iteration: $start_iter"
    log "Additional iters:  $ADDITIONAL_ITERATIONS"
    log "Target iteration:  $TARGET_ITERATIONS"
    log "Feature ratio:     ${FEATURE_RATIO}% ($(( ADDITIONAL_ITERATIONS * FEATURE_RATIO / 100 )) features target)"
    log "Max invocations:   $MAX_INVOCATIONS"
    log "Max per invoc:     $MAX_PER_INVOCATION"
    log "Project dir:       $PROJECT_DIR"
    log "=========================================="

    check_git_clean

    # Auto-clean backlog: archive completed items to keep context small
    local backlog_file="$PROJECT_DIR/autoresearch/backlog.md"
    if [[ -f "$backlog_file" ]]; then
        local completed_count
        completed_count=$(grep -c '^- \[x\]' "$backlog_file" 2>/dev/null || true)
        if [[ "$completed_count" -gt 10 ]]; then
            log "Archiving $completed_count completed backlog items..."
            awk '/^#/ || /^$/ || /^- \[ \]/ || /^Improvement ideas/' "$backlog_file" > "${backlog_file}.tmp"
            mv "${backlog_file}.tmp" "$backlog_file"
            local new_count
            new_count=$(wc -l < "$backlog_file")
            log "Backlog cleaned: $new_count lines remain"
        fi
    fi

    # Rotate runner.log at start of each run
    if [[ -f "$LOG_FILE" ]]; then
        mv "$LOG_FILE" "${LOG_FILE}.prev"
        log "Rotated previous runner.log to runner.log.prev"
    fi

    # Ensure logs directory exists
    mkdir -p "$LOGS_DIR"

    local invocation=0

    while true; do
        # Check interrupt
        if $INTERRUPTED; then
            log "Interrupted — exiting"
            break
        fi

        # Check current progress
        local current
        current=$(get_current_iteration)
        log "Current iteration count: $current / $TARGET_ITERATIONS"

        # Target reached?
        if [[ "$current" -ge "$TARGET_ITERATIONS" ]]; then
            log "Target reached ($current >= $TARGET_ITERATIONS) — done!"
            break
        fi

        # Max invocations reached?
        invocation=$((invocation + 1))
        if [[ "$invocation" -gt "$MAX_INVOCATIONS" ]]; then
            log "Max invocations reached ($MAX_INVOCATIONS) — stopping"
            log "Progress: iteration $current / $TARGET_ITERATIONS"
            break
        fi

        # Build prompt
        local prompt
        prompt=$(build_prompt "$current" "$TARGET_ITERATIONS")

        log "------------------------------------------"
        log "Invocation $invocation / $MAX_INVOCATIONS"
        log "Resuming from iteration $((current + 1))"
        log "------------------------------------------"

        if $DRY_RUN; then
            echo ""
            echo "[DRY RUN] Would execute:"
            echo "  cd $PROJECT_DIR"
            echo "  copilot -p \"<prompt>\" --agent=orchestrator --allow-all-tools"
            echo ""
            echo "  Prompt:"
            echo "$prompt" | sed 's/^/    /'
            echo ""
            continue
        fi

        # Execute copilot with session log
        local start_ts
        start_ts=$(date +%s)
        local session_file="$LOGS_DIR/session-iter-$((current + 1))-to-${TARGET_ITERATIONS}.md"
        log "Starting copilot invocation (session log: $session_file)..."

        set +e
        copilot -p "$prompt" \
            --agent=orchestrator \
            --allow-all-tools \
            --model claude-opus-4.6 \
            --share="$session_file" \
            2>&1 | tee -a "$LOG_FILE"
        local exit_code=$?
        set -e

        local end_ts
        end_ts=$(date +%s)
        local duration=$((end_ts - start_ts))

        if [[ $exit_code -ne 0 ]]; then
            log "Copilot exited with code $exit_code (duration: ${duration}s)"
            log "Will retry in next invocation..."
        else
            log "Copilot invocation completed (duration: ${duration}s)"
        fi

        # Post-invocation audit: diagnose + fix issues before next invocation
        local new_iter
        new_iter=$(get_current_iteration)
        if [[ "$new_iter" -gt "$current" ]]; then
            # Playwright test depth verification for UI-changing iterations
            log "Verifying Playwright test depth..."
            for iter_num in $(seq $((current + 1)) "$new_iter"); do
                local iter_commit
                iter_commit=$(awk -F'\t' -v n="$iter_num" 'NR>1 && $1==n {print $2}' "$RESULTS_FILE")
                if [[ -z "$iter_commit" || "$iter_commit" == "none" ]]; then
                    continue
                fi

                local has_ui_change
                has_ui_change=$(git diff --name-only "${iter_commit}~1..${iter_commit}" 2>/dev/null \
                    | grep -cE "frontend/src/(pages|components)/.*\.tsx$" || true)

                if [[ "$has_ui_change" -gt 0 ]]; then
                    local next_iter=$((iter_num + 1))
                    local pw_count
                    pw_count=$(awk "/Tester.*iteration $iter_num/,/iteration $next_iter|Record iter|Record results/" \
                        "$LOG_FILE" 2>/dev/null | grep -c "playwright-browser" || true)

                    local pw_has_snapshot
                    pw_has_snapshot=$(awk "/Tester.*iteration $iter_num/,/iteration $next_iter|Record iter|Record results/" \
                        "$LOG_FILE" 2>/dev/null | grep -c "playwright-browser_snapshot\|playwright-browser_take_screenshot" || true)

                    local pw_has_interaction
                    pw_has_interaction=$(awk "/Tester.*iteration $iter_num/,/iteration $next_iter|Record iter|Record results/" \
                        "$LOG_FILE" 2>/dev/null | grep -c "playwright-browser_click\|playwright-browser_type\|playwright-browser_evaluate" || true)

                    if [[ "$pw_count" -eq 0 ]]; then
                        log "  PW_SKIP iter=$iter_num — UI changed but NO Playwright test was run"
                    elif [[ "$pw_count" -lt 5 ]]; then
                        log "  PW_SHALLOW iter=$iter_num — only $pw_count tool calls (min 10 expected)"
                    elif [[ "$pw_has_snapshot" -eq 0 ]]; then
                        log "  PW_NO_SNAPSHOT iter=$iter_num — no snapshot taken, test quality suspect"
                    elif [[ "$pw_has_interaction" -eq 0 ]]; then
                        log "  PW_NO_INTERACT iter=$iter_num — no click/type/evaluate, test quality suspect"
                    else
                        log "  PW_OK iter=$iter_num — $pw_count tools, snapshot=$pw_has_snapshot, interact=$pw_has_interaction"
                    fi
                else
                    log "  PW_NA iter=$iter_num — no UI file changes, Playwright test not required"
                fi
            done

            log "Running post-invocation audit (iter $((current + 1))-$new_iter)..."
            set +e
            bash "$SCRIPT_DIR/audit.sh" --fix \
                -f "$((current + 1))" -t "$new_iter" \
                2>&1 | tee -a "$LOG_FILE"
            local audit_exit=$?
            set -e
            if [[ "$audit_exit" -gt 0 ]]; then
                log "Audit found $audit_exit error(s) — fixes applied where possible"
            else
                log "Audit passed — no issues"
            fi
        fi

        # Clean up old session logs (keep only MAX_SESSION_LOGS most recent)
        local log_count
        log_count=$(find "$LOGS_DIR" -name 'invocation-*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
        if [[ "$log_count" -gt "$MAX_SESSION_LOGS" ]]; then
            find "$LOGS_DIR" -name 'invocation-*.md' -type f | sort | head -n "$((log_count - MAX_SESSION_LOGS))" | xargs rm -f
            log "Cleaned up old session logs (kept $MAX_SESSION_LOGS)"
        fi

        # Brief pause before next invocation
        if ! $INTERRUPTED; then
            sleep 3
        fi
    done

    # Final summary
    local final_iter
    final_iter=$(get_current_iteration)

    # Tally premium requests from this run's log output
    local total_premium=0
    if [[ -f "$LOG_FILE" ]]; then
        while IFS= read -r n; do
            total_premium=$((total_premium + n))
        done < <(grep "Total usage est:" "$LOG_FILE" | grep -o '[0-9]\+ Premium' | grep -o '[0-9]\+')
    fi

    log "=========================================="
    log "Runner finished"
    log "Total invocations: $invocation"
    log "Final iteration:   $final_iter / $TARGET_ITERATIONS"
    log "Premium requests:  $total_premium"
    log "=========================================="

    echo ""
    echo "  Premium requests used this run: $total_premium"
    echo ""
}

main
