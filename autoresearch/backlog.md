# Autoresearch Backlog

Improvement ideas for the English Learning App, prioritized by importance.
Items marked with ✅ have been completed. Items marked with ❌ were attempted but discarded.

## [HIGH] Test Coverage

- [x] ✅ Add unit tests for conversation DAL (`app/dal/conversation.py`) — test create_conversation, add_message, update_message_feedback, format_history_text (completed iteration #1)
- [x] ✅ Add unit tests for pronunciation DAL (`app/dal/pronunciation.py`) — test get_sentences_from_conversations, save_attempt, get_history (completed iteration #2)
- [x] ✅ Add unit tests for vocabulary DAL (`app/dal/vocabulary.py`) — test get_words_by_topic, save_words, get_due_word_ids, build_quiz, update_progress, get_progress (completed iteration #3)
- [x] ✅ Add input validation tests for routers — test invalid request bodies, missing fields, boundary values (completed iteration #4)
- [x] ✅ Add error handling tests — test database connection failures, LLM timeout scenarios (completed iteration #5)

## [MEDIUM] Feature Improvements

- [x] ✅ Add conversation difficulty level selection (beginner/intermediate/advanced) — adjust AI response complexity and vocabulary (completed iteration #6)
- [ ] Improve pronunciation feedback granularity — add phoneme-level comparison and common mistake patterns
- [x] ✅ Preserve original punctuation (? !) in pronunciation sentence extraction (completed iteration #26)
- [x] ✅ Diversify vocabulary quiz formats — fill-in-the-blank mode added (completed iteration #38-39)
- [x] ✅ Add conversation history review page — backend endpoint added: GET /api/conversation/list with topic filter and pagination (completed iteration #11)
- [x] ✅ Add progress tracking for pronunciation — track improvement over time per sentence type (completed iteration #10)
- [x] ✅ Add conversation delete/cleanup endpoints — DELETE single and bulk clear ended (completed iteration #31)
- [x] ✅ Add vocabulary due-for-review endpoint — GET /api/vocabulary/due with topic filter (completed iteration #36)
- [x] ✅ Fix timezone inconsistency — datetime.now() → datetime.now(timezone.utc) everywhere (completed iteration #37)
- [x] ✅ Display fluency score and feedback in pronunciation results (completed iteration #40)
- [x] ✅ Add auto-end conversation timer (completed iteration #42, discarded #41 then fixed)
- [x] ✅ Add pronunciation history & progress UI (completed iteration #43)
- [x] ✅ Add vocabulary due-for-review count to dashboard (completed iteration #44)
- [x] ✅ Add vocabulary progress reset endpoint (completed iteration #45)
- [x] ✅ Show stored conversation summary in history view (completed iteration #46)
- [x] ✅ Add vocabulary weak words endpoint (completed iteration #47)
- [x] ✅ Add vocabulary word bank browse/search endpoint (completed iteration #48)
- [x] ✅ Deduplicate vocabulary words in save_words (completed iteration #49)
- [x] ✅ Add pronunciation history clear/delete endpoints (completed iteration #50)
- [x] ✅ Validate topic IDs against config (completed iteration #51)
- [x] ✅ Add quiz_type field to quiz response (completed iteration #52)
- [x] ✅ save_attempt returns attempt_id, history includes id (completed iteration #53)
- [x] ✅ Add frontend API methods for delete/clear endpoints (completed iteration #54)
- [x] ✅ Add vocabulary word deletion endpoint (completed iteration #55)
- [x] ✅ Add max_length validation to message/pronunciation inputs (completed iteration #56)
- [x] ✅ Add pronunciation score trend endpoint (completed iteration #61)
- [x] ✅ Add vocabulary export endpoint with progress data (completed iteration #60)
- [x] ✅ Add vocabulary topic-summary endpoint (completed iteration #65)

## [MEDIUM] Code Quality & Bug Fixes

- [x] ✅ Unify error handling patterns across routers — consistent HTTPException usage via safe_llm_call helper (completed iteration #12)
- [x] ✅ Extract common LLM interaction patterns — safe_llm_call reduces 5 try/except blocks to 1 helper (completed iteration #12)
- [x] ✅ Add request/response logging middleware — structured logging with timing, request IDs, log-level differentiation (completed iteration #18)
- [x] ✅ Fix streak calculation to include vocabulary reviews (completed iteration #24)
- [x] ✅ Fix vocabulary date format for SQLite compatibility in streak calculation (completed iteration #26)

## [LOW] UX & Frontend

- [x] ✅ Improve accessibility — add ARIA labels, keyboard navigation, screen reader support (completed iteration #16)
- [x] ✅ Add loading states and skeleton screens — better UX during LLM processing delays (completed iteration #19)
- [x] ✅ Add keyboard text input as speech fallback in conversation chat (completed iteration #23)
- [ ] Add offline fallback for vocabulary review — cache previously fetched quiz data
- [x] ✅ Improve mobile responsiveness — optimize layout for smaller screens (completed iteration #20)
- [x] ✅ Display human-readable topic labels in dashboard and pronunciation pages — topics now fetched from API (completed iteration #25)
- [x] ✅ Fix inconsistent date formatting — shared formatDate utility with relative and absolute time formatters (completed iteration #28)
- [x] ✅ Add React Error Boundary for graceful crash recovery (completed iteration #30)

## [LOW] Infrastructure

- [ ] Add database migration strategy — handle schema changes without data loss
- [x] ✅ Add health check endpoint — monitor service availability (completed iteration #9)
- [x] ✅ Add rate limiting — prevent abuse of LLM endpoints (completed iteration #26)
- [x] ✅ Add compound indexes for vocabulary progress + pronunciation queries (completed iteration #57)
- [x] ✅ Add conversations_by_difficulty to dashboard (completed iteration #58)
- [x] ✅ Add duration_seconds to conversation list (completed iteration #59)
- [x] ✅ Add grammar_accuracy stat to dashboard (completed iteration #62)
- [x] ✅ Add vocab_level_distribution to dashboard (completed iteration #63)
- [x] ✅ Add conversations_by_topic to dashboard (completed iteration #64)
- [x] ✅ Add retry logic with exponential backoff to safe_llm_call (completed iteration #66)
- [x] ✅ Add vocabulary review forecast endpoint (completed iteration #67)
- [x] ✅ Add conversation export endpoint (completed iteration #68)
- [x] ✅ Add pagination metadata to conversation list (completed iteration #71)
- [x] ✅ Add conversation search by keyword (completed iteration #72)
- [x] ✅ Add pronunciation score distribution endpoint (completed iteration #73)
- [x] ✅ Add daily learning activity history endpoint (completed iteration #74)
- [x] ✅ Add vocabulary quiz attempt history endpoint (completed iteration #75)
- [x] ✅ Add study streak milestones endpoint (completed iteration #76)
- [x] ✅ Add vocabulary per-topic accuracy endpoint (completed iteration #77)
- [x] ✅ Add conversation duration stats endpoint (completed iteration #78)
- [x] ✅ Add frontend TypeScript API types for new endpoints (completed iteration #79)
- [x] ✅ Add vocabulary batch import endpoint (completed iteration #80)
- [x] ✅ Add vocabulary word edit endpoint (completed iteration #81)
- [x] ✅ Add pronunciation personal records endpoint (completed iteration #82)
- [x] ✅ Add application config summary endpoint (completed iteration #83)
- [x] ✅ Add learning summary endpoint (completed iteration #84)
- [x] ✅ Add vocabulary word favorites/bookmarks system (completed iteration #85)

## [NEW] Ideas for Future Iterations

- [x] ✅ Add rate limit response headers (completed iteration #86)
- [x] ✅ Add grammar accuracy analytics endpoint (completed iteration #87)
- [x] ✅ Add vocabulary word notes/annotations (completed iteration #88)
- [x] ✅ Add pronunciation weekly progress tracker (completed iteration #89)
- [x] ✅ Add conversation topic recommendations (completed iteration #90)
- [x] ✅ Add frontend TypeScript types for iterations 86-90 (completed iteration #91)
- [x] ✅ Add learning goals/targets system (completed iteration #92)
- [x] ✅ Add vocabulary difficulty auto-adjustment (completed iteration #93)
- [x] ✅ Add word detail with similar words and progress (completed iteration #94)
- [x] ✅ Expand smoke test and add final TypeScript types (completed iteration #95)
- [x] ✅ Add pronunciation sentence categorization by difficulty (completed iteration #97)
- [ ] Add API versioning prefix
- [x] ✅ Add conversation message bookmarks (completed iteration #96)
- [x] ✅ Add vocabulary spaced repetition analytics (completed iteration #98)
- [ ] Add user preference settings persistence
- [ ] Add conversation replay/review mode
