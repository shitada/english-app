"""Confusable Word Pair picker drill API.

A focused micro-drill that targets commonly confused English word pairs
(affect/effect, borrow/lend, bring/take, say/tell, fewer/less, its/it's,
lay/lie, rise/raise, remember/remind, since/for, make/do, win/beat).

Endpoints
---------
    POST /api/confusable-pairs/start          → new session with 8 items.
    POST /api/confusable-pairs/answer         → record one attempt + feedback.
    GET  /api/confusable-pairs/summary/{sid}  → per-pair accuracy + weakest.
"""

from __future__ import annotations

import logging
import random
import uuid
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import confusable_pairs as dal
from app.database import get_db_session
from app.prompts import build_confusable_pairs_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/confusable-pairs", tags=["confusable-pairs"])


SESSION_SIZE = 8
VALID_DIFFICULTIES = {"easy", "medium", "hard"}
VALID_PAIR_KEYS = {
    "affect_effect",
    "borrow_lend",
    "bring_take",
    "say_tell",
    "fewer_less",
    "its_its_apostrophe",
    "lay_lie",
    "rise_raise",
    "remember_remind",
    "since_for",
    "make_do",
    "win_beat",
}


# ---------------------------------------------------------------------------
# Static fallback bank — 12 pairs × 2 sentences each.
# ---------------------------------------------------------------------------
def _it(
    iid: str,
    sentence: str,
    options: list[str],
    correct: str,
    pair_key: str,
    difficulty: str,
    explanation: str,
) -> dict[str, Any]:
    example = sentence.replace("____", correct)
    return {
        "id": iid,
        "sentence_with_blank": sentence,
        "options": list(options),
        "correct_word": correct,
        "pair_key": pair_key,
        "difficulty": difficulty,
        "explanation": explanation,
        "example_sentence": example,
    }


_FALLBACK_BANK: list[dict[str, Any]] = [
    # affect / effect
    _it("ae01", "The new rule will ____ everyone in the office.",
        ["affect", "effect"], "affect", "affect_effect", "medium",
        "'affect' is the verb meaning to influence; 'effect' is the noun."),
    _it("ae02", "The medicine had a strong ____ on him.",
        ["affect", "effect"], "effect", "affect_effect", "medium",
        "'effect' is a noun meaning a result; 'affect' is the verb."),
    # borrow / lend
    _it("bl01", "Can I ____ your pen for a minute?",
        ["borrow", "lend"], "borrow", "borrow_lend", "easy",
        "'borrow' = take temporarily from someone; 'lend' = give temporarily."),
    _it("bl02", "Could you ____ me ten dollars?",
        ["borrow", "lend"], "lend", "borrow_lend", "easy",
        "You 'lend' something TO someone; they 'borrow' it FROM you."),
    # bring / take
    _it("bt01", "Please ____ these documents to the meeting tomorrow.",
        ["bring", "take"], "bring", "bring_take", "medium",
        "'bring' = toward the speaker/listener; 'take' = away from here."),
    _it("bt02", "I'll ____ the empty bottles out to the recycling.",
        ["bring", "take"], "take", "bring_take", "medium",
        "Movement AWAY from the current place uses 'take'."),
    # say / tell
    _it("st01", "Please ____ me what happened.",
        ["say", "tell"], "tell", "say_tell", "easy",
        "'tell' takes a personal object (tell me); 'say' does not."),
    _it("st02", "She didn't ____ anything at the meeting.",
        ["say", "tell"], "say", "say_tell", "easy",
        "Use 'say' with reported content and no personal object."),
    # fewer / less
    _it("fl01", "There were ____ people than we expected.",
        ["fewer", "less"], "fewer", "fewer_less", "medium",
        "'fewer' with countable nouns; 'less' with uncountables."),
    _it("fl02", "I drink ____ coffee than I used to.",
        ["fewer", "less"], "less", "fewer_less", "medium",
        "'coffee' here is uncountable, so use 'less'."),
    # its / it's
    _it("ia01", "The dog wagged ____ tail happily.",
        ["its", "it's"], "its", "its_its_apostrophe", "easy",
        "'its' is the possessive; 'it's' = 'it is' / 'it has'."),
    _it("ia02", "____ going to rain tonight.",
        ["its", "it's"], "it's", "its_its_apostrophe", "easy",
        "'it's' is the contraction of 'it is'."),
    # lay / lie
    _it("ll01", "I need to ____ down for a nap.",
        ["lay", "lie"], "lie", "lay_lie", "hard",
        "'lie' = recline (no object); 'lay' = put something down (needs object)."),
    _it("ll02", "Please ____ the book on the table.",
        ["lay", "lie"], "lay", "lay_lie", "hard",
        "'lay' takes a direct object; 'lie' does not."),
    # rise / raise
    _it("rr01", "Prices will ____ again next month.",
        ["rise", "raise"], "rise", "rise_raise", "medium",
        "'rise' is intransitive; 'raise' needs an object."),
    _it("rr02", "The company decided to ____ salaries by five percent.",
        ["rise", "raise"], "raise", "rise_raise", "medium",
        "'raise' is transitive — you raise something."),
    # remember / remind
    _it("rm01", "Please ____ me to call the dentist.",
        ["remember", "remind"], "remind", "remember_remind", "easy",
        "'remind' = cause someone to remember; 'remember' = recall oneself."),
    _it("rm02", "I can't ____ her name.",
        ["remember", "remind"], "remember", "remember_remind", "easy",
        "'remember' = recall something yourself."),
    # since / for
    _it("sf01", "I've lived here ____ 2015.",
        ["since", "for"], "since", "since_for", "medium",
        "'since' + point in time; 'for' + duration."),
    _it("sf02", "We've been waiting ____ two hours.",
        ["since", "for"], "for", "since_for", "medium",
        "'for' + length of time; 'since' + start point."),
    # make / do
    _it("md01", "Did you ____ your homework last night?",
        ["make", "do"], "do", "make_do", "medium",
        "'do' with tasks/duties; 'make' with things you create."),
    _it("md02", "I need to ____ a decision soon.",
        ["make", "do"], "make", "make_do", "medium",
        "Collocation: 'make a decision' (not 'do')."),
    # win / beat
    _it("wb01", "Our team hopes to ____ the championship this year.",
        ["win", "beat"], "win", "win_beat", "medium",
        "You WIN a prize/game; you BEAT an opponent."),
    _it("wb02", "We ____ them 3-1 in the final.",
        ["win", "beat"], "beat", "win_beat", "medium",
        "Use 'beat' with an opponent as the object."),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConfusablePairItem(BaseModel):
    id: str
    sentence_with_blank: str
    options: list[str]
    pair_key: str
    difficulty: str


class StartSessionRequest(BaseModel):
    count: int = Field(default=SESSION_SIZE, ge=1, le=20)
    difficulty: str | None = Field(default=None, max_length=20)
    pair_key: str | None = Field(default=None, max_length=40)


class StartSessionResponse(BaseModel):
    session_id: str
    items: list[ConfusablePairItem]


class AnswerRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=80)
    item_id: str = Field(..., min_length=1, max_length=80)
    choice: str = Field(..., min_length=1, max_length=40)


class AnswerResponse(BaseModel):
    correct: bool
    correct_word: str
    explanation: str
    example_sentence: str


class SummaryResponse(BaseModel):
    total: int
    correct: int
    per_pair_accuracy: dict[str, float]
    weakest_pair: str | None


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable)
# ---------------------------------------------------------------------------

def _coerce_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    sentence = str(raw.get("sentence_with_blank") or "").strip()
    options_raw = raw.get("options")
    correct = str(raw.get("correct_word") or "").strip()
    pair_key = str(raw.get("pair_key") or "").strip().lower()
    difficulty = str(raw.get("difficulty") or "medium").strip().lower()
    explanation = str(raw.get("explanation") or "").strip()
    example = str(raw.get("example_sentence") or "").strip()
    item_id = str(raw.get("id") or "").strip()

    if not isinstance(options_raw, list) or len(options_raw) != 2:
        return None
    options = [str(o).strip() for o in options_raw if str(o).strip()]
    if len(options) != 2:
        return None
    if not sentence or "____" not in sentence:
        return None
    if correct not in options:
        return None
    if pair_key not in VALID_PAIR_KEYS:
        return None
    if difficulty not in VALID_DIFFICULTIES:
        difficulty = "medium"
    if not item_id:
        item_id = f"llm-{uuid.uuid4().hex[:8]}"
    if not example:
        example = sentence.replace("____", correct)
    if not explanation:
        explanation = f"The correct word here is '{correct}'."
    return {
        "id": item_id,
        "sentence_with_blank": sentence,
        "options": options,
        "correct_word": correct,
        "pair_key": pair_key,
        "difficulty": difficulty,
        "explanation": explanation,
        "example_sentence": example,
    }


def coerce_session_payload(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        return None
    out: list[dict[str, Any]] = []
    for it in items_raw:
        coerced = _coerce_item(it)
        if coerced is not None:
            out.append(coerced)
    return out or None


def build_fallback_session(
    count: int = SESSION_SIZE,
    pair_key: str | None = None,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Pick `count` items from the curated fallback bank."""
    rng = random.Random(seed)
    pool = list(_FALLBACK_BANK)
    if pair_key:
        filtered = [it for it in pool if it["pair_key"] == pair_key]
        if filtered:
            pool = filtered
    rng.shuffle(pool)
    out: list[dict[str, Any]] = []
    idx = 0
    while len(out) < count and pool:
        out.append(dict(pool[idx % len(pool)]))
        idx += 1
    return out[:count]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/start", response_model=StartSessionResponse)
async def start_session(
    payload: StartSessionRequest | None = None,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StartSessionResponse:
    """Return a fresh session with up to 8 confusable-pair items."""
    payload = payload or StartSessionRequest()
    requested = int(payload.count or SESSION_SIZE)

    difficulty = (payload.difficulty or "medium").strip().lower()
    if difficulty not in VALID_DIFFICULTIES:
        difficulty = "medium"

    pair_key: str | None = None
    if payload.pair_key:
        cand = payload.pair_key.strip().lower()
        if cand not in VALID_PAIR_KEYS:
            raise HTTPException(status_code=422, detail="Invalid pair_key")
        pair_key = cand

    items: list[dict[str, Any]] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_confusable_pairs_prompt(
            count=requested, difficulty=difficulty, pair_key=pair_key
        )
        raw = await service.ask_json(system_prompt, user_message)
        items = coerce_session_payload(raw)
        if items is None:
            logger.info("confusable-pairs LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("confusable-pairs generation failed, using fallback: %s", exc)

    if not items:
        items = build_fallback_session(requested, pair_key=pair_key)

    if len(items) < requested:
        items = items + build_fallback_session(requested - len(items), pair_key=pair_key)
    items = items[:requested]

    # Re-id items with a stable session prefix for clarity.
    session_id = f"cp-{uuid.uuid4().hex[:12]}"
    for i, it in enumerate(items, start=1):
        it["id"] = f"{session_id}-{i:02d}"

    try:
        await dal.create_session(
            db,
            session_id=session_id,
            difficulty=difficulty,
            pair_filter=pair_key,
            items=items,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist confusable-pairs session")
        raise HTTPException(status_code=500, detail="Failed to create session")

    public_items = [
        ConfusablePairItem(
            id=it["id"],
            sentence_with_blank=it["sentence_with_blank"],
            options=list(it["options"]),
            pair_key=it["pair_key"],
            difficulty=it["difficulty"],
        )
        for it in items
    ]
    return StartSessionResponse(session_id=session_id, items=public_items)


@router.post("/answer", response_model=AnswerResponse)
async def post_answer(
    payload: AnswerRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> AnswerResponse:
    """Persist one attempt and return inline feedback."""
    session = await dal.get_session(db, payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    item = None
    for it in session["items"]:
        if str(it.get("id")) == payload.item_id:
            item = it
            break
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found in session")

    correct_word = str(item.get("correct_word") or "").strip()
    choice = payload.choice.strip()
    is_correct = choice.lower() == correct_word.lower()

    try:
        await dal.record_attempt(
            db,
            session_id=payload.session_id,
            item_id=payload.item_id,
            pair_key=str(item.get("pair_key") or "unknown"),
            choice=choice,
            correct_word=correct_word,
            is_correct=is_correct,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record confusable-pair attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")

    return AnswerResponse(
        correct=is_correct,
        correct_word=correct_word,
        explanation=str(item.get("explanation") or ""),
        example_sentence=str(item.get("example_sentence") or ""),
    )


@router.get("/summary/{session_id}", response_model=SummaryResponse)
async def get_summary(
    session_id: str,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SummaryResponse:
    """Return per-pair accuracy and weakest pair for a session."""
    session = await dal.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        summary = await dal.get_session_summary(db, session_id)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute confusable-pair summary")
        raise HTTPException(status_code=500, detail="Failed to compute summary")

    return SummaryResponse(
        total=int(summary["total"]),
        correct=int(summary["correct"]),
        per_pair_accuracy=summary["per_pair_accuracy"],
        weakest_pair=summary["weakest_pair"],
    )
