# Autoresearch Summary

## Run: Iterations 172–181 (2026-04-04)

### Run Overview
- **Start**: 2026-04-04T01:48 UTC (iteration 172)
- **End**: 2026-04-04T04:07 UTC (iteration 181)
- **Total Duration**: ~2h 19m
- **Iterations**: 10

### Results Summary
| Metric | Count |
|--------|-------|
| Total iterations | 10 |
| Kept | 9 |
| Discarded | 1 |
| Crashed | 0 |
| Success rate | **90%** |

### Timing Analysis
| Phase | Avg (sec) | Min | Max |
|-------|-----------|-----|-----|
| Propose | 440 | 116 | 782 |
| Implement | 60 | 23 | 124 |
| Test | 163 | 61 | 838 |
| Evaluate | 133 | 55 | 797 |
| **Total** | **813** | 341 | 1322 |

### Key Improvements (Kept)

| # | Score | Description |
|---|-------|-------------|
| 172 | 6.70 | Add conversation phrase suggestions with clickable reply starters |
| 174 | 7.25 | Add phoneme-level pronunciation mistake patterns endpoint |
| 175 | 7.55 | Add database migration version tracking with schema_migrations table |
| 176 | 7.80 | Fix save_attempt defaulting non-numeric score to 0.0 instead of None |
| 177 | 8.35 | Fix get_grammar_accuracy treating string 'false' is_correct as truthy |
| 178 | 7.80 | Fix get_grammar_stats SQL miscounting string 'true' is_correct values |
| 179 | 7.55 | Fix build_quiz producing duplicate wrong options from shared meanings |
| 180 | 7.80 | Fix _parse_json greedy regex losing JSON when response has trailing braces |
| 181 | 7.55 | Fix _calculate_longest_streak returning 1 when no valid dates exist |

**Average score (kept)**: 7.59

### Discarded Attempts

| # | Score | Reason |
|---|-------|--------|
| 173 | 5.65 | Add pronunciation comparison playback — Playwright QA infrastructure locked, preventing frontend verification |

### Test Growth
- Start: 670 tests
- End: 687 tests (+17 new tests)

### Themes
1. **LLM string coercion bugs** (iterations 177, 178): The LLM sometimes returns `"false"` as a string instead of boolean `false`. Multiple aggregation functions were affected.
2. **Data integrity fixes** (176, 179, 180, 181): Subtle bugs in score handling, quiz deduplication, JSON parsing, and streak calculation.
3. **New features** (172, 174, 175): Phrase suggestions, phoneme analysis, migration tracking.

### Recommendations for Next Run
1. **Fix Playwright browser lock** — unblock frontend QA testing so feature iterations aren't penalized
2. **Frontend features** — many HIGH priority backlog items (speed control, key phrase highlight, drill mode) are frontend-only and waiting for QA
3. **Expand common_patterns aggregation** — the phoneme-level endpoint (iteration 174) would benefit from a frontend visualization

---

## Previous Run Summary — Iterations 122–171

## Overview (Cumulative)

| Metric | 122–151 | 152–171 | Total |
|--------|---------|---------|-------|
| Iterations completed | 30 | 20 | 50 |
| Kept | 30 (100%) | 20 (100%) | 50 (100%) |
| Discarded | 0 | 0 | 0 |
| Tests at start | 556 | 622 | 556 |
| Tests at end | 621 (+65) | 670 (+48) | 670 (+114) |
| Average score | 7.79 | 7.72 | 7.76 |
| Score range | 7.5–8.1 | 6.5–8.35 | 6.5–8.35 |

---

## Run 3: Iterations 152–171

### Timing

| Metric | Value |
|--------|-------|
| Average iteration time | 1,139s (~19 min) |
| Fastest iteration | #155 — 469s (8 min) |
| Slowest iteration | #154 — 2,532s (42 min) |
| Total wall-clock time | ~22,843s (~6.3 hours) |
| Proposer avg latency | ~730s |

### Iteration Log

| # | Score | Type | Description |
|---|-------|------|-------------|
| 152 | 7.80 | bugfix | Make end_conversation summary generation non-fatal on LLM failure |
| 153 | 7.30 | bugfix | Normalize LLM pronunciation feedback and fix score default of 0 |
| 154 | 8.10 | bugfix | Validate and clamp LLM-generated difficulty in save_words |
| 155 | 7.55 | bugfix | Clamp pronunciation scores in _normalize_feedback to [0, 10] |
| 156 | 7.50 | bugfix | Fix fill-blank quiz word-boundary matching and missing-blank edge case |
| 157 | 7.55 | bugfix | Fix truthiness check discarding empty dict feedback/summary in DAL |
| 158 | 6.50 | bugfix | Handle null overall_score in frontend pronunciation result display |
| 159 | 7.80 | bugfix | Fix streak dropping to 0 before daily activity despite active streak |
| 160 | 7.80 | bugfix | Build proper wrong_options for LLM-generated vocabulary quiz path |
| 161 | 7.80 | bugfix | Normalize grammar feedback to prevent frontend crash on missing fields |
| 162 | 8.05 | bugfix | Normalize conversation summary to prevent frontend crash on non-array key_vocabulary |
| 163 | 7.80 | bugfix | Clean up orphaned conversation when LLM fails in start_conversation |
| 164 | 7.55 | bugfix | Include abandoned conversations in bulk delete cleanup |
| 165 | 8.35 | bugfix | Fix get_vocabulary_stats miscounting total_words from wrong table |
| 166 | 7.55 | bugfix | Clean up orphaned user message when LLM fails in send_message |
| 167 | 7.80 | bugfix | Fix _parse_json returning list for markdown-fenced JSON arrays |
| 168 | 8.05 | bugfix | Use message ID instead of content matching in update_message_feedback |
| 169 | 8.05 | bugfix | Fix get_sentences_from_conversations ignoring limit parameter |
| 170 | 7.80 | bugfix | Handle _parse_json items key fallback in generate_quiz endpoint |
| 171 | 7.80 | bugfix | Fix bool coercion of LLM string 'false' in grammar feedback normalization |

### Categories (152–171)

#### LLM Response Normalization (8 iterations)
- Pronunciation feedback normalization — score default, type coercion (#153)
- Difficulty validation and clamping for save_words (#154)
- Score clamping to [0, 10] in pronunciation feedback (#155)
- Grammar feedback normalization — missing fields, type safety (#161)
- Conversation summary normalization — non-array key_vocabulary (#162)
- _parse_json array wrapping for markdown-fenced JSON (#167)
- Quiz endpoint fallback for _parse_json "items" key (#170)
- Bool coercion for LLM string "false" in is_correct fields (#171)

#### Orphan Cleanup & Data Integrity (4 iterations)
- Orphaned conversation cleanup on LLM failure in start_conversation (#163)
- Orphaned user message cleanup on LLM failure in send_message (#166)
- Abandoned conversations included in bulk delete (#164)
- Content-matching → ID-based update_message_feedback (#168)

#### Correctness Fixes (5 iterations)
- Non-fatal summary generation on LLM failure (#152)
- Truthiness check discarding empty dict (is not None) (#157)
- Streak calculation allowing yesterday start (#159)
- Vocabulary stats total_words from correct table (#165)
- Sentence limit parameter respected (#169)

#### Frontend Resilience (2 iterations)
- Null guard for pronunciation overall_score display (#158)
- Wrong_options for LLM-generated quiz path (#160)

#### Regex/String Fixes (1 iteration)
- Fill-blank word-boundary matching with \b (#156)

### Key Technical Patterns (New in this run)

1. **LLM boundary normalization**: Every LLM response field must be validated/coerced — strings for bools, nulls for numbers, lists for non-lists
2. **Orphan cleanup**: Multi-step operations (create + LLM call) need try/except to remove partial state on failure
3. **ID-based updates**: Content-matching in DB is fragile when duplicate content exists — prefer ID-based lookups
4. **`is not None` vs truthiness**: Use `is not None` when empty containers ([], {}, "") are valid values
5. **`coerce_bool()`**: Python `bool("false") == True` — always coerce LLM string booleans explicitly

---

## Run 2: Iterations 122–151 (Previous)

| # | Score | Type | Description |
|---|-------|------|-------------|
| 122 | 7.75 | bugfix | Fix _estimate_difficulty ignoring conv_difficulty parameter |
| 123 | 7.8 | bugfix | Fix pronunciation sentences returning empty on difficulty filter |
| 124 | 8.1 | bugfix | Escape SQL LIKE wildcards in search queries |
| 125 | 7.75 | bugfix | Validate individual values in batch preferences endpoint |
| 126 | 7.75 | bugfix | Fix get_score_trend reporting stable when previous window empty |
| 127 | 7.75 | bugfix | Clear quiz_attempts when resetting vocabulary progress |
| 128 | 7.75 | bugfix | Validate pronunciation difficulty with Literal type |
| 129 | 7.5 | bugfix | Fix weekly comparison vocabulary count consistency |
| 130 | 7.55 | bugfix | Validate path parameter IDs with Path(ge=1) |
| 131 | 8.0 | bugfix | Add id tie-breaker to message ORDER BY clauses |
| 132 | 7.75 | bugfix | Fix get_retry_suggestions NULL score exclusion |
| 133 | 7.8 | bugfix | Fix grammar accuracy to use is_correct flag |
| 134 | 7.8 | bugfix | Fix get_due_word_ids returning non-due words |
| 135 | 8.0 | bugfix | Add id tie-breakers to 7 remaining ORDER BY clauses |
| 136 | 7.8 | bugfix | Add UNIQUE constraint on vocabulary_progress.word_id |
| 137 | 7.8 | bugfix | Clamp pronunciation score to 0-10 range |
| 138 | 8.0 | bugfix | Fix dict.get null-value bug in LLM response processing |
| 139 | 7.8 | bugfix | Fix inconsistent NULL next_review_at in due-word queries |
| 140 | 7.75 | bugfix | Make nullable DB fields optional in response models |
| 141 | 7.75 | bugfix | Add try/except for json.loads in summary and history |
| 142 | 7.75 | bugfix | Make toggle_bookmark and toggle_favorite atomic |
| 143 | 7.5 | refactor | Consolidate 5 DB queries into 1 in get_srs_analytics |
| 144 | 7.75 | bugfix | Ensure consistent message schema in conversation history |
| 145 | 7.5 | perf | Add 4 missing indexes for frequently queried columns |
| 146 | 8.0 | bugfix | Make end_conversation status transition atomic |
| 147 | 7.75 | bugfix | Add max_length limits to unbounded text fields |
| 148 | 7.8 | bugfix | Guard save_words against malformed LLM question dicts |
| 149 | 7.5 | feature | Add stale conversation cleanup with auto-expiry |
| 150 | 7.75 | ux | Sync frontend TypeScript interfaces with backend responses |
| 151 | 8.1 | bugfix | Fix dashboard activity tracking using quiz_attempts |

## Categories of Improvements

### Data Integrity (10 iterations)
- UNIQUE constraint preventing duplicate vocabulary_progress rows (#136)
- Atomic toggles preventing lost concurrent operations (#142)
- Atomic end_conversation preventing summary overwrite (#146)
- ON CONFLICT upsert for vocabulary progress (#136)
- Consistent NULL next_review_at handling (#139)
- Score clamping to valid 0-10 range (#137)
- Quiz attempts cleanup on reset (#127)
- Due word filtering fix (#134)
- Dashboard activity tracking accuracy (#151)
- Grammar accuracy using is_correct flag (#133)

### Input Validation & Security (6 iterations)
- Path parameter validation across 13 endpoints (#130)
- SQL LIKE wildcard escaping (#124)
- Text length limits on 5 unbounded fields (#147)
- Pronunciation difficulty Literal type (#128)
- Batch preference value validation (#125)
- Query parameter validation (#128)

### Resilience & Error Handling (5 iterations)
- dict.get() null-safety for LLM responses (#138)
- json.loads protection for corrupted data (#141)
- save_words resilience to malformed LLM output (#148)
- Nullable response model fields (#140)
- Consistent history schema (#144)

### Query Determinism & Performance (4 iterations)
- ORDER BY id tie-breakers across 12 queries (#131, #135)
- 4 missing database indexes (#145)
- 5-to-1 query consolidation in SRS analytics (#143)

### API & Frontend (3 iterations)
- Frontend TypeScript interface sync (#150)
- Stale conversation cleanup endpoint (#149)
- Score trend edge case (#126)

### Statistics Accuracy (2 iterations)
- Weekly comparison vocabulary count (#129)
- Retry suggestions NULL exclusion (#132)

## Key Technical Patterns

1. `(dict.get(key) or default)` over `dict.get(key, default)` for LLM null handling
2. `ORDER BY col DESC, id DESC` for deterministic pagination
3. `UPDATE SET col = 1 - col` for atomic toggles
4. `WHERE status = 'active'` in UPDATE for atomic state transitions
5. `INSERT ... ON CONFLICT DO UPDATE` for upsert safety
6. `max(0.0, min(10.0, float(score)))` for input clamping
7. `quiz_attempts.answered_at` over `vocabulary_progress.last_reviewed` for event tracking
