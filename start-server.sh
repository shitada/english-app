#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
lsof -ti:8001 | xargs kill -9 2>/dev/null
sleep 1
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
