# Autoresearch Summary — Iterations 183–185

## Run Overview
- **Start time**: 2026-04-04T06:48:58Z (iteration 183)
- **End time**: 2026-04-04T07:32:13Z (iteration 185)
- **Total duration**: ~43 minutes
- **Iterations**: 183–185 (3 iterations)

## Results Summary
| Metric | Value |
|--------|-------|
| Total iterations | 3 |
| Kept | 3 |
| Discarded | 0 |
| Crashed | 0 |
| Success rate | 100% |
| Tests at start | 687 |
| Tests at end | 687 |

## Timing Analysis
| Phase | Avg (sec) | Min | Max |
|-------|-----------|-----|-----|
| Propose | 162 | 143 | 190 |
| Implement | 198 | 87 | 279 |
| Test | 40 | 40 | 40 |
| Evaluate | 716 | 701 | 742 |
| **Total** | **1102** | **980** | **1211** |

## Key Improvements (All Kept)

| # | Score | Description |
|---|-------|-------------|
| 183 | 6.70 | Add conversation speed control for AI speech rate (slow/normal/fast) |
| 184 | 7.25 | Add conversation key phrase highlight with tap-to-hear pronunciation |
| 185 | 6.95 | Add quick drill mode for vocabulary with timed flashcard review |

### Iteration 183 — Conversation Speed Control
- Added `rate` state to `useSpeechSynthesis` hook (mirroring existing volume pattern)
- Three speed buttons (🐢 Slow=0.7, 1× Normal=0.9, 🐇 Fast=1.2) in chat header
- Purely client-side change, no backend modifications

### Iteration 184 — Key Phrase Highlight
- Backend `_extract_key_phrases()` async helper extracts 2-4 phrases via LLM (non-fatal)
- Runs in parallel with phrase suggestions via `asyncio.gather`
- Frontend `HighlightedMessage` component with click-to-hear pronunciation
- Good accessibility: `role="button"`, `tabIndex`, keyboard handler

### Iteration 185 — Vocabulary Quick Drill
- Backend `get_drill_words()` DAL function with 3-tier priority: due → weak → random
- `GET /api/vocabulary/drill` endpoint with Pydantic response models
- Frontend drill UI: 60s timer, flashcard display, Know/Don't Know buttons
- Results screen with accuracy stats, feeds back into SRS system

## Discarded Attempts
None — all 3 iterations were kept.

## Remaining Backlog (HIGH priority uncompleted)
- [ ] Add pronunciation comparison playback
- [ ] Add pronunciation accuracy visual
- [ ] Add daily practice reminder UI
- [ ] Add conversation replay

## Recommendations for Next Run
1. **Add tests for new features** — iterations 183-185 added no new test coverage. Priority: drill endpoint tests, key phrase extraction tests.
2. **Pronunciation comparison playback** — attempted twice (#173, partially), needs a simplified approach focused on backend audio storage.
3. **Daily practice reminder UI** — high-impact UX feature for the Home page, moderate complexity.
- **Total duration**: ~18 minutes
- **Iterations**: 1 (iteration 182 only)

## Results Summary
| Metric | Value |
|--------|-------|
| Total iterations | 1 |
| Kept | 0 |
| Discarded | 1 |
| Crashed | 0 |
| Success rate | 0% |

## Timing Analysis (Iteration 182)
| Phase | Seconds |
|-------|---------|
| Propose | 124 |
| Implement | 58 |
| Test | 48 |
| Evaluate (incl. QA) | 831 |
| **Total** | **1061** |

Most time was spent on QA testing. Playwright MCP browser was locked by another process, requiring two retry attempts before falling back to infrastructure failure mode.

## Discarded Attempts
| Iter | Score | Description | Reason |
|------|-------|-------------|--------|
| 182 | 5.95 | Add conversation speed control for AI speech rate | Playwright infrastructure failure (browser locked). Code quality was good, all 687 tests passed, TS check passed. |

## Key Observations
- The speed control feature implementation was solid: clean hook extension mirroring existing volume/setVolume pattern, UI added to both Conversation and Pronunciation pages
- Discarded purely due to Playwright MCP browser lock preventing live QA validation
- The feature should be retried in the next run when Playwright is available

## Remaining Backlog (Top Priorities)
1. Add conversation speed control (retry, code was correct, blocked by infra)
2. Add pronunciation comparison playback (previously discarded iter 173)
3. Add quick drill mode for vocabulary
4. Add conversation key phrase highlight
5. Add pronunciation accuracy visual

## Recommendations for Next Run
1. Fix Playwright browser lock before starting. Remove stale SingletonLock files.
2. Retry speed control feature. The implementation was correct and all tests passed.
3. Focus on speaking/listening features. Several high-priority items remain in backlog.

---

# Autoresearch Summary — Iterations 186–205

## Run Overview

| Metric | Value |
|--------|-------|
| Iterations attempted | 20 (186–205) |
| Iterations kept | 17 |
| Iterations discarded | 3 |
| Keep rate | 85% |
| Baseline tests | 687 |
| Final tests | 710 (+23) |
| Test suite status | All passing, TS check clean |

## Results Table

| Iter | Title | Score | Verdict |
|------|-------|-------|---------|
| 186 | Add pronunciation accuracy visual with per-word color bar | 7.25 | ✅ keep |
| 187 | Add daily practice reminder UI on home page | 6.30 | ❌ discard |
| 188 | Add API versioning prefix via URL-rewriting middleware | 5.95 | ❌ discard |
| 189 | Fix vocabulary sentences returning raw topic IDs | 7.25 | ✅ keep |
| 190 | Fix duplicated scenario/role in conversation system prompt | 7.00 | ✅ keep |
| 191 | Fix inconsistent mastery threshold in SRS analytics | 8.35 | ✅ keep |
| 192 | Fix dashboard conversations_by_topic returning raw topic IDs | 7.25 | ✅ keep |
| 193 | Fix vocabulary stats/topic-summary/topic-accuracy raw topic IDs | 6.95 | ✅ keep |
| 194 | Fix SRS analytics accuracy as decimal instead of percentage | 7.80 | ✅ keep |
| 195 | Fix strongest_area == weakest_area when strengths tied | 7.55 | ✅ keep |
| 196 | Fix is_bookmarked returned as integer 0/1 | 7.25 | ✅ keep |
| 197 | Fix is_favorite returned as integer 0/1 | 7.25 | ✅ keep |
| 198 | Fix path traversal vulnerability in SPA fallback | 8.60 | ✅ keep |
| 199 | Fix race condition in CopilotService._ensure_client | 7.80 | ✅ keep |
| 200 | Fix connection leak in get_db() when PRAGMA fails | 7.80 | ✅ keep |
| 201 | Fix unbounded memory growth in RateLimiter | 7.30 | ✅ keep |
| 202 | Fix NaN pronunciation scores silently stored as 10.0 | 7.80 | ✅ keep |
| 203 | Fix sentence-history summary computed from truncated window | 7.50 | ✅ keep |
| 204 | Fix off-by-one in activity-history returning days+1 entries | 7.25 | ✅ keep |
| 205 | Fix off-by-one in review forecast returning days+1 window | 7.55 | ✅ keep |

**Average score (kept):** 7.50 · **Highest:** 8.60 (iter 198, path traversal fix)

## Strategy Pivot

After iterations 186–188 (1 feature kept, 2 discarded), Playwright QA infrastructure broke due to a stale browser lock. Strategy shifted to **backend-only bugfixes** (iterations 189–205), which:

- Avoided QA failure mode entirely
- Produced a 93% keep rate (14/15) vs 33% for features (1/3)
- Yielded higher-impact fixes (security, data integrity, correctness)

## Key Improvements by Category

### 🔒 Security (1 fix)
- **#198** Path traversal vulnerability — arbitrary file reads via `..` in SPA fallback

### 🐛 Data Integrity (7 fixes)
- **#191** Mastery threshold inconsistency (`level >= 5` vs `>= 3`)
- **#194** SRS accuracy returned as decimal (0.75) instead of percentage (75.0)
- **#196–197** SQLite integer booleans (0/1) not converted to true/false
- **#202** NaN scores stored as perfect 10.0 via IEEE 754 comparison quirk
- **#203** Sentence-history summary computed from truncated LIMIT window
- **#204–205** Off-by-one in date windows (activity history + review forecast)

### 🏷️ Label Consistency (4 fixes)
- **#189, 192, 193** Raw topic IDs replaced with human labels across 6 endpoints
- **#190** Duplicated scenario text fed into both `{scenario}` and `{role}` params

### ⚙️ Infrastructure Robustness (3 fixes)
- **#199** Race condition in async client initialization (double-checked locking)
- **#200** Connection leak when PRAGMA execution fails
- **#201** Unbounded memory growth in rate limiter (periodic sweep)

### 🎨 Frontend (1 feature)
- **#186** Pronunciation accuracy visual with per-word color bar and phoneme badges

## Discarded Attempts

| Iter | Title | Score | Reason |
|------|-------|-------|--------|
| 187 | Daily practice reminder UI | 6.30 | QA failed (infrastructure), low evaluator score |
| 188 | API versioning prefix | 5.95 | Premature infrastructure, below 6.0 threshold |

## Remaining Backlog

- Add conversation replay
- Add offline fallback for vocabulary review
- Add pronunciation comparison playback (attempted twice, discarded)
- Add daily practice reminder UI (attempted, discarded)
- Add API versioning prefix (attempted, discarded)

## Recommendations for Next Run

1. **Fix Playwright QA** — resolve the stale browser lock to re-enable frontend feature testing
2. **Shift to feature work** — most low-hanging backend bugs have been addressed
3. **Consider conversation replay** — highest-value backlog item that doesn't require pronunciation infrastructure
4. **Re-attempt daily reminder UI** — good idea but needs QA validation
