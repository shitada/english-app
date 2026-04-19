"""Unit tests for listening_speed DAL (Speed Ladder progress)."""

import pytest

from app.dal import listening_speed as ls_dal


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_max_speed_default_when_missing(test_db):
    speed = await ls_dal.get_max_speed(test_db, "business")
    assert speed == 1.0


@pytest.mark.asyncio
@pytest.mark.unit
async def test_record_speed_writes_when_greater(test_db):
    final = await ls_dal.record_speed(test_db, "business", 1.15)
    assert final == 1.15
    assert await ls_dal.get_max_speed(test_db, "business") == 1.15


@pytest.mark.asyncio
@pytest.mark.unit
async def test_record_speed_does_not_lower_existing_max(test_db):
    await ls_dal.record_speed(test_db, "travel", 1.3)
    final = await ls_dal.record_speed(test_db, "travel", 1.0)
    assert final == 1.3
    assert await ls_dal.get_max_speed(test_db, "travel") == 1.3


@pytest.mark.asyncio
@pytest.mark.unit
async def test_record_speed_clamps_into_valid_range(test_db):
    final_high = await ls_dal.record_speed(test_db, "fast", 5.0)
    assert final_high == ls_dal.MAX_SPEED
    final_low = await ls_dal.record_speed(test_db, "slow", -1.0)
    assert final_low == 1.0  # default still wins because clamp(0.5) < default(1.0)
    # Force a stored low value by clearing default first
    await test_db.execute("DELETE FROM listening_speed_progress WHERE topic = 'tiny'")
    await test_db.commit()
    final_tiny = await ls_dal.record_speed(test_db, "tiny", 0.1)
    assert final_tiny == 1.0  # 0.5 clamp < 1.0 default → keeps default


@pytest.mark.asyncio
@pytest.mark.unit
async def test_topics_are_isolated(test_db):
    await ls_dal.record_speed(test_db, "food", 1.5)
    await ls_dal.record_speed(test_db, "sports", 1.15)
    assert await ls_dal.get_max_speed(test_db, "food") == 1.5
    assert await ls_dal.get_max_speed(test_db, "sports") == 1.15
    assert await ls_dal.get_max_speed(test_db, "movies") == 1.0


@pytest.mark.asyncio
@pytest.mark.unit
async def test_topic_normalization_case_insensitive(test_db):
    await ls_dal.record_speed(test_db, "Business", 1.3)
    assert await ls_dal.get_max_speed(test_db, "business") == 1.3
    assert await ls_dal.get_max_speed(test_db, "BUSINESS") == 1.3
