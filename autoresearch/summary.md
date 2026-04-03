# Autoresearch Summary — Iterations 122–151

## Overview

| Metric | Value |
|--------|-------|
| Iterations completed | 30 (122–151) |
| Kept | 30 (100%) |
| Discarded | 0 |
| Tests at start | 556 |
| Tests at end | 621 (+65) |
| Average score | 7.79 |
| Score range | 7.5 – 8.1 |
| TypeScript check | Pass (all iterations) |
| Smoke test | Pass (all iterations) |

## Iteration Log

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
