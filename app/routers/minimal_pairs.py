"""Minimal Pairs phoneme-discrimination drill API.

Endpoints:
  * GET  /api/minimal-pairs/session  — returns a randomized session
  * POST /api/minimal-pairs/answer   — records a single answer
  * GET  /api/minimal-pairs/stats    — per-contrast accuracy (last 30 days)

Audio: the frontend uses the Web Speech API to synthesize the target word,
so the API returns ``audio_b64 = None`` and a ``target_word`` string.
"""

from __future__ import annotations

import logging
import random
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dal import minimal_pairs as mp_dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/minimal-pairs", tags=["minimal-pairs"])


# ---------------------------------------------------------------------------
# Curated pair bank — grouped by phoneme contrast category
# ---------------------------------------------------------------------------

PAIR_BANK: list[dict[str, Any]] = [
    # /ɪ/ vs /iː/
    {"id": "iy-ih-01", "contrast": "IY_vs_IH", "word_a": "ship", "word_b": "sheep",
     "example_a": "The ship sailed at dawn.", "example_b": "The sheep grazed in the field."},
    {"id": "iy-ih-02", "contrast": "IY_vs_IH", "word_a": "bit", "word_b": "beat",
     "example_a": "Give me a little bit.", "example_b": "We beat the other team."},
    {"id": "iy-ih-03", "contrast": "IY_vs_IH", "word_a": "live", "word_b": "leave",
     "example_a": "Where do you live?", "example_b": "Please don't leave yet."},
    {"id": "iy-ih-04", "contrast": "IY_vs_IH", "word_a": "fill", "word_b": "feel",
     "example_a": "Please fill the glass.", "example_b": "I feel happy today."},
    {"id": "iy-ih-05", "contrast": "IY_vs_IH", "word_a": "hit", "word_b": "heat",
     "example_a": "Don't hit the wall.", "example_b": "The heat is intense."},
    {"id": "iy-ih-06", "contrast": "IY_vs_IH", "word_a": "sit", "word_b": "seat",
     "example_a": "Please sit down.", "example_b": "Take your seat, please."},
    # /æ/ vs /e/
    {"id": "ae-eh-01", "contrast": "AE_vs_EH", "word_a": "bat", "word_b": "bet",
     "example_a": "He swung the bat.", "example_b": "I'll bet on the red team."},
    {"id": "ae-eh-02", "contrast": "AE_vs_EH", "word_a": "man", "word_b": "men",
     "example_a": "That man is tall.", "example_b": "Those men are tall."},
    {"id": "ae-eh-03", "contrast": "AE_vs_EH", "word_a": "pan", "word_b": "pen",
     "example_a": "Heat the pan first.", "example_b": "Sign with this pen."},
    {"id": "ae-eh-04", "contrast": "AE_vs_EH", "word_a": "sat", "word_b": "set",
     "example_a": "She sat on the chair.", "example_b": "Set the table, please."},
    {"id": "ae-eh-05", "contrast": "AE_vs_EH", "word_a": "had", "word_b": "head",
     "example_a": "I had lunch already.", "example_b": "Mind your head!"},
    {"id": "ae-eh-06", "contrast": "AE_vs_EH", "word_a": "laughed", "word_b": "left",
     "example_a": "We laughed together.", "example_b": "She left early today."},
    # /l/ vs /r/
    {"id": "l-r-01", "contrast": "L_vs_R", "word_a": "light", "word_b": "right",
     "example_a": "Turn on the light.", "example_b": "You are right."},
    {"id": "l-r-02", "contrast": "L_vs_R", "word_a": "lead", "word_b": "read",
     "example_a": "Please lead the way.", "example_b": "I like to read books."},
    {"id": "l-r-03", "contrast": "L_vs_R", "word_a": "long", "word_b": "wrong",
     "example_a": "It was a long day.", "example_b": "That answer is wrong."},
    {"id": "l-r-04", "contrast": "L_vs_R", "word_a": "glass", "word_b": "grass",
     "example_a": "Pour some glass cleaner.", "example_b": "The grass is green."},
    {"id": "l-r-05", "contrast": "L_vs_R", "word_a": "collect", "word_b": "correct",
     "example_a": "I collect stamps.", "example_b": "Is this answer correct?"},
    {"id": "l-r-06", "contrast": "L_vs_R", "word_a": "play", "word_b": "pray",
     "example_a": "Let's play a game.", "example_b": "They pray each morning."},
    # /b/ vs /v/
    {"id": "b-v-01", "contrast": "B_vs_V", "word_a": "berry", "word_b": "very",
     "example_a": "I ate a red berry.", "example_b": "That is very kind."},
    {"id": "b-v-02", "contrast": "B_vs_V", "word_a": "best", "word_b": "vest",
     "example_a": "Do your best.", "example_b": "He wore a warm vest."},
    {"id": "b-v-03", "contrast": "B_vs_V", "word_a": "bat", "word_b": "vat",
     "example_a": "Swing the bat hard.", "example_b": "Pour it in the vat."},
    {"id": "b-v-04", "contrast": "B_vs_V", "word_a": "boat", "word_b": "vote",
     "example_a": "We took a boat ride.", "example_b": "Please cast your vote."},
    {"id": "b-v-05", "contrast": "B_vs_V", "word_a": "curb", "word_b": "curve",
     "example_a": "Park by the curb.", "example_b": "The road has a curve."},
    {"id": "b-v-06", "contrast": "B_vs_V", "word_a": "rebel", "word_b": "revel",
     "example_a": "He is a rebel.", "example_b": "They revel at parties."},
    # /s/ vs /ʃ/
    {"id": "s-sh-01", "contrast": "S_vs_SH", "word_a": "sip", "word_b": "ship",
     "example_a": "Take a small sip.", "example_b": "The ship set sail."},
    {"id": "s-sh-02", "contrast": "S_vs_SH", "word_a": "save", "word_b": "shave",
     "example_a": "Save the file now.", "example_b": "He needs to shave."},
    {"id": "s-sh-03", "contrast": "S_vs_SH", "word_a": "sue", "word_b": "shoe",
     "example_a": "They will sue the company.", "example_b": "Tie your shoe."},
    {"id": "s-sh-04", "contrast": "S_vs_SH", "word_a": "see", "word_b": "she",
     "example_a": "I can see it clearly.", "example_b": "She is my friend."},
    {"id": "s-sh-05", "contrast": "S_vs_SH", "word_a": "sort", "word_b": "short",
     "example_a": "Please sort the mail.", "example_b": "This rope is short."},
    {"id": "s-sh-06", "contrast": "S_vs_SH", "word_a": "sell", "word_b": "shell",
     "example_a": "We sell fresh bread.", "example_b": "The shell was pink."},
    # /θ/ vs /s/
    {"id": "th-s-01", "contrast": "TH_vs_S", "word_a": "think", "word_b": "sink",
     "example_a": "I think so too.", "example_b": "Fill the kitchen sink."},
    {"id": "th-s-02", "contrast": "TH_vs_S", "word_a": "thing", "word_b": "sing",
     "example_a": "What a lovely thing.", "example_b": "Please sing a song."},
    {"id": "th-s-03", "contrast": "TH_vs_S", "word_a": "thick", "word_b": "sick",
     "example_a": "The book is thick.", "example_b": "She feels sick today."},
    {"id": "th-s-04", "contrast": "TH_vs_S", "word_a": "thumb", "word_b": "sum",
     "example_a": "I hurt my thumb.", "example_b": "What is the sum?"},
    {"id": "th-s-05", "contrast": "TH_vs_S", "word_a": "path", "word_b": "pass",
     "example_a": "Take the forest path.", "example_b": "You will pass the test."},
    {"id": "th-s-06", "contrast": "TH_vs_S", "word_a": "mouth", "word_b": "mouse",
     "example_a": "Open your mouth.", "example_b": "A mouse ran past."},
    # /n/ vs /ŋ/
    {"id": "n-ng-01", "contrast": "N_vs_NG", "word_a": "thin", "word_b": "thing",
     "example_a": "That line is thin.", "example_b": "What a strange thing."},
    {"id": "n-ng-02", "contrast": "N_vs_NG", "word_a": "sin", "word_b": "sing",
     "example_a": "It's a small sin.", "example_b": "Please sing for us."},
    {"id": "n-ng-03", "contrast": "N_vs_NG", "word_a": "ran", "word_b": "rang",
     "example_a": "He ran to the bus.", "example_b": "The phone rang twice."},
    {"id": "n-ng-04", "contrast": "N_vs_NG", "word_a": "ban", "word_b": "bang",
     "example_a": "We ban that word.", "example_b": "I heard a loud bang."},
    {"id": "n-ng-05", "contrast": "N_vs_NG", "word_a": "win", "word_b": "wing",
     "example_a": "We will win today.", "example_b": "The bird's wing is hurt."},
    {"id": "n-ng-06", "contrast": "N_vs_NG", "word_a": "ton", "word_b": "tongue",
     "example_a": "It weighs a ton.", "example_b": "She bit her tongue."},
]

VALID_CONTRASTS: set[str] = {p["contrast"] for p in PAIR_BANK}

# In-memory streak counter (per-process). Good enough for a single-user app.
_current_streak: int = 0


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SessionItem(BaseModel):
    item_id: str
    contrast: str
    word_a: str
    word_b: str
    example_a: str
    example_b: str
    target: Literal["a", "b"]
    target_word: str
    audio_b64: str | None = None


class SessionResponse(BaseModel):
    contrast: str | None = None  # filter used, or None for mixed
    items: list[SessionItem]


class AnswerRequest(BaseModel):
    item_id: str = Field(min_length=1, max_length=64)
    contrast: str = Field(min_length=1, max_length=64)
    target: Literal["a", "b"]
    chosen: Literal["a", "b"]


class AnswerResponse(BaseModel):
    correct: bool
    streak: int


class ContrastStat(BaseModel):
    contrast: str
    attempts: int
    correct: int
    accuracy: float


class StatsResponse(BaseModel):
    stats: list[ContrastStat]
    weakest: list[ContrastStat]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/contrasts")
async def list_contrasts() -> dict[str, list[str]]:
    """Return the list of supported contrast keys (for filter UIs)."""
    return {"contrasts": sorted(VALID_CONTRASTS)}


@router.get("/session", response_model=SessionResponse)
async def get_session(
    contrast: str | None = Query(default=None, max_length=64),
    count: int = Query(default=8, ge=1, le=20),
) -> SessionResponse:
    """Return a randomized session of ``count`` items.

    If ``contrast`` is provided, items are limited to that phoneme contrast.
    """
    pool = PAIR_BANK
    if contrast:
        if contrast not in VALID_CONTRASTS:
            raise HTTPException(status_code=400, detail=f"Unknown contrast: {contrast}")
        pool = [p for p in PAIR_BANK if p["contrast"] == contrast]
        if not pool:
            raise HTTPException(status_code=404, detail="No items for that contrast")

    picks = random.sample(pool, k=min(count, len(pool)))
    items: list[SessionItem] = []
    for p in picks:
        target = random.choice(("a", "b"))
        target_word = p["word_a"] if target == "a" else p["word_b"]
        items.append(SessionItem(
            item_id=p["id"],
            contrast=p["contrast"],
            word_a=p["word_a"],
            word_b=p["word_b"],
            example_a=p["example_a"],
            example_b=p["example_b"],
            target=target,  # type: ignore[arg-type]
            target_word=target_word,
            audio_b64=None,
        ))
    return SessionResponse(contrast=contrast, items=items)


@router.post("/answer", response_model=AnswerResponse)
async def submit_answer(
    payload: AnswerRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> AnswerResponse:
    """Record a single answer. Updates the in-memory streak counter."""
    global _current_streak

    # Look up the referenced item so we can persist canonical word text.
    item = next((p for p in PAIR_BANK if p["id"] == payload.item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Unknown item_id")
    if payload.contrast != item["contrast"]:
        raise HTTPException(status_code=400, detail="contrast does not match item_id")

    correct = payload.chosen == payload.target
    try:
        await mp_dal.record_attempt(
            db,
            item_id=payload.item_id,
            contrast=payload.contrast,
            word_a=item["word_a"],
            word_b=item["word_b"],
            target=payload.target,
            chosen=payload.chosen,
            is_correct=correct,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record minimal-pairs attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")

    if correct:
        _current_streak += 1
    else:
        _current_streak = 0

    return AnswerResponse(correct=correct, streak=_current_streak)


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    lookback_days: int = Query(default=30, ge=1, le=365),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StatsResponse:
    """Per-contrast aggregated accuracy for the last N days."""
    try:
        stats = await mp_dal.get_contrast_stats(db, lookback_days=lookback_days)
        weakest = await mp_dal.get_weakest_contrasts(db, lookback_days=lookback_days)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute minimal-pairs stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")
    return StatsResponse(
        stats=[ContrastStat(**s) for s in stats],
        weakest=[ContrastStat(**s) for s in weakest],
    )


def _reset_streak_for_tests() -> None:  # pragma: no cover - test helper
    global _current_streak
    _current_streak = 0
