# Autoresearch Summary Report

## Run Overview
- **First iteration**: 2026-03-29T15:09:03+09:00 (iteration #1)
- **Latest iteration**: 2026-03-30T23:09:08+09:00 (iteration #24)
- **Total iterations recorded**: 31 rows (including duplicates from re-runs)
- **Unique successful iterations**: 24

## Results Summary
| Metric | Value |
|--------|-------|
| Total iterations attempted | 31 |
| Kept | 22 |
| Discarded | 3 |
| Crashed | 5 |
| **Success rate (kept/attempted)** | **71%** |
| **Success rate (excl. crashes)** | **85%** |
| Tests at start | 50 |
| Tests at end | 165 |
| Test increase | +115 tests (+230%) |

## Timing Analysis (kept iterations only)

| Phase | Avg (sec) | Min | Max |
|-------|-----------|-----|-----|
| Propose | 109 | 33 | 389 |
| Implement | 75 | 24 | 144 |
| Test | 20 | 12 | 50 |
| Evaluate | 92 | 30 | 402 |
| **Total (per iteration)** | **305** | 123 | 796 |

## All Kept Changes

| # | Score | Type | Description |
|---|-------|------|-------------|
| 1 | 8.4 | test | Add unit tests for conversation DAL functions |
| 2 | 8.4 | test | Add unit tests for pronunciation DAL functions |
| 3 | 8.4 | test | Add unit tests for vocabulary DAL functions |
| 4 | 7.7 | test+bugfix | Add input validation to routers + validation tests |
| 5 | 7.3 | bugfix | Add LLM error handling in routers + error tests |
| 6 | 8.0 | feature | Add conversation difficulty level selection |
| 7 | 8.1 | refactor | Extract dashboard queries into DAL module |
| 8 | 7.7 | refactor | Add Pydantic response models to all endpoints |
| 9 | 7.7 | feature | Add health check endpoint with DB verification |
| 10 | 7.7 | feature | Add pronunciation progress tracking endpoint |
| 11 | 7.25 | feature | Add list-conversations endpoint for history review |
| 12 | 7.05 | refactor | Unify LLM error handling with safe_llm_call helper |
| 13 | 7.8 | bugfix | Make grammar check failure non-fatal in send_message |
| 15 | 7.25 | feature | Add conversation history browsing UI |
| 16 | 7.25 | ux | Add ARIA labels and live regions for accessibility |
| 17 | 7.55 | feature | Include vocabulary activity in dashboard feed |
| 18 | 7.3 | infra | Enhance logging middleware with timing and request IDs |
| 19 | 7.15 | ux | Add skeleton loading screens to Dashboard and Vocabulary |
| 20 | 7.0 | ux | Improve mobile responsiveness with hamburger nav and responsive grids |
| 21 | 7.55 | feature | Persist conversation summary in database |
| 22 | 6.5 | feature | Add reverse quiz mode (meaning-to-word) for vocabulary |
| 23 | 7.0 | ux | Add keyboard text input to conversation chat as speech fallback |
| 24 | 7.8 | bugfix | Include vocabulary reviews in streak calculation |

**Average score (kept)**: 7.55/10

## Discarded Attempts

| # | Score | Reason | Description |
|---|-------|--------|-------------|
| 17* | 5.65 | Low score | Display fluency score and feedback in pronunciation results |
| 15* | 4.95 | Low score | Add rate limiting for LLM endpoints |
| 17** | — | Test failure (2 failures) | Display fluency score and feedback (earlier attempt) |

## Crashed Iterations
5 iterations crashed due to proposer timeouts (iterations 14, 15, 18, 19, 20 in early runs).

## Remaining Backlog

### Uncompleted
- [ ] Improve pronunciation feedback granularity — phoneme-level comparison
- [ ] Diversify vocabulary quiz formats — fill-in-the-blank, sentence completion
- [ ] Add offline fallback for vocabulary review — cache quiz data
- [ ] Display human-readable topic labels (raw keys like 'hotel_checkin' → 'Hotel Check-in')
- [ ] Add database migration strategy
- [ ] Add rate limiting (attempted twice, discarded both times)

## Recommendations for Next Run

1. **Display human-readable topic labels** — Low-risk UX fix that addresses a known QA issue (#13); just needs a mapping from topic keys to display names
2. **Diversify vocabulary quiz formats** — Add fill-in-the-blank and sentence completion modes; high user value for learning variety
3. **Improve pronunciation feedback granularity** — Add phoneme-level feedback; requires careful LLM prompt design
