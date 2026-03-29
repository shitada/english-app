# English Practice App

AI-powered English learning application focused on **listening** and **speaking** skills. Practice real-life conversations with AI role-play partners, improve pronunciation through shadowing exercises, and build vocabulary with spaced repetition quizzes.

## Features

- **Conversation Practice** — Role-play 6 real-life scenarios (hotel, restaurant, job interview, doctor, shopping, airport) with AI. Choose difficulty: Beginner / Intermediate / Advanced
- **Pronunciation Training** — Shadowing practice with word-level accuracy and fluency scoring
- **Vocabulary Quiz** — AI-generated contextual quizzes with SM-2 spaced repetition for long-term retention
- **Learning Dashboard** — Track streaks, scores, mastered words, and recent activity
- **Grammar Feedback** — Real-time grammar correction and alternative expression suggestions during conversation
- **Health Check** — `GET /api/health` endpoint with DB connectivity verification

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI 0.115+ / Python 3.12+ / Uvicorn / aiosqlite (SQLite WAL mode) |
| **Frontend** | React 19 / TypeScript 5.9 / Vite 8 / React Router DOM 7 |
| **AI** | GitHub Copilot SDK (Claude Sonnet 4) |
| **Config** | `config.yaml` (topics, prompts, copilot settings, logging) |
| **Testing** | pytest + pytest-asyncio / Playwright (E2E) / TypeScript strict mode |
| **Package Managers** | `uv` (backend) / `npm` (frontend) |

## Architecture

```
app/                    # FastAPI backend
  main.py               # Entry point, middleware, health check, SPA serving
  config.py             # YAML config loader
  database.py           # SQLite schema, migrations, connection (async)
  copilot_client.py     # LLM wrapper (ask/ask_json with retry)
  prompts.py            # System prompt templates
  utils.py              # Utilities
  dal/                  # Data Access Layer (all DB queries isolated here)
    conversation.py     # Conversation & message CRUD
    pronunciation.py    # Pronunciation attempts & progress
    vocabulary.py       # Vocabulary words, quiz building, spaced repetition
    dashboard.py        # Dashboard statistics aggregation
  routers/              # API route handlers (thin — delegate to DAL)
    conversation.py     # /api/conversation/* (start, message, end, history)
    pronunciation.py    # /api/pronunciation/* (sentences, check, history, progress)
    vocabulary.py       # /api/vocabulary/* (topics, quiz, answer, progress)
    dashboard.py        # /api/dashboard/stats
frontend/src/           # React SPA
  pages/                # Page components
  hooks/                # useSpeechRecognition, useSpeechSynthesis
  api.ts                # REST client with TypeScript types
tests/
  unit/                 # DAL unit tests (no external deps)
  integration/          # API integration tests (DB + mocked LLM)
  e2e/                  # Playwright browser tests
  smoke_test.py         # Live-server endpoint smoke test
autoresearch/           # Autonomous improvement system tracking
  results.tsv           # Experiment log with timing data
  backlog.md            # Prioritized improvement ideas
  summary.md            # Run summary reports
```

## Setup

### Prerequisites

- Python 3.12+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) package manager
- SSL certificates for local development (self-signed)

### Backend

```bash
# Install dependencies
uv sync

# Generate self-signed SSL certificates
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"

# Start the server (https://localhost:8000)
uv run python -m app.main
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Development mode (http://localhost:5173 with HMR)
npm run dev

# Production build (served by backend at https://localhost:8000)
npm run build
```

## Testing

```bash
# Unit + Integration tests (145 tests)
uv run pytest tests/unit tests/integration -v

# Frontend TypeScript type check
cd frontend && npx tsc --noEmit

# Smoke test — starts real server, hits all endpoints against real DB
uv run python tests/smoke_test.py

# E2E browser tests (requires running server)
uv run pytest tests/e2e -v
```

## DB Migrations

The app uses SQLite with an automatic migration system. When adding columns or tables to `SCHEMA` in `app/database.py`, you must also add corresponding `ALTER TABLE` statements to the `_MIGRATIONS` list. `CREATE TABLE IF NOT EXISTS` does **not** update existing tables.

```python
# In app/database.py
_MIGRATIONS = [
    ("add difficulty column to conversations",
     "ALTER TABLE conversations ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'intermediate'"),
    # Add new migrations here...
]
```

Migrations are applied automatically at startup and are idempotent (already-applied migrations are silently skipped).

## Autoresearch System

This project implements an autonomous improvement loop inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch). Instead of modifying a single training script, the system proposes, implements, tests, and evaluates improvements to the entire English learning app.

### How It Works

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Proposer   │────▶│ Orchestrator │────▶│  Test Suite   │────▶│  Evaluator  │
│ (read-only) │     │ (implements) │     │ pytest + tsc  │     │ (read-only) │
└─────────────┘     │              │     │ + smoke test  │     └──────┬──────┘
                    │  git commit  │     └──────────────┘            │
                    └──────┬───────┘                          score ≥ 6.0?
                           │                                   ┌────┴────┐
                           │                                   │ keep    │ discard
                           │                                   │ (commit)│ (revert)
                           ▼                                   └─────────┘
                    results.tsv + backlog.md updated
                           │
                           ▼
                    Next iteration (×10)
```

### Agent Files

The system is driven by VS Code Copilot agent/prompt files in `.github/`:

| File | Role | Description |
|------|------|-------------|
| `.github/agents/orchestrator.agent.md` | **Orchestrator** | Main loop driver. Has full tool access (read, edit, execute, agent). Runs 10 iterations: propose → implement → commit → test → evaluate → keep/discard. Records timing at 5 checkpoints (T0-T4). Includes smoke test for DB/router changes. |
| `.github/agents/proposer.agent.md` | **Proposer** | Read-only analyst (tools: read, search). Analyzes codebase and returns exactly one JSON proposal `{type, title, description, files_to_modify, priority, estimated_complexity}`. Must avoid duplicate proposals. Iterations 1-2 prioritize test coverage. |
| `.github/agents/evaluator.agent.md` | **Evaluator** | Read-only reviewer (tools: read, search). Scores changes on Code Quality (30%), Feature Value (30%), Maintainability (40%). Returns keep/discard verdict. Checks DB schema backward compatibility. |
| `.github/prompts/autoresearch.prompt.md` | **Entry Point** | `/autoresearch` slash command that launches the orchestrator |
| `.github/copilot-instructions.md` | **Project Rules** | Tech stack, conventions, test commands, DB migration rules — loaded into every agent's context |

### Running Autoresearch

In VS Code Copilot Chat, type:

```
/autoresearch
```

The orchestrator will autonomously run 10 iterations, generating a summary report at `autoresearch/summary.md`.

### Tracking Files

| File | Purpose |
|------|---------|
| `autoresearch/results.tsv` | Tab-separated experiment log with columns: iteration, commit, started_at, propose/implement/test/evaluate timing (sec), tests passed/total, ts_check, score, status, description |
| `autoresearch/backlog.md` | Prioritized improvement ideas (HIGH/MEDIUM/LOW). Completed items marked ✅, discarded marked ❌ |
| `autoresearch/summary.md` | Post-run report: success rate, timing analysis, key improvements, remaining backlog, recommendations |

### Safety Guards

- **All tests must pass** — any failure → automatic discard + git revert
- **TypeScript must compile** — `tsc --noEmit` check on every iteration
- **Smoke test** — when `database.py`, `routers/`, or `dal/` are modified, a live-server smoke test runs against the real DB
- **Schema migrations** — proposer must include `ALTER TABLE` statements; evaluator penalizes missing migrations
- **Score threshold** — evaluator score must be ≥ 6.0/10 to keep a change

## License

MIT
