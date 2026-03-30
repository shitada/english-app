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

# Defaults
ADDITIONAL_ITERATIONS=20
MAX_INVOCATIONS=10
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
  --dry-run                 Show what would be executed without running
  -h, --help                Show this help message

Examples:
  $(basename "$0") -n 10                # Run 10 more iterations from current state
  $(basename "$0") -n 10 -m 5           # Run 10 more, max 5 copilot calls
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

    cat <<EOF
Read autoresearch/results.tsv and autoresearch/backlog.md to understand current state.
Resume the autoresearch improvement loop starting from iteration ${next_iter}.
Run up to ${remaining} more iterations (target: iteration ${target}).
Follow your orchestrator instructions precisely — propose, implement, test, evaluate, keep/discard — for each iteration.
Record timing at every checkpoint. If you complete all target iterations, generate autoresearch/summary.md.
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
    TARGET_ITERATIONS=$((start_iter + ADDITIONAL_ITERATIONS))

    log "=========================================="
    log "Autoresearch CLI Runner started"
    log "Current iteration: $start_iter"
    log "Additional iters:  $ADDITIONAL_ITERATIONS"
    log "Target iteration:  $TARGET_ITERATIONS"
    log "Max invocations:   $MAX_INVOCATIONS"
    log "Project dir:       $PROJECT_DIR"
    log "=========================================="

    check_git_clean

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

        # Execute copilot
        local start_ts
        start_ts=$(date +%s)
        log "Starting copilot invocation..."

        set +e
        copilot -p "$prompt" \
            --agent=orchestrator \
            --allow-all-tools \
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

        # Brief pause before next invocation
        if ! $INTERRUPTED; then
            sleep 3
        fi
    done

    # Final summary
    local final_iter
    final_iter=$(get_current_iteration)
    log "=========================================="
    log "Runner finished"
    log "Total invocations: $invocation"
    log "Final iteration:   $final_iter / $TARGET_ITERATIONS"
    log "=========================================="
}

main
