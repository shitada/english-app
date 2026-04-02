"""User preference settings API endpoints."""

from __future__ import annotations

import re
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dal import preferences as pref_dal
from app.database import get_db_session

router = APIRouter(prefix="/api/preferences", tags=["preferences"])

_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,48}[a-z0-9]$")


def _validate_key(key: str) -> None:
    if not _KEY_PATTERN.match(key):
        raise HTTPException(
            status_code=422,
            detail="Key must be 3-50 chars, lowercase alphanumeric + underscore, start with letter, end with alphanumeric",
        )


class SetPreferenceRequest(BaseModel):
    value: str = Field(..., min_length=1, max_length=500)


class BatchPreferencesRequest(BaseModel):
    preferences: dict[str, Annotated[str, Field(min_length=1, max_length=500)]] = Field(
        ..., min_length=1, max_length=50
    )


class PreferenceItem(BaseModel):
    key: str
    value: str


class PreferencesResponse(BaseModel):
    preferences: dict[str, str]


@router.get("", response_model=PreferencesResponse)
async def get_all_preferences(
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Get all saved user preferences."""
    prefs = await pref_dal.get_all_preferences(db)
    return {"preferences": prefs}


@router.put("", response_model=PreferencesResponse)
async def set_preferences_batch(
    req: BatchPreferencesRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Batch update multiple preferences."""
    for key in req.preferences:
        _validate_key(key)
    result = await pref_dal.set_preferences_batch(db, req.preferences)
    return {"preferences": result}


@router.put("/{key}", response_model=PreferenceItem)
async def set_preference(
    key: str,
    req: SetPreferenceRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Set a single user preference."""
    _validate_key(key)
    result = await pref_dal.set_preference(db, key, req.value)
    return result


@router.delete("/{key}")
async def delete_preference(
    key: str,
    db: aiosqlite.Connection = Depends(get_db_session),
):
    """Delete a user preference."""
    deleted = await pref_dal.delete_preference(db, key)
    if not deleted:
        raise HTTPException(status_code=404, detail="Preference not found")
    return {"deleted": True, "key": key}
