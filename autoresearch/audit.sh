#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Autoresearch Audit Script
# Post-run validation of orchestrator behavior: checks that all subagents
# (proposer, tester, evaluator) were invoked, Playwright tests were thorough,
# results.tsv formatting is correct, scores are reasonable, and timestamps
# are consistent.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_FILE="$SCRIPT_DIR/results.tsv"
LOG_FILE="$SCRIPT_DIR/runner.log"

# Colors
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Counters
ERRORS=0
WARNINGS=0

# ============================================================================
# Argument parsing
# ============================================================================
FROM_ITER=""
TO_ITER=""

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Audits the autoresearch run for correctness: agent invocations, Playwright
test quality, results.tsv formatting, score anomalies, and timestamp integrity.

Options:
  -f, --from <N>    Start auditing from iteration N (default: first in log)
  -t, --to <N>      Audit up to iteration N (default: last in results.tsv)
  -h, --help        Show this help message

Examples:
  $(basename "$0")                  # Audit all iterations
  $(basename "$0") -f 98 -t 117    # Audit iterations 98-117 only
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--from) FROM_ITER="$2"; shift 2 ;;
        -t|--to)   TO_ITER="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1" >&2; usage ;;
    esac
done

# ============================================================================
# Pre-flight checks
# ============================================================================
if [[ ! -f "$RESULTS_FILE" ]]; then
    echo -e "${RED}ERROR: results.tsv not found at $RESULTS_FILE${NC}"
    exit 1
fi
if [[ ! -f "$LOG_FILE" ]]; then
    echo -e "${RED}ERROR: runner.log not found at $LOG_FILE${NC}"
    exit 1
fi

# Determine iteration range
LAST_ITER=$(tail -1 "$RESULTS_FILE" | cut -f1)
if [[ "$LAST_ITER" == "iteration" || -z "$LAST_ITER" ]]; then
    echo -e "${RED}ERROR: results.tsv appears empty${NC}"
    exit 1
fi

FIRST_ITER=$(awk -F'\t' 'NR==2 {print $1}' "$RESULTS_FILE")
[[ -n "$FROM_ITER" ]] && FIRST_ITER="$FROM_ITER"
[[ -n "$TO_ITER" ]] && LAST_ITER="$TO_ITER"

echo "============================================"
echo " Autoresearch Audit Report"
echo " Iterations: $FIRST_ITER — $LAST_ITER"
echo " Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# ============================================================================
# 1. results.tsv format check
# ============================================================================
echo -e "${CYAN}[1/6] results.tsv format check${NC}"

bad_rows=$(awk -F'\t' -v from="$FIRST_ITER" -v to="$LAST_ITER" \
    'NR>1 && $1>=from && $1<=to && NF!=14 {print "  iter "$1": "$NF" fields (expected 14)"}' \
    "$RESULTS_FILE")

if [[ -n "$bad_rows" ]]; then
    echo -e "${RED}  FAIL: Malformed rows found (missing tab separators)${NC}"
    echo "$bad_rows"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}  PASS: All rows have 14 tab-separated fields${NC}"
fi
echo ""

# ============================================================================
# 2. Agent invocation check (Proposer / Tester / Evaluator)
# ============================================================================
echo -e "${CYAN}[2/6] Agent invocation check${NC}"

missing_proposer=""
missing_tester=""
missing_evaluator=""

for i in $(seq "$FIRST_ITER" "$LAST_ITER"); do
    p=$(grep -cE "Proposer.*(Propose |propose )iteration $i\b" "$LOG_FILE" 2>/dev/null || true)
    t=$(grep -cE "Tester.*(QA |test )iteration $i\b" "$LOG_FILE" 2>/dev/null || true)
    e=$(grep -cE "Evaluator.*(Evaluate |evaluate )iteration $i\b" "$LOG_FILE" 2>/dev/null || true)

    [[ "$p" -eq 0 ]] && missing_proposer="$missing_proposer $i"
    [[ "$t" -eq 0 ]] && missing_tester="$missing_tester $i"
    [[ "$e" -eq 0 ]] && missing_evaluator="$missing_evaluator $i"
done

if [[ -z "$missing_proposer" ]]; then
    echo -e "${GREEN}  Proposer:  PASS — called for every iteration${NC}"
else
    echo -e "${RED}  Proposer:  FAIL — missing for iterations:${missing_proposer}${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [[ -z "$missing_tester" ]]; then
    echo -e "${GREEN}  Tester:    PASS — called for every iteration${NC}"
else
    echo -e "${RED}  Tester:    FAIL — missing for iterations:${missing_tester}${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [[ -z "$missing_evaluator" ]]; then
    echo -e "${GREEN}  Evaluator: PASS — called for every iteration${NC}"
else
    echo -e "${RED}  Evaluator: FAIL — missing for iterations:${missing_evaluator}${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# ============================================================================
# 3. Playwright tool usage check
# ============================================================================
echo -e "${CYAN}[3/6] Playwright test depth check${NC}"

shallow_iters=""
for i in $(seq "$FIRST_ITER" "$LAST_ITER"); do
    # Count playwright tool calls between this iteration's tester call and the next iteration
    next=$((i + 1))
    pw_count=$(awk "/Tester.*iteration $i/,/iteration $next|Record iter|Record results/" \
        "$LOG_FILE" 2>/dev/null | grep -c "playwright-browser" || true)

    if [[ "$pw_count" -gt 0 && "$pw_count" -lt 5 ]]; then
        shallow_iters="$shallow_iters $i($pw_count)"
    fi
done

if [[ -z "$shallow_iters" ]]; then
    # Check if any tester was called at all
    any_tester=$(grep -c "Tester.*QA\|Tester.*test" "$LOG_FILE" 2>/dev/null || true)
    if [[ "$any_tester" -gt 0 ]]; then
        echo -e "${GREEN}  PASS: All tested iterations used 5+ Playwright tools${NC}"
    else
        echo -e "${YELLOW}  WARN: No Tester calls found in log — cannot verify Playwright depth${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${YELLOW}  WARN: Shallow Playwright tests (<5 tools): ${shallow_iters}${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

# ============================================================================
# 4. Score anomaly check
# ============================================================================
echo -e "${CYAN}[4/6] Score anomaly check${NC}"

# Check for too many identical scores in a row (sign of self-scoring)
max_streak=0
current_streak=1
prev_score=""
streak_score=""

while IFS=$'\t' read -r iter _ _ _ _ _ _ _ _ _ _ score _ _; do
    if [[ "$score" == "$prev_score" ]]; then
        current_streak=$((current_streak + 1))
        if [[ "$current_streak" -gt "$max_streak" ]]; then
            max_streak=$current_streak
            streak_score=$score
        fi
    else
        current_streak=1
    fi
    prev_score=$score
done < <(awk -F'\t' -v from="$FIRST_ITER" -v to="$LAST_ITER" \
    'NR>1 && $1>=from && $1<=to' "$RESULTS_FILE")

if [[ "$max_streak" -ge 5 ]]; then
    echo -e "${RED}  FAIL: $max_streak consecutive iterations with identical score ($streak_score) — likely self-scoring${NC}"
    ERRORS=$((ERRORS + 1))
elif [[ "$max_streak" -ge 3 ]]; then
    echo -e "${YELLOW}  WARN: $max_streak consecutive identical scores ($streak_score) — may indicate self-scoring${NC}"
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}  PASS: Score diversity looks normal (max streak: $max_streak)${NC}"
fi
echo ""

# ============================================================================
# 5. Timestamp / timing integrity check
# ============================================================================
echo -e "${CYAN}[5/6] Timestamp integrity check${NC}"

negative_timing=""
zero_total=""

while IFS=$'\t' read -r iter _ _ propose impl test eval total _ _ _ _ _ _; do
    # Check for negative timing values
    for val in $propose $impl $test $eval; do
        if [[ "$val" =~ ^-[0-9]+ ]]; then
            negative_timing="$negative_timing $iter"
            break
        fi
    done
    # Check for zero total time (likely missing timing data)
    if [[ "$total" == "0" ]]; then
        zero_total="$zero_total $iter"
    fi
done < <(awk -F'\t' -v from="$FIRST_ITER" -v to="$LAST_ITER" \
    'NR>1 && $1>=from && $1<=to' "$RESULTS_FILE")

if [[ -z "$negative_timing" ]]; then
    echo -e "${GREEN}  Timing:    PASS — no negative durations${NC}"
else
    echo -e "${RED}  Timing:    FAIL — negative durations in iterations:${negative_timing}${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [[ -z "$zero_total" ]]; then
    echo -e "${GREEN}  Total sec: PASS — all iterations have non-zero total${NC}"
else
    echo -e "${YELLOW}  Total sec: WARN — zero total_sec in iterations:${zero_total}${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

# ============================================================================
# 6. Test count regression check
# ============================================================================
echo -e "${CYAN}[6/6] Test count regression check${NC}"

regressions=""
prev_tests=0
prev_iter=0

while IFS=$'\t' read -r iter _ _ _ _ _ _ _ passed total _ _ verdict _; do
    if [[ "$verdict" == "keep" || "$verdict" == "kept" || "$verdict" == "KEEP" ]]; then
        if [[ "$prev_tests" -gt 0 && "$passed" -lt "$prev_tests" ]]; then
            regressions="$regressions $iter(${passed}<${prev_tests})"
        fi
        prev_tests=$passed
        prev_iter=$iter
    fi
done < <(awk -F'\t' -v from="$FIRST_ITER" -v to="$LAST_ITER" \
    'NR>1 && $1>=from && $1<=to' "$RESULTS_FILE")

if [[ -z "$regressions" ]]; then
    echo -e "${GREEN}  PASS: Test count never decreased across kept iterations${NC}"
else
    echo -e "${RED}  FAIL: Test count regressions:${regressions}${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# ============================================================================
# Summary
# ============================================================================
echo "============================================"
if [[ "$ERRORS" -eq 0 && "$WARNINGS" -eq 0 ]]; then
    echo -e "${GREEN}  AUDIT PASSED — no issues found${NC}"
elif [[ "$ERRORS" -eq 0 ]]; then
    echo -e "${YELLOW}  AUDIT PASSED with $WARNINGS warning(s)${NC}"
else
    echo -e "${RED}  AUDIT FAILED — $ERRORS error(s), $WARNINGS warning(s)${NC}"
fi
echo "============================================"

exit "$ERRORS"
