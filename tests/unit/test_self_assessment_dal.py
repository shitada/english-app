"""Unit tests for conversation self-assessment DAL functions."""

import pytest

from app.dal.conversation import save_self_assessment, get_self_assessment


@pytest.mark.asyncio
@pytest.mark.unit
async def test_save_self_assessment(test_db):
    """save_self_assessment inserts a row and returns the saved data."""
    # Create a conversation first
    cursor = await test_db.execute(
        "INSERT INTO conversations (topic, difficulty) VALUES (?, ?)",
        ("hotel_checkin", "intermediate"),
    )
    conv_id = cursor.lastrowid
    await test_db.commit()

    result = await save_self_assessment(test_db, conv_id, 4, 3, 5)
    assert result["conversation_id"] == conv_id
    assert result["confidence_rating"] == 4
    assert result["fluency_rating"] == 3
    assert result["comprehension_rating"] == 5


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_self_assessment(test_db):
    """get_self_assessment retrieves a previously saved assessment."""
    cursor = await test_db.execute(
        "INSERT INTO conversations (topic, difficulty) VALUES (?, ?)",
        ("hotel_checkin", "intermediate"),
    )
    conv_id = cursor.lastrowid
    await test_db.commit()

    await save_self_assessment(test_db, conv_id, 2, 4, 3)
    result = await get_self_assessment(test_db, conv_id)
    assert result is not None
    assert result["confidence_rating"] == 2
    assert result["fluency_rating"] == 4
    assert result["comprehension_rating"] == 3
    assert "created_at" in result


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_self_assessment_not_found(test_db):
    """get_self_assessment returns None when no assessment exists."""
    result = await get_self_assessment(test_db, 99999)
    assert result is None


@pytest.mark.asyncio
@pytest.mark.unit
async def test_save_self_assessment_upsert(test_db):
    """save_self_assessment replaces existing assessment on same conversation."""
    cursor = await test_db.execute(
        "INSERT INTO conversations (topic, difficulty) VALUES (?, ?)",
        ("hotel_checkin", "intermediate"),
    )
    conv_id = cursor.lastrowid
    await test_db.commit()

    await save_self_assessment(test_db, conv_id, 1, 1, 1)
    await save_self_assessment(test_db, conv_id, 5, 4, 3)

    result = await get_self_assessment(test_db, conv_id)
    assert result is not None
    assert result["confidence_rating"] == 5
    assert result["fluency_rating"] == 4
    assert result["comprehension_rating"] == 3
