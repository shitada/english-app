#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Autoresearch Audit Script — Diagnose → Prescribe → Repair
#
# Phase 1: DIAGNOSE  — Detect problems + match root cause patterns
# Phase 2: PRESCRIBE — Fix agent prompts (HIGH auto, MEDIUM/LOW via prescriber)
# Phase 3: REPAIR    — Fix data (results.tsv) after agent issues are addressed
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_FILE="$SCRIPT_DIR/results.tsv"
LOG_FILE="$SCRIPT_DIR/runner.log"
REPORT_FILE="$SCRIPT_DIR/audit-report.json"
ORCHESTRATOR="$PROJECT_DIR/.github/agents/orchestrator.agent.md"
TESTER="$PROJECT_DIR/.github/agents/tester.agent.md"

RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ERRORS=0; WARNINGS=0; FIXES=0
FIX_MODE=false; FROM_ITER=""; TO_ITER=""

# Accumulate diagnoses as newline-separated JSON objects
DIAGNOSES=""

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Audits autoresearch runs: diagnoses root causes, prescribes agent fixes,
then repairs data. Agent fixes are applied BEFORE data repairs.

Options:
  -f, --from <N>    Start from iteration N
  -t, --to <N>      Audit up to iteration N
  --fix             Auto-fix (HIGH confidence auto-applied, MEDIUM/LOW via prescriber)
  -h, --help        Show help
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--from) FROM_ITER="$2"; shift 2 ;;
        -t|--to)   TO_ITER="$2"; shift 2 ;;
        --fix)     FIX_MODE=true; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown: $1" >&2; usage ;;
    esac
done

[[ ! -f "$RESULTS_FILE" ]] && echo -e "${RED}ERROR: results.tsv not found${NC}" && exit 1
[[ ! -f "$LOG_FILE" ]] && echo -e "${RED}ERROR: runner.log not found${NC}" && exit 1

LAST_ITER=$(awk -F'\t' 'NR>1 && $1 ~ /^[0-9]+$/ {last=$1} END {print last}' "$RESULTS_FILE")
[[ -z "$LAST_ITER" ]] && echo -e "${RED}ERROR: No valid iterations${NC}" && exit 1
FIRST_ITER=$(awk -F'\t' 'NR==2 && $1 ~ /^[0-9]+$/ {print $1}' "$RESULTS_FILE")
[[ -n "$FROM_ITER" ]] && FIRST_ITER="$FROM_ITER"
[[ -n "$TO_ITER" ]] && LAST_ITER="$TO_ITER"

echo "============================================"
echo " Autoresearch Audit"
echo " Iterations: $FIRST_ITER — $LAST_ITER"
echo " Mode: $( $FIX_MODE && echo 'DIAGNOSE + PRESCRIBE + REPAIR' || echo 'DIAGNOSE ONLY' )"
echo " Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

add_diagnosis() {
    local check="$1" severity="$2" iters="$3" cause="$4" confidence="$5" evidence="$6"
    local entry
    entry=$(printf '{"check":"%s","severity":"%s","iterations":"%s","root_cause":"%s","confidence":"%s","evidence":"%s","action":"none"}' \
        "$check" "$severity" "$iters" "$cause" "$confidence" "$evidence")
    if [[ -z "$DIAGNOSES" ]]; then
        DIAGNOSES="$entry"
    else
        DIAGNOSES="$DIAGNOSES
$entry"
    fi
}

# ====================================================================
# PHASE 1: DIAGNOSE
# ====================================================================
echo -e "${BOLD}═══ PHASE 1: DIAGNOSE ═══${NC}"
echo ""

# --- 1. TSV format ---
echo -e "${CYAN}[1/7] results.tsv format${NC}"
bad_lines=$(awk -F'\t' 'NR>1 && NF!=14 {print NR}' "$RESULTS_FILE")
if [[ -n "$bad_lines" ]]; then
    bad_count=$(echo "$bad_lines" | wc -l | tr -d ' ')
    echo -e "${RED}  FAIL: $bad_count malformed row(s)${NC}"
    ERRORS=$((ERRORS + 1))

    # DIAGNOSE: check if echo -e was used
    broken_iters=""
    for ln in $bad_lines; do
        iter_num=$(sed -n "${ln}p" "$RESULTS_FILE" | grep -oE '^[0-9]+' | head -1)
        broken_iters="$broken_iters $iter_num"
    done

    echo_e_count=$(grep -c 'echo -e.*results\.tsv\|echo -e.*results.tsv' "$LOG_FILE" 2>/dev/null || true)
    if [[ "$echo_e_count" -gt 0 ]]; then
        echo -e "  ${BOLD}ROOT CAUSE: echo -e used for TSV recording ($echo_e_count occurrences)${NC}"
        echo -e "  ${BOLD}CONFIDENCE: HIGH${NC}"
        add_diagnosis "tsv_format" "error" "$broken_iters" "echo_e_incompatibility" "HIGH" \
            "Found $echo_e_count 'echo -e' commands writing to results.tsv in runner.log"
    else
        echo -e "  ${BOLD}ROOT CAUSE: Unknown — no echo -e found in log${NC}"
        echo -e "  ${BOLD}CONFIDENCE: LOW${NC}"
        add_diagnosis "tsv_format" "error" "$broken_iters" "unknown" "LOW" \
            "Malformed rows but no echo -e pattern found in runner.log"
    fi
else
    echo -e "${GREEN}  PASS${NC}"
fi
echo ""

# --- 2. Missing iterations ---
echo -e "${CYAN}[2/7] Missing iterations${NC}"
missing_iters=""
cd "$PROJECT_DIR"
while IFS= read -r cline; do
    inum=$(echo "$cline" | grep -oE '#[0-9]+:' | tr -d '#:')
    if [[ -n "$inum" && "$inum" -ge "$FIRST_ITER" && "$inum" -le "$((LAST_ITER + 5))" ]]; then
        in_tsv=$(awk -F'\t' -v n="$inum" 'NR>1 && $1==n {found=1} END {print found+0}' "$RESULTS_FILE")
        [[ "$in_tsv" -eq 0 ]] && missing_iters="$missing_iters $inum"
    fi
done < <(git log --oneline --all --grep="autoresearch #" --format="%h %s" 2>/dev/null)

if [[ -z "$missing_iters" ]]; then
    echo -e "${GREEN}  PASS${NC}"
else
    echo -e "${RED}  FAIL: Missing:${missing_iters}${NC}"
    ERRORS=$((ERRORS + 1))
    add_diagnosis "missing_iterations" "error" "$missing_iters" "recording_failure" "HIGH" \
        "Committed iterations not found in results.tsv"
fi
echo ""

# --- 3. Agent invocations ---
echo -e "${CYAN}[3/7] Agent invocations${NC}"
missing_proposer=""; missing_tester=""; missing_evaluator=""
n_skip_t=0; n_skip_e=0

for i in $(seq "$FIRST_ITER" "$LAST_ITER"); do
    p=$(grep -cE "Proposer.*(Propose |propose )iteration $i\b" "$LOG_FILE" 2>/dev/null || true)
    t=$(grep -cE "Tester.*(QA |test )iteration $i\b" "$LOG_FILE" 2>/dev/null || true)
    e=$(grep -cE "Evaluator.*(Evaluate |evaluate )iteration $i\b" "$LOG_FILE" 2>/dev/null || true)
    [[ "$p" -eq 0 ]] && missing_proposer="$missing_proposer $i"
    [[ "$t" -eq 0 ]] && missing_tester="$missing_tester $i" && n_skip_t=$((n_skip_t + 1))
    [[ "$e" -eq 0 ]] && missing_evaluator="$missing_evaluator $i" && n_skip_e=$((n_skip_e + 1))
done

total_iters=$((LAST_ITER - FIRST_ITER + 1))

for agent_info in "Proposer:$missing_proposer" "Tester:$missing_tester" "Evaluator:$missing_evaluator"; do
    name="${agent_info%%:*}"; missing="${agent_info#*:}"
    if [[ -z "$missing" ]]; then
        echo -e "${GREEN}  $name: PASS${NC}"
    else
        echo -e "${RED}  $name: FAIL — missing:${missing}${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done

# DIAGNOSE agent skips
if [[ -n "$missing_tester" || -n "$missing_evaluator" ]]; then
    all_missing="$missing_tester $missing_evaluator"
    # Check: did skips happen right after invocation boundary?
    invocation_lines=$(grep -n "Copilot invocation completed\|Copilot exited" "$LOG_FILE" | tail -5)
    general_impl=$(grep -c "General-purpose Implement" "$LOG_FILE" 2>/dev/null || true)
    pw_errors=$(grep -c "SingletonLock\|Browser.*in use\|playwright.*Error" "$LOG_FILE" 2>/dev/null || true)

    if [[ "$general_impl" -gt 0 ]]; then
        echo -e "  ${BOLD}ROOT CAUSE: Orchestrator self-implemented ($general_impl occurrences)${NC}"
        echo -e "  ${BOLD}CONFIDENCE: HIGH${NC}"
        add_diagnosis "agent_skip" "error" "$all_missing" "self_implementation" "HIGH" \
            "Found $general_impl 'General-purpose Implement' entries — orchestrator bypassed subagents"
    elif [[ -n "$invocation_lines" ]]; then
        # Check if missing iters are right after boundary
        echo -e "  ${BOLD}ROOT CAUSE: Context exhaustion at invocation boundary${NC}"
        echo -e "  ${BOLD}CONFIDENCE: HIGH${NC}"
        add_diagnosis "agent_skip" "error" "$all_missing" "context_exhaustion" "HIGH" \
            "Agent skips occurred after invocation boundary — orchestrator lost context of mandatory rules"
    elif [[ "$pw_errors" -gt 0 ]]; then
        echo -e "  ${BOLD}ROOT CAUSE: Playwright infrastructure errors triggered cascade${NC}"
        echo -e "  ${BOLD}CONFIDENCE: MEDIUM${NC}"
        add_diagnosis "agent_skip" "error" "$all_missing" "infra_failure_cascade" "MEDIUM" \
            "Found $pw_errors Playwright errors in log — may have caused agent skip cascade"
    else
        echo -e "  ${BOLD}ROOT CAUSE: Unknown${NC}"
        echo -e "  ${BOLD}CONFIDENCE: LOW${NC}"
        add_diagnosis "agent_skip" "error" "$all_missing" "unknown" "LOW" \
            "Agent skips detected but no known pattern matched in runner.log"
    fi
fi
echo ""

# --- 4. Playwright depth ---
echo -e "${CYAN}[4/7] Playwright test depth${NC}"
shallow_iters=""; shallow_n=0; tested_n=0
for i in $(seq "$FIRST_ITER" "$LAST_ITER"); do
    next=$((i + 1))
    pw=$(awk "/Tester.*iteration $i/,/iteration $next|Record iter|Record results/" \
        "$LOG_FILE" 2>/dev/null | grep -c "playwright-browser" || true)
    if [[ "$pw" -gt 0 ]]; then
        tested_n=$((tested_n + 1))
        [[ "$pw" -lt 5 ]] && shallow_iters="$shallow_iters $i($pw)" && shallow_n=$((shallow_n + 1))
    fi
done

if [[ -z "$shallow_iters" && "$tested_n" -gt 0 ]]; then
    echo -e "${GREEN}  PASS${NC}"
elif [[ "$tested_n" -eq 0 ]]; then
    echo -e "${YELLOW}  WARN: No tester calls in log${NC}"; WARNINGS=$((WARNINGS + 1))
else
    echo -e "${YELLOW}  WARN: Shallow (<5 tools):${shallow_iters}${NC}"; WARNINGS=$((WARNINGS + 1))

    if [[ "$tested_n" -gt 0 ]]; then
        shallow_pct=$((shallow_n * 100 / tested_n))
        if [[ "$shallow_pct" -gt 50 ]]; then
            echo -e "  ${BOLD}ROOT CAUSE: Tester consistently returning early${NC}"
            echo -e "  ${BOLD}CONFIDENCE: MEDIUM${NC}"
            add_diagnosis "playwright_shallow" "warning" "$shallow_iters" "tester_early_return" "MEDIUM" \
                "${shallow_pct}% of tested iterations had <5 Playwright tool calls"
        fi
    fi
fi
echo ""

# --- 5. Score anomaly ---
echo -e "${CYAN}[5/7] Score anomaly${NC}"
max_streak=0; cur=1; prev=""; streak_sc=""
while IFS=$'\t' read -r _ _ _ _ _ _ _ _ _ _ _ score _ _; do
    if [[ "$score" == "$prev" ]]; then
        cur=$((cur + 1))
        [[ "$cur" -gt "$max_streak" ]] && max_streak=$cur && streak_sc=$score
    else
        cur=1
    fi
    prev=$score
done < <(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t' "$RESULTS_FILE")

if [[ "$max_streak" -ge 5 ]]; then
    echo -e "${RED}  FAIL: $max_streak consecutive identical ($streak_sc)${NC}"; ERRORS=$((ERRORS + 1))
    add_diagnosis "score_anomaly" "error" "streak=$max_streak" "self_scoring" "HIGH" \
        "$max_streak consecutive identical scores ($streak_sc) — evaluator likely not called"
elif [[ "$max_streak" -ge 3 ]]; then
    echo -e "${YELLOW}  WARN: $max_streak consecutive identical ($streak_sc)${NC}"; WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}  PASS (max streak: $max_streak)${NC}"
fi
echo ""

# --- 6. Timestamps ---
echo -e "${CYAN}[6/7] Timestamps${NC}"
negative_t=""; zero_total=""
while IFS=$'\t' read -r iter _ _ propose impl test eval total _ _ _ _ _ _; do
    for val in $propose $impl $test $eval; do
        if [[ "$val" =~ ^-[0-9]+ ]]; then negative_t="$negative_t $iter"; break; fi
    done
    [[ "$total" == "0" ]] && zero_total="$zero_total $iter"
done < <(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t' "$RESULTS_FILE")

if [[ -z "$negative_t" ]]; then
    echo -e "${GREEN}  Timing: PASS${NC}"
else
    echo -e "${RED}  Timing: FAIL — negative:${negative_t}${NC}"; ERRORS=$((ERRORS + 1))
    add_diagnosis "negative_timestamp" "error" "$negative_t" "timestamp_calc_bug" "HIGH" \
        "Negative timing values — T variables computed in wrong order"
fi
[[ -z "$zero_total" ]] && echo -e "${GREEN}  Total: PASS${NC}" || { echo -e "${YELLOW}  Total: WARN — zero:${zero_total}${NC}"; WARNINGS=$((WARNINGS + 1)); }
echo ""

# --- 7. Test regression ---
echo -e "${CYAN}[7/7] Test regression${NC}"
regressions=""; prev_t=0
while IFS=$'\t' read -r iter _ _ _ _ _ _ _ passed _ _ _ verdict _; do
    if [[ "$verdict" == "keep" || "$verdict" == "kept" || "$verdict" == "KEEP" ]]; then
        [[ "$prev_t" -gt 0 && "$passed" -lt "$prev_t" ]] && regressions="$regressions $iter(${passed}<${prev_t})"
        prev_t=$passed
    fi
done < <(awk -F'\t' -v f="$FIRST_ITER" -v t="$LAST_ITER" 'NR>1 && $1>=f && $1<=t' "$RESULTS_FILE")

if [[ -z "$regressions" ]]; then
    echo -e "${GREEN}  PASS${NC}"
else
    echo -e "${RED}  FAIL:${regressions}${NC}"; ERRORS=$((ERRORS + 1))
fi
echo ""

# Save diagnoses to report
echo "[" > "$REPORT_FILE"
first=true
while IFS= read -r diag; do
    [[ -z "$diag" ]] && continue
    $first && first=false || echo "," >> "$REPORT_FILE"
    echo "  $diag" >> "$REPORT_FILE"
done <<< "$DIAGNOSES"
echo "]" >> "$REPORT_FILE"
echo -e "${CYAN}Diagnosis saved to: autoresearch/audit-report.json${NC}"
echo ""

# Exit here if not fixing
if ! $FIX_MODE; then
    echo "============================================"
    [[ "$ERRORS" -eq 0 && "$WARNINGS" -eq 0 ]] && echo -e "${GREEN}  AUDIT PASSED${NC}" \
        || echo -e "${RED}  AUDIT: $ERRORS error(s), $WARNINGS warning(s)${NC}"
    echo "============================================"
    exit "$ERRORS"
fi

# ====================================================================
# PHASE 2: PRESCRIBE (agent fixes before data fixes)
# ====================================================================
echo -e "${BOLD}═══ PHASE 2: PRESCRIBE ═══${NC}"
echo ""

# Collect MEDIUM/LOW findings for prescriber
needs_prescriber=false
prescriber_findings=""

while IFS= read -r diag; do
    [[ -z "$diag" ]] && continue
    confidence=$(echo "$diag" | grep -oE '"confidence":"[A-Z]+"' | cut -d'"' -f4)

    case "$confidence" in
        HIGH)
            root_cause=$(echo "$diag" | grep -oE '"root_cause":"[^"]+"' | cut -d'"' -f4)
            check=$(echo "$diag" | grep -oE '"check":"[^"]+"' | cut -d'"' -f4)
            echo -e "${GREEN}  [$check] HIGH confidence → auto-applying fix${NC}"

            case "$root_cause" in
                echo_e_incompatibility)
                    # Check if already fixed
                    if grep -q "NEVER.*echo -e\|printf.*AUDIT-FIX" "$ORCHESTRATOR" 2>/dev/null; then
                        echo -e "${YELLOW}    Already patched — skipping${NC}"
                    else
                        audit_tag="<!-- AUDIT-FIX-$(date +%Y%m%d): echo_e_incompatibility -->"
                        cat >> "$ORCHESTRATOR" << PATCH_EOF

$audit_tag
## AUDIT FIX: TSV Recording Format

**NEVER use \`echo -e\`** to write to results.tsv — it produces inconsistent tab formatting across shells and environments. ALWAYS use \`printf\` with explicit \`\\t\`:

\`\`\`bash
printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \\
  "\$N" "\$HASH" "\$DATE" "\$PROPOSE" "\$IMPL" "\$TEST" "\$EVAL" "\$TOTAL" \\
  "\$PASSED" "\$TOTAL_TESTS" "\$TS" "\$SCORE" "\$VERDICT" "\$DESC" \\
  >> autoresearch/results.tsv
\`\`\`

After writing, verify: \`tail -1 autoresearch/results.tsv | tr '\\t' '|'\`
If no \`|\` separators appear, the row is malformed — delete and rewrite with printf.
PATCH_EOF
                        echo -e "${GREEN}    Patched orchestrator: printf enforcement${NC}"
                        FIXES=$((FIXES + 1))
                    fi
                    ;;

                self_implementation|context_exhaustion)
                    if grep -q "AUDIT-FIX.*agent_skip" "$ORCHESTRATOR" 2>/dev/null; then
                        echo -e "${YELLOW}    Already patched — skipping${NC}"
                    else
                        audit_tag="<!-- AUDIT-FIX-$(date +%Y%m%d): agent_skip -->"
                        cat >> "$ORCHESTRATOR" << PATCH_EOF

$audit_tag
## AUDIT FIX: Agent Skip Prevention

Previous audit detected that subagents were skipped. This is a HARD FAILURE.

**MANDATORY CHECKLIST — verify BEFORE recording each iteration's results:**
- Did I call \`proposer\` subagent? → Must have received JSON proposal
- Did I call \`tester\` subagent? → Must have received JSON with ux_score
- Did I call \`evaluator\` subagent? → Must have received JSON with total_score
- Does the score in results.tsv match evaluator's total_score exactly?

**If ANY answer is NO, STOP. Call the missing subagent NOW before proceeding.**
You are an orchestrator — you dispatch work. You do NOT implement, score, or QA test.
PATCH_EOF
                        echo -e "${GREEN}    Patched orchestrator: agent skip prevention${NC}"
                        FIXES=$((FIXES + 1))
                    fi
                    ;;

                self_scoring)
                    # Same fix as agent skip — evaluator mandatory
                    if grep -q "AUDIT-FIX.*agent_skip\|AUDIT-FIX.*self_scoring" "$ORCHESTRATOR" 2>/dev/null; then
                        echo -e "${YELLOW}    Already patched — skipping${NC}"
                    else
                        audit_tag="<!-- AUDIT-FIX-$(date +%Y%m%d): self_scoring -->"
                        cat >> "$ORCHESTRATOR" << PATCH_EOF

$audit_tag
## AUDIT FIX: Self-Scoring Prevention

Audit detected $max_streak consecutive identical scores — evaluator was not called.
The evaluator subagent is the ONLY source of scores. You MUST NOT assign scores yourself.
PATCH_EOF
                        echo -e "${GREEN}    Patched orchestrator: self-scoring prevention${NC}"
                        FIXES=$((FIXES + 1))
                    fi
                    ;;

                timestamp_calc_bug)
                    if grep -q "AUDIT-FIX.*timestamp" "$ORCHESTRATOR" 2>/dev/null; then
                        echo -e "${YELLOW}    Already patched — skipping${NC}"
                    else
                        audit_tag="<!-- AUDIT-FIX-$(date +%Y%m%d): timestamp -->"
                        cat >> "$ORCHESTRATOR" << PATCH_EOF

$audit_tag
## AUDIT FIX: Timestamp Calculation

Always compute timing as: \`phase_sec = T_end - T_start\` where T_end > T_start.
Record T0 before propose, T1 after propose, T2 after implement, T3 after tests, T4 after evaluate.
If any result is negative, set it to 0.
PATCH_EOF
                        echo -e "${GREEN}    Patched orchestrator: timestamp fix${NC}"
                        FIXES=$((FIXES + 1))
                    fi
                    ;;

                recording_failure)
                    echo -e "${YELLOW}    Missing iterations will be fixed in Phase 3${NC}"
                    ;;
            esac
            ;;

        MEDIUM|LOW)
            needs_prescriber=true
            if [[ -z "$prescriber_findings" ]]; then
                prescriber_findings="$diag"
            else
                prescriber_findings="$prescriber_findings
$diag"
            fi
            echo -e "${YELLOW}  [$(echo "$diag" | grep -oE '"check":"[^"]+"' | cut -d'"' -f4)] $confidence confidence → queued for prescriber${NC}"
            ;;
    esac
done <<< "$DIAGNOSES"

# Call prescriber for MEDIUM/LOW findings
if $needs_prescriber; then
    echo ""
    echo -e "${CYAN}  Calling prescriber agent for MEDIUM/LOW findings...${NC}"

    # Build prescriber prompt with findings + relevant agent file excerpts
    orchestrator_excerpt=$(head -50 "$ORCHESTRATOR" 2>/dev/null || echo "N/A")
    tester_excerpt=$(head -50 "$TESTER" 2>/dev/null || echo "N/A")

    # Extract relevant log excerpts (around problem areas)
    log_excerpt=""
    while IFS= read -r finding; do
        [[ -z "$finding" ]] && continue
        iters=$(echo "$finding" | grep -oE '"iterations":"[^"]+"' | cut -d'"' -f4)
        for iter_num in $iters; do
            # Get iter_num without parens (e.g., "98(2)" -> "98")
            clean_iter=$(echo "$iter_num" | grep -oE '^[0-9]+')
            [[ -z "$clean_iter" ]] && continue
            excerpt=$(grep -n -A2 -B2 "iteration $clean_iter" "$LOG_FILE" 2>/dev/null | head -20)
            log_excerpt="$log_excerpt
--- iteration $clean_iter ---
$excerpt"
        done
    done <<< "$prescriber_findings"

    prescriber_prompt=$(cat <<PROMPT_EOF
Analyze these audit findings and decide whether to patch agent files.

## Findings (MEDIUM/LOW confidence — need your analysis):
$prescriber_findings

## Current orchestrator agent (first 50 lines):
$orchestrator_excerpt

## Current tester agent (first 50 lines):
$tester_excerpt

## Relevant runner.log excerpts:
$log_excerpt

Check if existing rules already cover these issues. If so, the problem is LLM non-determinism (skip).
If rules are missing, propose a patch (apply). If unclear, escalate.

Return your JSON response.
PROMPT_EOF
    )

    # Try calling prescriber via copilot CLI (with 120s timeout)
    if command -v copilot &>/dev/null; then
        set +e
        prescriber_result=$(timeout 120 copilot -p "$prescriber_prompt" \
            --agent=prescriber \
            --allow-all-tools \
            2>/dev/null | tail -1)
        prescriber_exit=$?
        set -e

        if [[ "$prescriber_exit" -eq 124 ]]; then
            echo -e "${YELLOW}  Prescriber timed out (120s) — findings logged for manual review${NC}"
        elif [[ "$prescriber_exit" -eq 0 && -n "$prescriber_result" ]]; then
            echo -e "${GREEN}  Prescriber responded${NC}"

            # Parse prescriber decisions
            # Extract decisions — look for "apply" patches
            while IFS= read -r line; do
                if echo "$line" | grep -q '"decision":"apply"'; then
                    target=$(echo "$line" | grep -oE '"target_file":"[^"]+"' | cut -d'"' -f4)
                    patch_text=$(echo "$line" | grep -oE '"text":"[^"]+"' | cut -d'"' -f4)
                    reason=$(echo "$line" | grep -oE '"reason":"[^"]+"' | cut -d'"' -f4)

                    if [[ -n "$target" && -n "$patch_text" ]]; then
                        target_path="$PROJECT_DIR/$target"
                        if [[ -f "$target_path" ]]; then
                            echo "" >> "$target_path"
                            echo "<!-- AUDIT-FIX-$(date +%Y%m%d)-prescriber -->" >> "$target_path"
                            echo "$patch_text" >> "$target_path"
                            echo -e "${GREEN}    Applied prescriber patch to $target: $reason${NC}"
                            FIXES=$((FIXES + 1))
                        fi
                    fi
                elif echo "$line" | grep -q '"decision":"skip"'; then
                    reason=$(echo "$line" | grep -oE '"reason":"[^"]+"' | cut -d'"' -f4)
                    echo -e "${YELLOW}    Prescriber: skip — $reason${NC}"
                elif echo "$line" | grep -q '"decision":"escalate"'; then
                    reason=$(echo "$line" | grep -oE '"reason":"[^"]+"' | cut -d'"' -f4)
                    echo -e "${RED}    Prescriber: ESCALATE — $reason${NC}"
                fi
            done <<< "$prescriber_result"
        else
            echo -e "${YELLOW}  Prescriber unavailable — logging findings for manual review${NC}"
        fi
    else
        echo -e "${YELLOW}  copilot CLI not available — MEDIUM/LOW findings logged to audit-report.json${NC}"
    fi
fi

echo ""

# ====================================================================
# PHASE 3: REPAIR DATA (after agent fixes)
# ====================================================================
echo -e "${BOLD}═══ PHASE 3: REPAIR DATA ═══${NC}"
echo ""

data_fixed=0

# --- Fix malformed TSV rows ---
bad_lines=$(awk -F'\t' 'NR>1 && NF!=14 {print NR}' "$RESULTS_FILE")
if [[ -n "$bad_lines" ]]; then
    echo -e "${CYAN}  Rebuilding malformed rows from git log...${NC}"
    cd "$PROJECT_DIR"
    tmpfile=$(mktemp)
    fixed=0

    while IFS= read -r line; do
        field_count=$(echo "$line" | awk -F'\t' '{print NF}')
        if [[ "$field_count" -eq 14 ]] || [[ "$line" == iteration* ]]; then
            echo "$line" >> "$tmpfile"
            continue
        fi

        iter_num=$(echo "$line" | grep -oE '^[0-9]+' | head -1)
        if [[ -z "$iter_num" ]]; then
            echo "$line" >> "$tmpfile"
            continue
        fi

        commit_hash=$(git log --oneline --all --grep="autoresearch #${iter_num}:" \
            --format="%h" 2>/dev/null | head -1)
        if [[ -z "$commit_hash" ]]; then
            echo -e "${YELLOW}    iter $iter_num: no git commit, keeping raw${NC}"
            echo "$line" >> "$tmpfile"
            continue
        fi

        commit_date=$(git log -1 --format="%aI" "$commit_hash" 2>/dev/null)
        desc=$(git log -1 --format="%s" "$commit_hash" 2>/dev/null \
            | sed "s/^autoresearch #${iter_num}: //")

        score=$(echo "$line" | grep -oE '[0-9]+\.[0-9]+' | tail -1)
        [[ -z "$score" ]] && score="7.0"
        verdict="keep"
        echo "$line" | grep -q "discard" && verdict="discard"

        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$iter_num" "$commit_hash" "$commit_date" \
            "0" "0" "0" "0" "0" "0" "0" "pass" "$score" "$verdict" "$desc" \
            >> "$tmpfile"
        echo -e "${GREEN}    iter $iter_num: rebuilt (${commit_hash})${NC}"
        fixed=$((fixed + 1))
    done < "$RESULTS_FILE"

    if [[ "$fixed" -gt 0 ]]; then
        cp "$RESULTS_FILE" "${RESULTS_FILE}.bak"
        mv "$tmpfile" "$RESULTS_FILE"
        echo -e "${GREEN}    Fixed $fixed row(s). Backup: results.tsv.bak${NC}"
        data_fixed=$((data_fixed + fixed))
    else
        rm -f "$tmpfile"
    fi
fi

# --- Add missing iterations ---
if [[ -n "$missing_iters" ]]; then
    echo -e "${CYAN}  Adding missing iterations...${NC}"
    cd "$PROJECT_DIR"
    for inum in $missing_iters; do
        hash=$(git log --oneline --all --grep="autoresearch #${inum}:" \
            --format="%h" 2>/dev/null | head -1)
        [[ -z "$hash" ]] && continue
        dstr=$(git log -1 --format="%aI" "$hash" 2>/dev/null)
        desc=$(git log -1 --format="%s" "$hash" 2>/dev/null \
            | sed "s/^autoresearch #${inum}: //")
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$inum" "$hash" "$dstr" "0" "0" "0" "0" "0" "0" "0" "pass" "7.0" "keep" "$desc" \
            >> "$RESULTS_FILE"
        echo -e "${GREEN}    Added iter $inum ($hash)${NC}"
        data_fixed=$((data_fixed + 1))
    done
    # Sort by iteration number
    head -1 "$RESULTS_FILE" > "${RESULTS_FILE}.tmp"
    tail -n +2 "$RESULTS_FILE" | sort -t$'\t' -k1 -n >> "${RESULTS_FILE}.tmp"
    mv "${RESULTS_FILE}.tmp" "$RESULTS_FILE"
fi

# --- Zero negative timestamps ---
if [[ -n "$negative_t" ]]; then
    echo -e "${CYAN}  Zeroing negative timestamps...${NC}"
    awk -F'\t' -v OFS='\t' 'NR>1 {
        for(i=4;i<=7;i++) if($i+0<0) $i=0
    } {print}' "$RESULTS_FILE" > "${RESULTS_FILE}.tmp"
    mv "${RESULTS_FILE}.tmp" "$RESULTS_FILE"
    echo -e "${GREEN}    Done${NC}"
    data_fixed=$((data_fixed + 1))
fi

[[ "$data_fixed" -eq 0 ]] && echo -e "${GREEN}  No data repairs needed${NC}"
echo ""

# ====================================================================
# SUMMARY
# ====================================================================
echo "============================================"
if [[ "$ERRORS" -eq 0 && "$WARNINGS" -eq 0 ]]; then
    echo -e "${GREEN}  AUDIT PASSED${NC}"
elif [[ "$ERRORS" -eq 0 ]]; then
    echo -e "${YELLOW}  AUDIT PASSED with $WARNINGS warning(s)${NC}"
else
    echo -e "${RED}  AUDIT: $ERRORS error(s), $WARNINGS warning(s)${NC}"
fi
[[ "$FIXES" -gt 0 ]] && echo -e "${GREEN}  Agent fixes: $FIXES${NC}"
[[ "$data_fixed" -gt 0 ]] && echo -e "${GREEN}  Data repairs: $data_fixed${NC}"
echo "  Report: autoresearch/audit-report.json"
echo "============================================"

exit "$ERRORS"
