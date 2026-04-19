"""Unit tests for quick_mode persistence on conversations."""

from __future__ import annotations

import pytest

from app.dal.conversation import (
    create_conversation,
    get_active_conversation,
)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_conversation_quick_mode_default_false(test_db):
    conv_id = await create_conversation(test_db, "hotel_checkin")
    conv = await get_active_conversation(test_db, conv_id)
    assert conv is not None
    assert conv["quick_mode"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_conversation_quick_mode_true_round_trip(test_db):
    conv_id = await create_conversation(
        test_db, "hotel_checkin", difficulty="beginner", quick_mode=True
    )
    conv = await get_active_conversation(test_db, conv_id)
    assert conv is not None
    assert conv["quick_mode"] == 1
    assert conv["difficulty"] == "beginner"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_conversation_quick_mode_false_explicit(test_db):
    conv_id = await create_conversation(
        test_db, "hotel_checkin", quick_mode=False
    )
    conv = await get_active_conversation(test_db, conv_id)
    assert conv is not None
    assert conv["quick_mode"] == 0
