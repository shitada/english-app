# Autoresearch Summary Report

## Latest Run — Iterations 98–117

| Metric | Value |
|--------|-------|
| **Iterations** | 20 (98–117) |
| **Kept** | 20/20 (100%) |
| **Discarded** | 0 |
| **Tests: Start** | 439 |
| **Tests: End** | 549 (+110 tests, +25%) |
| **Avg Score** | 7.77 |
| **Highest Score** | 8.35 (#104) |
| **TypeScript** | Clean throughout |

### Results (98–117)

| # | Score | Tests | Type | Description |
|---|-------|-------|------|-------------|
| 98 | 7.75 | 444 | feature | Add vocabulary spaced repetition analytics endpoint |
| 99 | 8.05 | 462 | feature | Add user preference settings persistence |
| 100 | 7.75 | 465 | feature | Add conversation replay/review mode endpoint |
| 101 | 7.30 | 472 | feature | Add pronunciation practice sentences from vocabulary |
| 102 | 7.00 | 477 | feature | Add pronunciation weakness analysis endpoint |
| 103 | 7.75 | 480 | feature | Add conversation vocabulary crossover endpoint |
| 104 | 8.35 | 490 | tests | Add unit tests for conversation replay and vocabulary DAL |
| 105 | 8.25 | 491 | bugfix | Fix missing db.commit() in update_message_feedback |
| 106 | 7.75 | 497 | bugfix | Add missing input validation bounds on pagination and goals |
| 107 | 7.95 | 500 | feature | Store difficulty level with pronunciation attempts |
| 108 | 7.50 | 501 | feature | Include message id and bookmark status in history endpoint |
| 109 | 7.80 | 510 | tests | Add unit tests for validate_topic and get_learning_summary |
| 110 | 7.30 | 515 | feature | Add pronunciation retry suggestions endpoint |
| 111 | 7.55 | 524 | feature | Add per-sentence pronunciation attempt history endpoint |
| 112 | 7.50 | 524 | bugfix | Consolidate standalone API functions to use request helper |
| 113 | 8.00 | 530 | bugfix | Fix pronunciation score distribution gaps for float scores |
| 114 | 8.25 | 533 | bugfix | Fix substring false positives in conversation vocabulary matching |
| 115 | 8.00 | 534 | bugfix | Pass sentence difficulty through pronunciation check and history flow |
| 116 | 7.50 | 540 | feature | Add pronunciation progress breakdown by difficulty level |
| 117 | 8.00 | 549 | feature | Add cross-module learning insights endpoint |

### Key Improvements

**New Features (12)**: SRS analytics, user preferences, conversation replay, pronunciation from vocabulary, weakness analysis, vocabulary crossover, difficulty tracking, message metadata, retry suggestions, sentence history, difficulty progress, cross-module learning insights.

**Bug Fixes (6)**: Missing db.commit(), unbounded pagination, API error handling bypass, score distribution float gaps, substring matching false positives, difficulty field lost in data flow.

**Test Coverage (2)**: Unit tests for replay/vocab DAL, validate_topic/learning_summary.

### Remaining Backlog
- [ ] Pronunciation feedback granularity (phoneme-level) — partially addressed by #113, #116
- [ ] Offline fallback for vocabulary review
- [ ] Database migration strategy
- [ ] API versioning prefix

---

## Previous Run — Iterations 66–95

| Metric | Value |
|--------|-------|
| **Iterations** | 30 (66–95) |
| **Kept** | 30/30 (100%) |
| **Tests: Start** | 292 |
| **Tests: End** | 427 (+135) |
| **Avg Score** | 7.3 |

| # | Description | Tests | Status |
|---|-------------|-------|--------|
| 66 | Add retry logic with exponential backoff to safe_llm_call | 298 | keep |
| 67 | Add vocabulary review forecast endpoint | 301 | keep |
| 68 | Add conversation export endpoint | 304 | keep |
| 69 | Add unit tests for conversation export DAL | 311 | keep |
| 70 | Add unit tests for vocab forecast and due words DAL | 320 | keep |
| 71 | Add pagination metadata to conversation list | 324 | keep |
| 72 | Add conversation search by keyword | 330 | keep |
| 73 | Add pronunciation score distribution endpoint | 335 | keep |
| 74 | Add daily learning activity history endpoint | 341 | keep |
| 75 | Add vocabulary quiz attempt history endpoint | 348 | keep |
| 76 | Add study streak milestones endpoint | 352 | keep |
| 77 | Add vocabulary per-topic accuracy rate endpoint | 354 | keep |
| 78 | Add conversation duration stats endpoint | 358 | keep |
| 79 | Add frontend TypeScript API types for new endpoints | 358 | keep |
| 80 | Add vocabulary batch import endpoint | 364 | keep |
| 81 | Add vocabulary word edit endpoint | 370 | keep |
| 82 | Add pronunciation personal records endpoint | 373 | keep |
| 83 | Add application config summary endpoint | 374 | keep |
| 84 | Add learning summary endpoint | 375 | keep |
| 85 | Add vocabulary word favorites/bookmarks system | 383 | keep |
| 86 | Add rate limit response headers (X-RateLimit-*) | 386 | keep |
| 87 | Add grammar accuracy analytics endpoint | 390 | keep |
| 88 | Add vocabulary word notes/annotations | 397 | keep |
| 89 | Add pronunciation weekly progress tracker | 400 | keep |
| 90 | Add conversation topic recommendations endpoint | 404 | keep |
| 91 | Add frontend TypeScript types for iterations 86-90 | 404 | keep |
| 92 | Add learning goals system with daily targets | 414 | keep |
| 93 | Add vocabulary difficulty auto-adjustment | 420 | keep |
| 94 | Add word detail with similar words and progress | 427 | keep |
| 95 | Expand smoke test and add final TypeScript types | 427 | keep |

---

## Cumulative Stats (Iterations 1–117)

| Metric | Value |
|--------|-------|
| **Total iterations** | 117 |
| **Total kept** | ~113 |
| **Total discarded** | ~4 |
| **Success rate** | ~96.6% |
| **Tests** | 549 |
| **API endpoints** | 40+ |

## Key Patterns & Lessons
1. **sqlite3.Row** doesn't support `.get()` — wrap with `dict()` first
2. **save_words** expects `correct_meaning` not `meaning` in dict keys
3. **get_conversation_topics()** returns `list[dict]` not `dict` — access by `id` field
4. **FastAPI Query import** must be explicit in each router file
5. **Mock ask_json** must return dict with `questions` key, not bare list
6. Bug fixes consistently score higher than features (avg 7.96 vs 7.65)
7. Consolidating/refactoring iterations add value without increasing test count
8. Cross-module features (like learning insights) synthesize prior work effectively
