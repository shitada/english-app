"""Collocation Chef — delexical/light-verb collocation drill.

Provides verb+noun collocation items where the learner chooses the correct
verb (make/do/take/have/give/pay/keep/break/catch/find) that pairs with a
given noun phrase. Static curated seed list of ~60 items across three
difficulty levels. Copilot is not used by default — the static seed is the
primary source for reliability; it *could* be wired in later as a fallback.
"""

from __future__ import annotations

import logging
import random
from typing import Any, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dal import collocations as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collocations", tags=["collocations"])

Difficulty = Literal["easy", "medium", "hard"]

# Common delexical / light verbs that appear as choices.
LIGHT_VERBS: list[str] = [
    "make", "do", "take", "have", "give",
    "pay", "keep", "break", "catch", "find",
]


def _it(
    item_id: str,
    before: str,
    after: str,
    noun: str,
    verb: str,
    hint: str,
    related: list[str],
    difficulty: Difficulty,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "sentence_before": before,
        "sentence_after": after,
        "noun_phrase": noun,
        "correct_verb": verb,
        "hint": hint,
        "related_collocations": related,
        "difficulty": difficulty,
    }


# ---------------------------------------------------------------------------
# Curated seed bank (~60 items)
# ---------------------------------------------------------------------------

_BANK: list[dict[str, Any]] = [
    # ---------------- easy: ~20 -----------------
    _it("e01", "I need to", "before Friday.", "a decision",
        "make", "'Make' pairs with abstract outcomes you create.",
        ["make a choice", "make a mistake"], "easy"),
    _it("e02", "Let's", "a break for ten minutes.",
        "a break", "take", "'Take a break/rest' — pause an activity.",
        ["take a rest", "take a nap"], "easy"),
    _it("e03", "Did you", "your homework last night?", "your homework",
        "do", "'Do' pairs with tasks and chores.",
        ["do the dishes", "do the laundry"], "easy"),
    _it("e04", "I'd like to", "a shower before dinner.", "a shower",
        "have", "In British English, 'have a shower' is standard.",
        ["have breakfast", "have a rest"], "easy"),
    _it("e05", "Can you", "me a hand with this box?", "a hand",
        "give", "'Give someone a hand' = help them.",
        ["give a speech", "give an example"], "easy"),
    _it("e06", "Please", "attention to the instructions.", "attention",
        "pay", "'Pay attention' — focus mentally.",
        ["pay a visit", "pay a compliment"], "easy"),
    _it("e07", "Try to", "calm during the test.", "calm",
        "keep", "'Keep calm' — remain composed.",
        ["keep quiet", "keep a secret"], "easy"),
    _it("e08", "Don't", "the vase!", "the vase",
        "break", "Physical breakage pairs with 'break'.",
        ["break a window", "break a record"], "easy"),
    _it("e09", "I hope I don't", "a cold this winter.", "a cold",
        "catch", "'Catch a cold/flu' is fixed.",
        ["catch the bus", "catch a train"], "easy"),
    _it("e10", "We need to", "a solution quickly.", "a solution",
        "find", "'Find a solution/answer' is idiomatic.",
        ["find the time", "find an excuse"], "easy"),
    _it("e11", "Children should", "their bed every morning.", "their bed",
        "make", "'Make the bed' — tidy bedding.",
        ["make dinner", "make a noise"], "easy"),
    _it("e12", "I'll", "the washing-up.", "the washing-up",
        "do", "British chore collocation.",
        ["do homework", "do a favour"], "easy"),
    _it("e13", "Let's", "a photo together.", "a photo",
        "take", "'Take a photo/picture' is fixed.",
        ["take notes", "take a look"], "easy"),
    _it("e14", "We usually", "lunch at noon.", "lunch",
        "have", "'Have breakfast/lunch/dinner' — consume meals.",
        ["have dinner", "have a coffee"], "easy"),
    _it("e15", "She wants to", "a party for her birthday.", "a party",
        "have", "'Have a party' — host one.",
        ["have a chat", "have fun"], "easy"),
    _it("e16", "Could you", "me a ride home?", "a ride",
        "give", "'Give someone a ride/lift' — drive them.",
        ["give a gift", "give advice"], "easy"),
    _it("e17", "Remember to", "your taxes on time.", "your taxes",
        "pay", "'Pay taxes/bills/rent' — settle payment.",
        ["pay the bill", "pay rent"], "easy"),
    _it("e18", "Please", "the door open.", "the door open",
        "keep", "'Keep + adj/participle' — maintain a state.",
        ["keep warm", "keep busy"], "easy"),
    _it("e19", "He didn't", "the ball.", "the ball",
        "catch", "Physical 'catch' — grab a thrown object.",
        ["catch a fish", "catch a thief"], "easy"),
    _it("e20", "I hope to", "a good job soon.", "a good job",
        "find", "'Find a job' — secure employment.",
        ["find love", "find a place"], "easy"),

    # ---------------- medium: ~20 ----------------
    _it("m01", "You have to", "an effort if you want to improve.",
        "an effort", "make", "'Make an effort' — exert oneself.",
        ["make progress", "make an attempt"], "medium"),
    _it("m02", "I need to", "some research before I answer.", "some research",
        "do", "'Do research' — carry out investigation.",
        ["do business", "do an experiment"], "medium"),
    _it("m03", "Let's", "advantage of the sunny weather.", "advantage",
        "take", "'Take advantage of' — exploit an opportunity.",
        ["take responsibility", "take a chance"], "medium"),
    _it("m04", "She will", "a meeting with the director tomorrow.",
        "a meeting", "have", "'Have a meeting' — hold one.",
        ["have a discussion", "have an argument"], "medium"),
    _it("m05", "He tried to", "an excuse for being late.", "an excuse",
        "give", "'Give an excuse/reason' — offer one.",
        ["give permission", "give a reason"], "medium"),
    _it("m06", "We should", "tribute to the survivors.", "tribute",
        "pay", "'Pay tribute to' — honour publicly.",
        ["pay respects", "pay heed"], "medium"),
    _it("m07", "Could you", "an eye on the kids?", "an eye",
        "keep", "'Keep an eye on' — watch carefully.",
        ["keep track", "keep in touch"], "medium"),
    _it("m08", "She tried not to", "her promise.", "her promise",
        "break", "'Break a promise/rule/law' — violate it.",
        ["break the rules", "break a habit"], "medium"),
    _it("m09", "Police are trying to", "the suspect.", "the suspect",
        "catch", "'Catch a suspect' — apprehend.",
        ["catch someone's eye", "catch fire"], "medium"),
    _it("m10", "Let me know if you", "the time to help.", "the time",
        "find", "'Find the time' — locate availability.",
        ["find your way", "find fault"], "medium"),
    _it("m11", "Don't", "assumptions about people.", "assumptions",
        "make", "'Make assumptions' — presume.",
        ["make plans", "make sense"], "medium"),
    _it("m12", "Children", "harm to themselves if unsupervised.", "harm",
        "do", "'Do harm/damage/good' — abstract effect.",
        ["do damage", "do good"], "medium"),
    _it("m13", "Please", "a seat while you wait.", "a seat",
        "take", "'Take a seat' — sit down (polite).",
        ["take your time", "take a step"], "medium"),
    _it("m14", "I", "doubts about the plan.", "doubts",
        "have", "'Have doubts/concerns' — feel uncertainty.",
        ["have an opinion", "have concerns"], "medium"),
    _it("m15", "The teacher will", "a lecture on climate.", "a lecture",
        "give", "'Give a lecture/talk/presentation' — deliver one.",
        ["give a presentation", "give a talk"], "medium"),
    _it("m16", "Sorry, I can't", "you the compliment back.", "the compliment",
        "pay", "'Pay a compliment' — offer praise.",
        ["pay attention", "pay a visit"], "medium"),
    _it("m17", "Try to", "your temper during negotiations.", "your temper",
        "keep", "'Keep your temper' — stay composed.",
        ["keep a promise", "keep control"], "medium"),
    _it("m18", "They hope to", "the world record this year.", "the world record",
        "break", "'Break a record' — exceed the best.",
        ["break the news", "break the ice"], "medium"),
    _it("m19", "Did you", "the train on time?", "the train",
        "catch", "'Catch a train/bus/flight' — board in time.",
        ["catch a flight", "catch up"], "medium"),
    _it("m20", "We need to", "common ground here.", "common ground",
        "find", "'Find common ground' — reach agreement.",
        ["find peace", "find comfort"], "medium"),

    # ---------------- hard: ~20 ----------------
    _it("h01", "Let me", "a long story short.", "a long story short",
        "make", "Idiom: 'make a long story short' — summarise.",
        ["make amends", "make headway"], "hard"),
    _it("h02", "He'd rather", "without coffee than without tea.", "without",
        "do", "'Do without' — manage without something.",
        ["do justice", "do wonders"], "hard"),
    _it("h03", "The minister will", "office next month.", "office",
        "take", "'Take office' — begin a post.",
        ["take the initiative", "take offence"], "hard"),
    _it("h04", "They", "second thoughts about the merger.", "second thoughts",
        "have", "'Have second thoughts' — reconsider.",
        ["have a point", "have a say"], "hard"),
    _it("h05", "His remarks", "rise to widespread protests.", "rise",
        "give", "'Give rise to' — cause.",
        ["give way", "give ground"], "hard"),
    _it("h06", "The company must", "dividends to shareholders.", "dividends",
        "pay", "'Pay dividends' — yield returns.",
        ["pay the price", "pay lip service"], "hard"),
    _it("h07", "Please", "your wits about you in the market.", "your wits",
        "keep", "'Keep your wits about you' — stay alert.",
        ["keep tabs on", "keep at bay"], "hard"),
    _it("h08", "Try not to", "ranks with the opposition.", "ranks",
        "break", "'Break ranks' — dissent from a group.",
        ["break new ground", "break even"], "hard"),
    _it("h09", "She managed to", "him off guard.", "him off guard",
        "catch", "'Catch off guard' — surprise.",
        ["catch on", "catch red-handed"], "hard"),
    _it("h10", "It's hard to", "fault with her argument.", "fault",
        "find", "'Find fault with' — criticise.",
        ["find favour", "find refuge"], "hard"),
    _it("h11", "He hopes to", "a name for himself in tech.", "a name",
        "make", "'Make a name for oneself' — gain reputation.",
        ["make ends meet", "make do"], "hard"),
    _it("h12", "Let's", "away with these outdated rules.", "away",
        "do", "'Do away with' — abolish.",
        ["do the trick", "do one's best"], "hard"),
    _it("h13", "She refuses to", "sides in this dispute.", "sides",
        "take", "'Take sides' — support one party.",
        ["take stock", "take for granted"], "hard"),
    _it("h14", "The policy", "far-reaching consequences.",
        "far-reaching consequences", "have", "'Have consequences' — result in.",
        ["have a bearing", "have faith"], "hard"),
    _it("h15", "I'll", "you the benefit of the doubt.", "the benefit of the doubt",
        "give", "'Give the benefit of the doubt' — trust tentatively.",
        ["give credence", "give credit"], "hard"),
    _it("h16", "Don't", "lip service to diversity.", "lip service",
        "pay", "'Pay lip service to' — support insincerely.",
        ["pay one's dues", "pay homage"], "hard"),
    _it("h17", "He managed to", "his composure throughout.", "his composure",
        "keep", "'Keep one's composure' — stay calm.",
        ["keep pace", "keep count"], "hard"),
    _it("h18", "The news will", "the silence on this scandal.", "the silence",
        "break", "'Break the silence' — finally speak.",
        ["break cover", "break loose"], "hard"),
    _it("h19", "Try to", "the gist of the article.", "the gist",
        "catch", "'Catch the gist' — grasp the meaning.",
        ["catch wind of", "catch sight of"], "hard"),
    _it("h20", "We hope to", "common cause with our allies.", "common cause",
        "find", "'Find common cause' — share a goal.",
        ["find oneself", "find closure"], "hard"),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CollocationItem(BaseModel):
    id: str
    sentence_before: str
    sentence_after: str
    noun_phrase: str
    correct_verb: str
    verb_choices: list[str]
    hint: str
    related_collocations: list[str]
    difficulty: str


class CollocationSessionResponse(BaseModel):
    items: list[CollocationItem]


class CollocationAttemptRequest(BaseModel):
    item_id: str = Field(..., min_length=1, max_length=64)
    sentence: str = Field(..., min_length=1, max_length=500)
    correct_verb: str = Field(..., min_length=1, max_length=32)
    chosen_verb: str = Field(..., min_length=1, max_length=32)
    is_correct: bool
    response_ms: int | None = Field(default=None, ge=0, le=10 * 60 * 1000)


class CollocationAttemptResponse(BaseModel):
    id: int
    is_correct: bool


class CollocationStatsResponse(BaseModel):
    total_attempts: int
    accuracy: float
    per_verb_accuracy: dict[str, float]
    weakest_verbs: list[str]
    recent_sessions: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_choices(correct: str, rng: random.Random) -> list[str]:
    """Return 4 verb choices including `correct`. Distractors drawn from LIGHT_VERBS."""
    c = correct.lower()
    pool = [v for v in LIGHT_VERBS if v != c]
    rng.shuffle(pool)
    picks = [c] + pool[:3]
    rng.shuffle(picks)
    return picks


def build_session(
    count: int = 8,
    difficulty: Difficulty | None = None,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Return a list of items with 4-chip `verb_choices`. Pure helper."""
    count = max(1, min(int(count), 30))
    rng = random.Random(seed)
    pool = [it for it in _BANK if difficulty is None or it["difficulty"] == difficulty]
    if not pool:
        pool = list(_BANK)
    rng.shuffle(pool)
    chosen = pool[:count]
    out: list[dict[str, Any]] = []
    for it in chosen:
        out.append({
            "id": it["id"],
            "sentence_before": it["sentence_before"],
            "sentence_after": it["sentence_after"],
            "noun_phrase": it["noun_phrase"],
            "correct_verb": it["correct_verb"],
            "verb_choices": _build_choices(it["correct_verb"], rng),
            "hint": it["hint"],
            "related_collocations": list(it["related_collocations"]),
            "difficulty": it["difficulty"],
        })
    return out


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/session", response_model=CollocationSessionResponse)
async def get_session(
    count: int = Query(default=8, ge=1, le=30),
    difficulty: Difficulty = Query(default="easy"),
) -> CollocationSessionResponse:
    """Return a curated session of collocation items for the given difficulty."""
    items = build_session(count=count, difficulty=difficulty)
    return CollocationSessionResponse(
        items=[CollocationItem(**it) for it in items]
    )


@router.post("/attempt", response_model=CollocationAttemptResponse)
async def submit_attempt(
    payload: CollocationAttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> CollocationAttemptResponse:
    """Persist one collocation attempt."""
    try:
        new_id = await dal.save_attempt(
            db,
            item_id=payload.item_id,
            sentence=payload.sentence,
            correct_verb=payload.correct_verb,
            chosen_verb=payload.chosen_verb,
            is_correct=bool(payload.is_correct),
            response_ms=payload.response_ms,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record collocation attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")
    return CollocationAttemptResponse(id=new_id, is_correct=payload.is_correct)


@router.get("/stats", response_model=CollocationStatsResponse)
async def get_stats(
    limit: int = Query(default=500, ge=1, le=2000),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> CollocationStatsResponse:
    """Return aggregated stats: overall accuracy, per-verb, weakest verbs, recent."""
    try:
        stats = await dal.get_stats(db, limit=limit)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute collocation stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")
    return CollocationStatsResponse(**stats)
