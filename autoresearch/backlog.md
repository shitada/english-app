# Autoresearch Backlog

Improvement ideas for the English Learning App, prioritized by importance.
Items marked with ✅ have been completed. Items marked with ❌ were attempted but discarded.

## [HIGH] Test Coverage

- [x] ✅ Add unit tests for conversation DAL (`app/dal/conversation.py`) — test create_conversation, add_message, update_message_feedback, format_history_text (completed iteration #1)
- [x] ✅ Add unit tests for pronunciation DAL (`app/dal/pronunciation.py`) — test get_sentences_from_conversations, save_attempt, get_history (completed iteration #2)
- [x] ✅ Add unit tests for vocabulary DAL (`app/dal/vocabulary.py`) — test get_words_by_topic, save_words, get_due_word_ids, build_quiz, update_progress, get_progress (completed iteration #3)
- [ ] Add input validation tests for routers — test invalid request bodies, missing fields, boundary values
- [ ] Add error handling tests — test database connection failures, LLM timeout scenarios

## [MEDIUM] Feature Improvements

- [ ] Add conversation difficulty level selection (beginner/intermediate/advanced) — adjust AI response complexity and vocabulary
- [ ] Improve pronunciation feedback granularity — add phoneme-level comparison and common mistake patterns
- [ ] Diversify vocabulary quiz formats — add word-to-definition, fill-in-the-blank, sentence completion modes
- [ ] Add conversation history review page — let users revisit past conversations and grammar feedback
- [ ] Add progress tracking for pronunciation — track improvement over time per sentence type

## [MEDIUM] Code Quality

- [ ] Unify error handling patterns across routers — consistent HTTPException usage, error response schema
- [ ] Add Pydantic response models for all endpoints — ensure consistent API response structure
- [ ] Extract common LLM interaction patterns — reduce duplication in router-level LLM calls
- [ ] Add request/response logging middleware — structured logging for debugging API issues

## [LOW] UX & Frontend

- [ ] Improve accessibility — add ARIA labels, keyboard navigation, screen reader support
- [ ] Add loading states and skeleton screens — better UX during LLM processing delays
- [ ] Add offline fallback for vocabulary review — cache previously fetched quiz data
- [ ] Improve mobile responsiveness — optimize layout for smaller screens

## [LOW] Infrastructure

- [ ] Add database migration strategy — handle schema changes without data loss
- [ ] Add health check endpoint — monitor service availability
- [ ] Add rate limiting — prevent abuse of LLM endpoints
