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
- [ ] Diversify vocabulary quiz formats — add word-to-definition, fill-in-the-blank, sentence completion modes
- [x] ✅ Add conversation history review page — backend endpoint added: GET /api/conversation/list with topic filter and pagination (completed iteration #11)
- [x] ✅ Add progress tracking for pronunciation — track improvement over time per sentence type (completed iteration #10)
- [x] ✅ Add conversation delete/cleanup endpoints — DELETE single and bulk clear ended (completed iteration #31)

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
