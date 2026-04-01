"""Unit tests for the preferences DAL (app/dal/preferences.py)."""

from __future__ import annotations

import pytest

from app.dal.preferences import (
    delete_preference,
    get_all_preferences,
    get_preference,
    set_preference,
    set_preferences_batch,
)


@pytest.mark.unit
class TestGetAllPreferences:
    async def test_empty(self, test_db):
        result = await get_all_preferences(test_db)
        assert result == {}

    async def test_returns_all(self, test_db):
        await set_preference(test_db, "theme", "dark")
        await set_preference(test_db, "difficulty", "advanced")
        result = await get_all_preferences(test_db)
        assert result == {"theme": "dark", "difficulty": "advanced"}


@pytest.mark.unit
class TestGetPreference:
    async def test_missing_key(self, test_db):
        result = await get_preference(test_db, "nonexistent")
        assert result is None

    async def test_existing_key(self, test_db):
        await set_preference(test_db, "theme", "dark")
        result = await get_preference(test_db, "theme")
        assert result == "dark"


@pytest.mark.unit
class TestSetPreference:
    async def test_insert_new(self, test_db):
        result = await set_preference(test_db, "quiz_count", "10")
        assert result == {"key": "quiz_count", "value": "10"}
        assert await get_preference(test_db, "quiz_count") == "10"

    async def test_upsert_existing(self, test_db):
        await set_preference(test_db, "theme", "light")
        await set_preference(test_db, "theme", "dark")
        assert await get_preference(test_db, "theme") == "dark"


@pytest.mark.unit
class TestSetPreferencesBatch:
    async def test_batch_insert(self, test_db):
        prefs = {"theme": "dark", "difficulty": "beginner", "quiz_count": "5"}
        result = await set_preferences_batch(test_db, prefs)
        assert result == prefs
        all_prefs = await get_all_preferences(test_db)
        assert all_prefs == prefs

    async def test_batch_upsert(self, test_db):
        await set_preference(test_db, "theme", "light")
        await set_preferences_batch(test_db, {"theme": "dark", "lang": "ja"})
        assert await get_preference(test_db, "theme") == "dark"
        assert await get_preference(test_db, "lang") == "ja"


@pytest.mark.unit
class TestDeletePreference:
    async def test_delete_existing(self, test_db):
        await set_preference(test_db, "theme", "dark")
        deleted = await delete_preference(test_db, "theme")
        assert deleted is True
        assert await get_preference(test_db, "theme") is None

    async def test_delete_nonexistent(self, test_db):
        deleted = await delete_preference(test_db, "nonexistent")
        assert deleted is False
