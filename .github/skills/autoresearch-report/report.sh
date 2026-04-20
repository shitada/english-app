#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Autoresearch Report Generator
# Collects data from results.tsv, git log, runner.log, and audit for reporting.
# Output: structured text that SKILL.md instructs Copilot to format.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RESULTS_FILE="$PROJECT_DIR/autoresearch/results.tsv"
LOG_FILE="$PROJECT_DIR/autoresearch/runner.log"
AUDIT_REPORT="$PROJECT_DIR/autoresearch/audit-report.json"

FROM_ITER=""
TO_ITER=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--from) FROM_ITER="$2"; shift 2 ;;
        -t|--to)   TO_ITER="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# Determine range
LAST_ITER=$(awk -F'\t' 'NR>1 && $1 ~ /^[0-9]+$/ {last=$1} END {print last}' "$RESULTS_FILE")
FIRST_ITER=$(awk -F'\t' 'NR==2 && $1 ~ /^[0-9]+$/ {print $1}' "$RESULTS_FILE")
[[ -n "$FROM_ITER" ]] && FIRST_ITER="$FROM_ITER"
[[ -n "$TO_ITER" ]] && LAST_ITER="$TO_ITER"

echo "=== AUTORESEARCH REPORT ==="
echo "Range: iteration $FIRST_ITER — $LAST_ITER"
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ============================================================================
# 1. Iteration details
# ============================================================================
echo "=== ITERATION DETAILS ==="

cd "$PROJECT_DIR"

while IFS=$'\t' read -r iter commit date propose impl test eval total passed total_tests ts score verdict desc; do
    # Skip if outside range
    [[ ! "$iter" =~ ^[0-9]+$ ]] && continue

    # Determine category from description
    category="bugfix"
    case "$desc" in
        Add*|Enhance*|Implement*|Wire*|Create*) category="feature" ;;
        *perf*|*index*|*scan*|*optimize*|*consolidate*) category="perf" ;;
        *test*|*Test*) category="test" ;;
    esac

    # Get code change stats from git
    changes=""
    files_changed=""
    if [[ "$commit" != "none" && -n "$commit" ]]; then
        stat_line=$(git diff --shortstat "${commit}~1..${commit}" 2>/dev/null || echo "")
        if [[ -n "$stat_line" ]]; then
            files_changed=$(echo "$stat_line" | grep -oE '[0-9]+ file' | grep -oE '[0-9]+')
            insertions=$(echo "$stat_line" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
            deletions=$(echo "$stat_line" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")
            changes="+${insertions:-0}/-${deletions:-0}"
        fi
        # Get changed file list
        changed_files=$(git diff --name-only "${commit}~1..${commit}" 2>/dev/null \
            | grep -v "autoresearch/\|runner.log" \
            | head -5 \
            | tr '\n' ', ' \
            | sed 's/,$//')
    else
        changes="(reverted)"
        changed_files=""
    fi

    # Detailed description from git commit message
    detailed_desc="$desc"
    if [[ "$commit" != "none" && -n "$commit" ]]; then
        full_msg=$(git log -1 --format="%B" "$commit" 2>/dev/null | head -5)
        # Use multi-line commit message if available
        body=$(echo "$full_msg" | tail -n +3 | head -3 | tr '\n' ' ' | sed 's/  */ /g' | sed 's/^ //')
        if [[ -n "$body" ]]; then
            detailed_desc="$desc — $body"
        fi
    fi

    echo "ITER|${iter}|${category}|${score}|${verdict}|${detailed_desc}|${commit}|${changes}|${files_changed:-0} files|${changed_files}|propose=${propose}s impl=${impl}s test=${test}s eval=${eval}s total=${total}s|tests=${passed}/${total_tests}"
done < <(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t' "$RESULTS_FILE")

echo ""

# ============================================================================
# 2. Summary statistics
# ============================================================================
echo "=== SUMMARY ==="

total_iters=$(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t' "$RESULTS_FILE" | wc -l | tr -d ' ')
kept=$(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t && (tolower($13)=="keep" || tolower($13)=="kept")' "$RESULTS_FILE" | wc -l | tr -d ' ')
discarded=$(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t && tolower($13)=="discard"' "$RESULTS_FILE" | wc -l | tr -d ' ')

# Category counts (from descriptions)
features=$(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t && $14 ~ /^(Add|Enhance|Implement|Wire|Create)/' "$RESULTS_FILE" | wc -l | tr -d ' ')
bugfixes=$((total_iters - features))

# Score stats
scores=$(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t {print $12}' "$RESULTS_FILE")
avg_score=$(echo "$scores" | awk '{sum+=$1; n++} END {if(n>0) printf "%.2f", sum/n; else print "0"}')
max_score=$(echo "$scores" | sort -n | tail -1)
min_score=$(echo "$scores" | sort -n | head -1)

# Test count progression
first_tests=$(awk -F'\t' -v f="$FIRST_ITER" 'NR>1 && $1==f {print $9}' "$RESULTS_FILE")
last_tests=$(awk -F'\t' -v t="$LAST_ITER" 'NR>1 && $1==t {print $9}' "$RESULTS_FILE")

echo "Total iterations: $total_iters"
echo "Kept: $kept | Discarded: $discarded | Discard rate: $(( discarded * 100 / (total_iters > 0 ? total_iters : 1) ))%"
echo "Features: $features ($(( features * 100 / (total_iters > 0 ? total_iters : 1) ))%) | Bugfixes+other: $bugfixes"
echo "Scores: avg=$avg_score min=$min_score max=$max_score"
echo "Tests: $first_tests → $last_tests ($(( ${last_tests:-0} - ${first_tests:-0} )) added)"
echo ""

# ============================================================================
# 3. Premium requests
# ============================================================================
echo "=== PREMIUM REQUESTS ==="

if [[ -f "$LOG_FILE" ]]; then
    total_premium=0
    while IFS= read -r n; do
        total_premium=$((total_premium + n))
    done < <(grep -oE '[0-9]+ Premium' "$LOG_FILE" | grep -oE '[0-9]+' 2>/dev/null || true)
    echo "Total premium requests this run: $total_premium"
else
    echo "No runner.log found"
fi
echo ""

# ============================================================================
# 4. Agent invocation status
# ============================================================================
echo "=== AGENT INVOCATIONS ==="

if [[ -f "$LOG_FILE" ]]; then
    # Count totals — AGENT_TRACE is the authoritative source from run.sh
    total_p=0; total_c=0; total_t=0; total_e=0
    total_skip_p=0; total_skip_c=0; total_skip_t=0; total_skip_e=0
    for i in $(seq "$FIRST_ITER" "$LAST_ITER"); do
        trace=$(grep "AGENT_TRACE iter=$i " "$LOG_FILE" 2>/dev/null | head -1 || true)
        if [[ -n "$trace" ]]; then
            p=$(echo "$trace" | sed -n 's/.*proposer=\([0-9]*\).*/\1/p')
            c=$(echo "$trace" | sed -n 's/.*coder=\([0-9]*\).*/\1/p')
            t=$(echo "$trace" | sed -n 's/.*tester=\([0-9]*\).*/\1/p')
            e=$(echo "$trace" | sed -n 's/.*evaluator=\([0-9]*\).*/\1/p')
            # Ensure numeric — truncated AGENT_TRACE lines may miss fields
            p=${p:-0}; c=${c:-0}; t=${t:-0}; e=${e:-0}
        else
            # Fallback: scan log directly. Match both "iter N" and "iteration N".
            p=$({ grep -cE "● Proposer.*iter(ation)? $i\b" "$LOG_FILE" 2>/dev/null || true; })
            c=$({ grep -cE "● Coder.*iter(ation)? $i\b" "$LOG_FILE" 2>/dev/null || true; })
            t=$({ grep -cE "● Tester.*iter(ation)? $i\b" "$LOG_FILE" 2>/dev/null || true; })
            e=$({ grep -cE "● Evaluator.*iter(ation)? $i\b" "$LOG_FILE" 2>/dev/null || true; })
            p=${p:-0}; c=${c:-0}; t=${t:-0}; e=${e:-0}
        fi
        [[ "${p:-0}" -gt 0 ]] && total_p=$((total_p + 1)) || total_skip_p=$((total_skip_p + 1))
        [[ "${c:-0}" -gt 0 ]] && total_c=$((total_c + 1)) || total_skip_c=$((total_skip_c + 1))
        [[ "${t:-0}" -gt 0 ]] && total_t=$((total_t + 1)) || total_skip_t=$((total_skip_t + 1))
        [[ "${e:-0}" -gt 0 ]] && total_e=$((total_e + 1)) || total_skip_e=$((total_skip_e + 1))
        [[ "${p:-0}" -eq 0 || "${c:-0}" -eq 0 || "${t:-0}" -eq 0 || "${e:-0}" -eq 0 ]] && \
            echo "AGENT_SKIP|${i}|proposer=${p:-0} coder=${c:-0} tester=${t:-0} evaluator=${e:-0}"
    done

    pct() { local n=$1 d=$2; [[ "$d" -eq 0 ]] && echo "0" || echo "$(( n * 100 / d ))"; }
    echo ""
    echo "=== AGENT CALL RATES ==="
    echo "Proposer:  ${total_p}/${total_iters} called (${total_skip_p} skipped) — $(pct $total_p $total_iters)%"
    echo "Coder:     ${total_c}/${total_iters} called (${total_skip_c} skipped) — $(pct $total_c $total_iters)%"
    echo "Tester:    ${total_t}/${total_iters} called (${total_skip_t} skipped) — $(pct $total_t $total_iters)%"
    echo "Evaluator: ${total_e}/${total_iters} called (${total_skip_e} skipped) — $(pct $total_e $total_iters)%"
    all4_min=$total_p
    [[ $total_c -lt $all4_min ]] && all4_min=$total_c
    [[ $total_t -lt $all4_min ]] && all4_min=$total_t
    [[ $total_e -lt $all4_min ]] && all4_min=$total_e
    echo "All 4 agents: ${all4_min}/${total_iters} — $(pct $all4_min $total_iters)%"
else
    echo "No runner.log found"
fi
echo ""
echo ""

# ============================================================================
# 5. E2E Smoke UI Test Results
# ============================================================================
echo "=== E2E SMOKE UI ==="

if [[ -f "$LOG_FILE" ]]; then
    grep "SMOKE_UI\|E2E_RESULT" "$LOG_FILE" 2>/dev/null | tail -20 || true
fi

# E2E results file
e2e_file="$PROJECT_DIR/autoresearch/ui-test-results.json"
if [[ -f "$e2e_file" ]]; then
    echo "E2E_FILE|$(cat "$e2e_file" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"overall={d[\"overall\"]} pages={d[\"pages_tested\"]} passed={d[\"pages_passed\"]}")' 2>/dev/null || echo "parse error")"
fi
echo ""

# ============================================================================
# 6. Errors and warnings from audit
# ============================================================================
echo "=== AUDIT FINDINGS ==="

if [[ -f "$AUDIT_REPORT" ]]; then
    cat "$AUDIT_REPORT"
else
    echo "No audit-report.json found. Run: bash autoresearch/audit.sh -f $FIRST_ITER -t $LAST_ITER"
fi
echo ""

# ============================================================================
# 7. Most changed files
# ============================================================================
echo "=== MOST CHANGED FILES ==="

cd "$PROJECT_DIR"
# Get all commits in range and count file changes
commits=$(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" \
    'NR>1 && $1>=f && $1<=t && $2!="none" && $2!="" {print $2}' "$RESULTS_FILE")

if [[ -n "$commits" ]]; then
    for c in $commits; do
        git diff --name-only "${c}~1..${c}" 2>/dev/null
    done | grep -v "autoresearch/\|runner.log" | sort | uniq -c | sort -rn | head -10 | while read -r count file; do
        echo "FILE|${count}|${file}"
    done
fi
echo ""

# ============================================================================
# 8. Backlog status
# ============================================================================
echo "=== BACKLOG STATUS ==="

backlog="$PROJECT_DIR/autoresearch/backlog.md"
if [[ -f "$backlog" ]]; then
    completed=$(grep -c "^\- \[x\]" "$backlog" || true)
    remaining=$(grep -c "^\- \[ \]" "$backlog" || true)
    echo "Completed: $completed | Remaining: $remaining"
    echo "--- Remaining items ---"
    grep "^\- \[ \]" "$backlog" | head -10
fi
echo ""

echo "=== END REPORT ==="
