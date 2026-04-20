"""Integration tests for the Power Word Challenge (target SRS words in conversation)."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock


async def _seed_due_words(client, words: list[str]) -> None:
    """Seed `vocabulary_words` rows that lack progress (so pick_target_words picks them
    via the fallback recently-saved branch)."""
    from app.database import get_db_session
    from app.main import app

    # Resolve the override added by the `client` fixture.
    dep = app.dependency_overrides[get_db_session]
    gen = dep()
    db = await gen.__anext__()
    try:
        for w in words:
            await db.execute(
                "INSERT INTO vocabulary_words (topic, word, meaning, example_sentence, difficulty) "
                "VALUES (?, ?, ?, ?, ?)",
                ("hotel_checkin", w, f"meaning of {w}", f"Sample {w} sentence.", 2),
            )
        await db.commit()
    finally:
        await db.close()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_start_returns_target_words(client, mock_copilot):
    await _seed_due_words(client, ["accommodation", "vacancy", "reservation"])
    mock_copilot.ask = AsyncMock(return_value="Hello! Welcome to our hotel.")

    res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert "target_words" in data
    assert isinstance(data["target_words"], list)
    assert len(data["target_words"]) >= 1
    assert len(data["target_words"]) <= 3
    # All returned words should be from the seeded set.
    for w in data["target_words"]:
        assert w.lower() in {"accommodation", "vacancy", "reservation"}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_message_marks_target_word_used(client, mock_copilot):
    await _seed_due_words(client, ["accommodation", "vacancy", "reservation"])
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    targets = start_res.json()["target_words"]
    assert targets, "expected at least one target word"

    # Use the first target word — also test 's' morphology
    target = targets[0]
    user_text = f"I would like a {target}s please."

    mock_copilot.ask = AsyncMock(return_value="Sure thing.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": user_text, "is_correct": True, "errors": [], "suggestions": [],
    })
    msg_res = await client.post(
        "/api/conversation/message",
        json={"conversation_id": conv_id, "content": user_text},
    )
    assert msg_res.status_code == 200, msg_res.text
    body = msg_res.json()
    assert "target_words_used" in body
    assert "newly_used_target_words" in body
    used_lower = {w.lower() for w in body["target_words_used"]}
    assert target.lower() in used_lower
    newly_lower = {w.lower() for w in body["newly_used_target_words"]}
    assert target.lower() in newly_lower

    # Sending the same message again should NOT re-mark it as newly used.
    msg_res2 = await client.post(
        "/api/conversation/message",
        json={"conversation_id": conv_id, "content": user_text},
    )
    assert msg_res2.status_code == 200
    body2 = msg_res2.json()
    assert body2["newly_used_target_words"] == []
    used2_lower = {w.lower() for w in body2["target_words_used"]}
    assert target.lower() in used2_lower


@pytest.mark.integration
@pytest.mark.asyncio
async def test_end_summary_includes_target_split_and_bumps_srs(client, mock_copilot):
    await _seed_due_words(client, ["accommodation", "vacancy", "reservation"])
    mock_copilot.ask = AsyncMock(return_value="Welcome!")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    targets = start_res.json()["target_words"]
    assert targets

    used_word = targets[0]
    mock_copilot.ask = AsyncMock(return_value="Got it.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": f"I want a {used_word}.",
        "is_correct": True, "errors": [], "suggestions": [],
    })
    await client.post(
        "/api/conversation/message",
        json={"conversation_id": conv_id, "content": f"I want a {used_word}."},
    )

    # End conversation. Summary LLM returns minimal valid JSON.
    mock_copilot.ask_json = AsyncMock(return_value={
        "key_vocabulary": [], "communication_level": "intermediate", "tip": "",
    })
    end_res = await client.post(
        "/api/conversation/end",
        json={"conversation_id": conv_id, "skip_summary": False},
    )
    assert end_res.status_code == 200, end_res.text
    summary = end_res.json()["summary"]
    assert "target_words" in summary
    tw = summary["target_words"]
    assert sorted([w.lower() for w in tw["all"]]) == sorted([w.lower() for w in targets])
    assert used_word.lower() in {w.lower() for w in tw["used"]}
    unused_lower = {w.lower() for w in tw["unused"]}
    for t in targets:
        if t.lower() != used_word.lower():
            assert t.lower() in unused_lower

    # SRS progress row should have been created/bumped for the used word.
    from app.database import get_db_session
    from app.main import app

    dep = app.dependency_overrides[get_db_session]
    gen = dep()
    db = await gen.__anext__()
    try:
        rows = await db.execute_fetchall(
            """SELECT vp.level, vp.correct_count
               FROM vocabulary_progress vp
               JOIN vocabulary_words vw ON vp.word_id = vw.id
               WHERE LOWER(vw.word) = LOWER(?)""",
            (used_word,),
        )
        assert rows, "Expected SRS progress row for used target word"
        assert rows[0]["correct_count"] >= 1
        assert rows[0]["level"] >= 1
    finally:
        await db.close()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_target_word_morphology_variants(client, mock_copilot):
    """The detector should accept 's', 'es', 'ed', 'ing' morphology."""
    await _seed_due_words(client, ["walk"])
    mock_copilot.ask = AsyncMock(return_value="Hi.")
    start_res = await client.post("/api/conversation/start", json={"topic": "hotel_checkin"})
    conv_id = start_res.json()["conversation_id"]
    targets = start_res.json()["target_words"]
    assert "walk" in [t.lower() for t in targets]

    mock_copilot.ask = AsyncMock(return_value="Cool.")
    mock_copilot.ask_json = AsyncMock(return_value={
        "corrected_text": "I was walking yesterday.",
        "is_correct": True, "errors": [], "suggestions": [],
    })
    res = await client.post(
        "/api/conversation/message",
        json={"conversation_id": conv_id, "content": "I was walking yesterday."},
    )
    assert res.status_code == 200
    body = res.json()
    assert any(w.lower() == "walk" for w in body["target_words_used"])
