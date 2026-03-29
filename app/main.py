"""FastAPI application entry point."""

from __future__ import annotations

import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import load_config, get_logging_config
from app.database import init_db
from app.routers import conversation, pronunciation, vocabulary
from app.routers import dashboard

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database ready.")
    yield
    from app.copilot_client import get_copilot_service
    await get_copilot_service().close()


app = FastAPI(title="English Practice App", lifespan=lifespan)

# CORS for development (Vite dev server on :5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(">> %s %s", request.method, request.url.path)
    response = await call_next(request)
    logger.info("<< %s %s -> %s", request.method, request.url.path, response.status_code)
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


# Register API routers
app.include_router(conversation.router)
app.include_router(pronunciation.router)
app.include_router(vocabulary.router)
app.include_router(dashboard.router)

# Serve React build — SPA fallback for client-side routing
if FRONTEND_BUILD.is_dir():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_BUILD / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        file_path = FRONTEND_BUILD / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
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
