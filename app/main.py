"""FastAPI application entry point."""

from __future__ import annotations

import logging
import logging.handlers
import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import load_config, get_logging_config
from app.database import init_db, get_db, get_db_session, start_wal_checkpoint_task, stop_wal_checkpoint_task
from app.routers import conversation, pronunciation, vocabulary
from app.routers import dashboard
from app.routers import preferences
from app.routers import listening
from app.routers import shadowing
from app.routers import metrics
from app.routers import reduced_forms
from app.routers import stress_spotlight
from app.routers import contrastive_stress
from app.routers import linker_drill
from app.routers import paraphrase
from app.routers import number_dictation
from app.routers import speed_ladder
from app.routers import phrasal_verbs
from app.routers import monologue
from app.routers import tag_questions

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_BUILD = ROOT_DIR / "frontend" / "dist"


def setup_logging() -> None:
    log_cfg = get_logging_config()
    level = getattr(logging, log_cfg.get("level", "INFO").upper(), logging.INFO)
    log_file = log_cfg.get("file", "logs/app.log")
    max_bytes = log_cfg.get("max_bytes", 5 * 1024 * 1024)
    backup_count = log_cfg.get("backup_count", 3)

    log_path = ROOT_DIR / log_file
    log_path.parent.mkdir(parents=True, exist_ok=True)

    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    console.setLevel(level)

    file_handler = logging.handlers.RotatingFileHandler(
        str(log_path), maxBytes=max_bytes, backupCount=backup_count, encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(level)

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(console)
    root.addHandler(file_handler)


load_config()
setup_logging()
logger = logging.getLogger(__name__)

_startup_time: float = 0.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_time
    _startup_time = time.monotonic()
    logger.info("Initializing database...")
    await init_db()
    start_wal_checkpoint_task()
    logger.info("Database ready.")

    # Pre-warm Copilot SDK in background — must NOT block startup.
    from app.copilot_client import get_copilot_service
    try:
        app.state.copilot_prewarm_task = asyncio.create_task(
            get_copilot_service().prewarm()
        )
        logger.info("Copilot SDK prewarm scheduled.")
    except Exception as exc:
        logger.warning("Failed to schedule Copilot prewarm: %s", exc)
        app.state.copilot_prewarm_task = None

    yield
    stop_wal_checkpoint_task()

    prewarm_task = getattr(app.state, "copilot_prewarm_task", None)
    if prewarm_task is not None and not prewarm_task.done():
        try:
            await asyncio.wait_for(asyncio.shield(prewarm_task), timeout=0.1)
        except asyncio.TimeoutError:
            pass
        except Exception as exc:
            logger.debug("Prewarm task shutdown swallowed: %s", exc)

    await get_copilot_service().close()


app = FastAPI(title="English Practice App", lifespan=lifespan)

# CORS for development (Vite dev server on :5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_SKIP_LOG_PATHS = {"/api/health", "/favicon.svg", "/favicon.ico"}


@app.middleware("http")
async def log_requests(request: Request, call_next):
    path = request.url.path
    if path.startswith("/assets/") or path in _SKIP_LOG_PATHS:
        return await call_next(request)

    request_id = uuid.uuid4().hex[:8]
    t0 = time.monotonic()
    logger.info(">> %s %s [%s]", request.method, path, request_id)

    response = await call_next(request)

    duration_ms = round((time.monotonic() - t0) * 1000)
    status = response.status_code
    response.headers["X-Request-ID"] = request_id

    if status >= 500:
        logger.error("<< %s %s -> %s (%dms) [%s]", request.method, path, status, duration_ms, request_id)
    elif status >= 400:
        logger.warning("<< %s %s -> %s (%dms) [%s]", request.method, path, status, duration_ms, request_id)
    else:
        logger.info("<< %s %s -> %s (%dms) [%s]", request.method, path, status, duration_ms, request_id)

    return response


@app.middleware("http")
async def api_version_rewrite(request: Request, call_next):
    """Rewrite /api/v1/* to /api/* and add version header."""
    path = request.scope["path"]
    if path == "/api/v1" or path == "/api/v1/":
        request.scope["path"] = "/api"
    elif path.startswith("/api/v1/"):
        request.scope["path"] = "/api/" + path[8:]
    response = await call_next(request)
    if request.scope["path"].startswith("/api"):
        response.headers["X-API-Version"] = "v1"
    return response


# Frontend log endpoint
class FrontendLogEntry(BaseModel):
    level: str
    message: str


frontend_logger = logging.getLogger("frontend")

@app.post("/api/log")
async def frontend_log(entry: FrontendLogEntry):
    lvl = getattr(logging, entry.level.upper(), logging.INFO)
    frontend_logger.log(lvl, "%s", entry.message)
    return {"ok": True}


# Health check endpoint
@app.get("/api/health")
async def health_check():
    """Check service health and database connectivity."""
    uptime = round(time.monotonic() - _startup_time, 1) if _startup_time else 0.0
    try:
        db = await get_db()
        try:
            await db.execute("SELECT 1")
            db_status = "ok"
        finally:
            await db.close()
    except Exception as e:
        logger.warning("Health check DB failure: %s", e)
        db_status = "error"

    status = "ok" if db_status == "ok" else "degraded"
    response = {
        "status": status,
        "database": db_status,
        "uptime_seconds": uptime,
        "api_version": "v1",
    }
    if status == "degraded":
        return JSONResponse(content=response, status_code=503)
    return response


# Register API routers
app.include_router(conversation.router)
app.include_router(pronunciation.router)
app.include_router(vocabulary.router)
app.include_router(dashboard.router)
app.include_router(preferences.router)
app.include_router(listening.router)
app.include_router(shadowing.router)
app.include_router(metrics.router)
app.include_router(reduced_forms.router)
app.include_router(stress_spotlight.router)
app.include_router(contrastive_stress.router)
app.include_router(linker_drill.router)
app.include_router(paraphrase.router)
app.include_router(number_dictation.router)
app.include_router(speed_ladder.router)
app.include_router(phrasal_verbs.router)
app.include_router(monologue.router)
app.include_router(tag_questions.router)

def _safe_static_path(base: Path, user_path: str) -> Path | None:
    """Resolve a user-provided path and verify it stays within the base directory."""
    try:
        candidate = (base / user_path).resolve()
        candidate.relative_to(base.resolve())
        return candidate if candidate.is_file() else None
    except (ValueError, OSError):
        return None


# Serve React build — SPA fallback for client-side routing
if FRONTEND_BUILD.is_dir():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_BUILD / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        safe_path = _safe_static_path(FRONTEND_BUILD, full_path)
        if safe_path is not None:
            return FileResponse(str(safe_path))
        return FileResponse(str(FRONTEND_BUILD / "index.html"))


def main():
    import uvicorn
    ssl_keyfile = str(ROOT_DIR / "certs" / "key.pem")
    ssl_certfile = str(ROOT_DIR / "certs" / "cert.pem")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        ssl_keyfile=ssl_keyfile,
        ssl_certfile=ssl_certfile,
    )


if __name__ == "__main__":
    main()
