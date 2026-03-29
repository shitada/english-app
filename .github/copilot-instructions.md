# English Learning App — Project Guidelines

## Tech Stack
- **Backend**: FastAPI 0.115+ / Python 3.12+ / Uvicorn / aiosqlite (SQLite WAL mode)
- **Frontend**: React 19 / TypeScript 5.9 / Vite 8 / React Router DOM 7
- **AI**: GitHub Copilot SDK (Claude Sonnet 4)
- **Config**: `config.yaml` at project root (topics, prompts, copilot settings, logging)
- **Package manager**: `uv` (backend), `npm` (frontend)

## Architecture
```
app/              # FastAPI backend
  main.py         # Entry point, middleware, SPA serving
  config.py       # YAML config loader
  database.py     # SQLite schema + connection (async)
  copilot_client.py  # LLM wrapper (ask/ask_json)
  prompts.py      # System prompt templates
  utils.py        # Utilities
  dal/            # Data Access Layer (DB queries isolated here)
  routers/        # API route handlers
frontend/src/     # React SPA
  pages/          # Page components (Conversation, Pronunciation, Vocabulary, Dashboard, Home)
  hooks/          # Custom hooks (useSpeechRecognition, useSpeechSynthesis)
  api.ts          # REST client with TypeScript types
tests/
  unit/           # No external deps, @pytest.mark.unit
  integration/    # DB + mocked LLM, @pytest.mark.integration
  e2e/            # Playwright browser tests, @pytest.mark.e2e
```

## Build & Test Commands
```bash
# Backend tests (unit + integration)
cd /Users/shingotada/Documents/vscode/english-app && uv run pytest tests/unit tests/integration -v

# Frontend type check
cd /Users/shingotada/Documents/vscode/english-app/frontend && npx tsc --noEmit

# Run backend server
uv run python -m app.main

# Run frontend dev server
cd frontend && npm run dev
```

## Conventions
- **Async/await throughout** — all I/O is non-blocking
- **DAL separation** — DB operations in `app/dal/`, never in routers
- **Pydantic validation** — request/response models for API endpoints
- **FastAPI Depends()** — dependency injection for DB connections
- **Structured logging** — `logging` module with timestamps
- **Error handling** — `HTTPException` for API errors
- **JSON blob storage** — feedback/analysis stored as JSON TEXT columns in SQLite
- **SM-2 spaced repetition** — vocabulary progress uses intervals [0,1,3,7,14,30,60]
- **DB migrations** — when adding columns/tables to `SCHEMA` in `database.py`, also add corresponding `ALTER TABLE` statements to `_MIGRATIONS` list. `CREATE TABLE IF NOT EXISTS` does NOT update existing tables.

## Testing Conventions
- Fixtures in `tests/conftest.py`: `test_db` (in-memory SQLite), `mock_copilot`, `client` (AsyncClient)
- Markers: `@pytest.mark.unit`, `@pytest.mark.integration`, `@pytest.mark.e2e`
- E2E tests excluded by default (`--ignore=tests/e2e` in pyproject.toml)
- Use `pytest-asyncio` with `asyncio_mode = "auto"`

## Config Structure
`config.yaml` holds: copilot settings (model, timeout, retries), logging config, 6 conversation scenarios (hotel, restaurant, job interview, doctor, shopping, airport), vocabulary topics, and all system prompt templates.
