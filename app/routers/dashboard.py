"""Dashboard/stats API endpoints."""

from __future__ import annotations

import logging

import aiosqlite
from fastapi import APIRouter, Depends

from app.dal import dashboard as dash_dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_stats(db: aiosqlite.Connection = Depends(get_db_session)):
    """Get learning statistics for the dashboard."""
    return await dash_dal.get_stats(db)
