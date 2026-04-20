"""Tense Contrast Drill API.

Writing drill contrasting three tenses:
    - past_simple
    - present_perfect
    - present_perfect_continuous

Flow:
    POST /api/tense-contrast/session → 8 items (Copilot + static fallback).
    POST /api/tense-contrast/submit  → persist attempts for one session.
    GET  /api/tense-contrast/stats   → per-tense accuracy over last 30 days.
"""

from __future__ import annotations

import logging
import random
import re
import uuid
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import tense_contrast as dal
from app.database import get_db_session
from app.prompts import build_tense_contrast_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tense-contrast", tags=["tense-contrast"])


VALID_TENSES = {"past_simple", "present_perfect", "present_perfect_continuous"}


# ---------------------------------------------------------------------------
# Static fallback bank (~20 items across the three tenses)
# ---------------------------------------------------------------------------
def _item(
    item_id: str,
    sentence_with_blank: str,
    verb_lemma: str,
    correct_form: list[str],
    tense_label: str,
    cue: str,
    explanation: str,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "sentence_with_blank": sentence_with_blank,
        "verb_lemma": verb_lemma,
        "correct_form": list(correct_form),
        "tense_label": tense_label,
        "cue": cue,
        "explanation": explanation,
    }


_FALLBACK_BANK: list[dict[str, Any]] = [
    # ----- past_simple -----
    _item("p01", "I ____ to Paris last summer.", "go",
          ["went"], "past_simple", "last summer",
          "'last summer' is a finished past time → past simple."),
    _item("p02", "She ____ the book yesterday.", "finish",
          ["finished"], "past_simple", "yesterday",
          "'yesterday' marks a completed past action → past simple."),
    _item("p03", "They ____ dinner at 8pm.", "eat",
          ["ate"], "past_simple", "at 8pm",
          "A specific finished time in the past → past simple."),
    _item("p04", "We ____ a great film last night.", "watch",
          ["watched"], "past_simple", "last night",
          "Completed action at a specific past time → past simple."),
    _item("p05", "He ____ his keys this morning.", "lose",
          ["lost"], "past_simple", "this morning",
          "'this morning' is finished (from this afternoon's viewpoint) → past simple."),
    _item("p06", "I ____ her in 2015.", "meet",
          ["met"], "past_simple", "in 2015",
          "A specific past year → past simple."),
    _item("p07", "The concert ____ at 9pm.", "start",
          ["started"], "past_simple", "at 9pm",
          "Specific completed past time → past simple."),
    # ----- present_perfect -----
    _item("pp01", "I ____ in Tokyo since 2018.", "live",
          ["have lived", "have been living", "'ve lived", "'ve been living"],
          "present_perfect", "since 2018",
          "A state continuing from past until now → present perfect (continuous also fine)."),
    _item("pp02", "She ____ her homework already.", "finish",
          ["has finished", "'s finished"], "present_perfect", "already",
          "'already' with a present result → present perfect."),
    _item("pp03", "They ____ that movie three times.", "see",
          ["have seen", "'ve seen"], "present_perfect", "three times",
          "Quantity of experiences up to now → present perfect."),
    _item("pp04", "I have never ____ sushi before.", "try",
          ["tried"], "present_perfect", "never ... before",
          "Life experience up to now → present perfect (past participle after 'have never')."),
    _item("pp05", "We have just ____ the report.", "send",
          ["sent"], "present_perfect", "just",
          "'just' focuses on a very recent completed action → present perfect."),
    _item("pp06", "He ____ to Canada twice.", "be",
          ["has been", "'s been"], "present_perfect", "twice",
          "Life experience counted up to now → present perfect."),
    _item("pp07", "I ____ my keys — I can't open the door.", "lose",
          ["have lost", "'ve lost"], "present_perfect", "present result",
          "Past action with a present result → present perfect."),
    # ----- present_perfect_continuous -----
    _item("ppc01", "I ____ English for two hours.", "study",
          ["have been studying", "'ve been studying"],
          "present_perfect_continuous", "for two hours",
          "Ongoing activity with duration continuing to now → present perfect continuous."),
    _item("ppc02", "It ____ since morning.", "rain",
          ["has been raining", "'s been raining"],
          "present_perfect_continuous", "since morning",
          "Activity still happening with 'since' → present perfect continuous."),
    _item("ppc03", "She ____ all day.", "work",
          ["has been working", "'s been working"],
          "present_perfect_continuous", "all day",
          "Activity across an extended period ongoing → present perfect continuous."),
    _item("ppc04", "They ____ for a new house for months.", "look",
          ["have been looking", "'ve been looking"],
          "present_perfect_continuous", "for months",
          "Ongoing search with duration → present perfect continuous."),
    _item("ppc05", "We ____ for the bus for 20 minutes.", "wait",
          ["have been waiting", "'ve been waiting"],
          "present_perfect_continuous", "for 20 minutes",
          "Duration of an ongoing action → present perfect continuous."),
    _item("ppc06", "He ____ tennis since he was ten.", "play",
          ["has been playing", "'s been playing", "has played", "'s played"],
          "present_perfect_continuous", "since he was ten",
          "Long-term habit continuing until now → present perfect continuous (perfect also OK)."),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TenseContrastItem(BaseModel):
    id: str
    sentence_with_blank: str
    verb_lemma: str
    correct_form: list[str]
    tense_label: str
    cue: str
    explanation: str


class TenseContrastSessionResponse(BaseModel):
    session_id: str
    items: list[TenseContrastItem]


class TenseContrastSessionRequest(BaseModel):
    count: int = Field(default=8, ge=1, le=20)


class TenseContrastAttemptInput(BaseModel):
    item_id: str = Field(..., max_length=64)
    user_answer: str = Field(..., max_length=200)
    correct: bool
    tense_label: str = Field(..., max_length=40)
    elapsed_ms: int = Field(default=0, ge=0, le=10 * 60 * 1000)


class TenseContrastSubmitRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=80)
    answers: list[TenseContrastAttemptInput] = Field(default_factory=list)


class TenseContrastSubmitResponse(BaseModel):
    inserted: int


class TenseContrastTenseStats(BaseModel):
    total: int
    correct: int
    accuracy: float


class TenseContrastStatsResponse(BaseModel):
    days: int
    total: int
    correct: int
    overall_accuracy: float
    by_tense: dict[str, TenseContrastTenseStats]


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable)
# ---------------------------------------------------------------------------

_TRAILING_PUNCT = re.compile(r"[.,!?;:]+$")


def normalize_answer(raw: str) -> str:
    """Lowercase, collapse whitespace, strip trailing punctuation."""
    if not raw:
        return ""
    s = str(raw).strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = _TRAILING_PUNCT.sub("", s).strip()
    return s


def is_answer_correct(user_answer: str, correct_forms: list[str]) -> bool:
    """Return True if user_answer matches any of correct_forms after normalize."""
    u = normalize_answer(user_answer)
    if not u:
        return False
    for f in correct_forms or []:
        if u == normalize_answer(f):
            return True
    return False


def _coerce_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    item_id = str(raw.get("id") or "").strip()
    sentence = str(raw.get("sentence_with_blank") or "").strip()
    verb_lemma = str(raw.get("verb_lemma") or "").strip()
    tense = str(raw.get("tense_label") or "").strip().lower()
    cue = str(raw.get("cue") or "").strip()
    explanation = str(raw.get("explanation") or "").strip()
    forms_raw = raw.get("correct_form")
    if not isinstance(forms_raw, list):
        return None
    forms = [str(f).strip() for f in forms_raw if str(f).strip()]
    if not sentence or not verb_lemma or not forms:
        return None
    if tense not in VALID_TENSES:
        return None
    if not item_id:
        item_id = f"llm-{uuid.uuid4().hex[:8]}"
    return {
        "id": item_id,
        "sentence_with_blank": sentence,
        "verb_lemma": verb_lemma,
        "correct_form": forms,
        "tense_label": tense,
        "cue": cue,
        "explanation": explanation or "Time marker signals the tense choice.",
    }


def coerce_session_payload(raw: Any) -> list[dict[str, Any]] | None:
    """Validate an LLM response. Returns list or None if malformed."""
    if not isinstance(raw, dict):
        return None
    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        return None
    items: list[dict[str, Any]] = []
    for it in items_raw:
        coerced = _coerce_item(it)
        if coerced is not None:
            items.append(coerced)
    if not items:
        return None
    return items


def build_fallback_session(
    count: int = 8, seed: int | None = None
) -> list[dict[str, Any]]:
    """Pick `count` items from the curated bank, roughly balanced across tenses."""
    rng = random.Random(seed)
    by_tense: dict[str, list[dict[str, Any]]] = {t: [] for t in VALID_TENSES}
    for it in _FALLBACK_BANK:
        by_tense.setdefault(it["tense_label"], []).append(dict(it))
    for bucket in by_tense.values():
        rng.shuffle(bucket)

    tenses = list(by_tense.keys())
    rng.shuffle(tenses)
    out: list[dict[str, Any]] = []
    idx = 0
    guard = 0
    while len(out) < count and guard < count * 10:
        tense = tenses[idx % len(tenses)]
        if by_tense[tense]:
            out.append(dict(by_tense[tense].pop()))
        elif all(not b for b in by_tense.values()):
            for it in _FALLBACK_BANK:
                by_tense[it["tense_label"]].append(dict(it))
            for bucket in by_tense.values():
                rng.shuffle(bucket)
        idx += 1
        guard += 1
    return out[:count]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/session", response_model=TenseContrastSessionResponse)
async def create_session(
    payload: TenseContrastSessionRequest | None = None,
    count: int = Query(default=8, ge=1, le=20),
) -> TenseContrastSessionResponse:
    """Return a fresh session with `count` tense-contrast items."""
    requested = payload.count if payload is not None else count
    items: list[dict[str, Any]] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_tense_contrast_prompt(requested)
        raw = await service.ask_json(system_prompt, user_message)
        items = coerce_session_payload(raw)
        if items is None:
            logger.info("tense-contrast LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("tense-contrast generation failed, using fallback: %s", exc)

    if not items:
        items = build_fallback_session(requested)

    if len(items) < requested:
        items = items + build_fallback_session(requested - len(items))
    items = items[:requested]

    session_id = f"tc-{uuid.uuid4().hex[:12]}"
    return TenseContrastSessionResponse(
        session_id=session_id,
        items=[TenseContrastItem(**it) for it in items],
    )


@router.post("/submit", response_model=TenseContrastSubmitResponse)
async def submit_attempts(
    payload: TenseContrastSubmitRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> TenseContrastSubmitResponse:
    """Persist per-item attempts for one session."""
    attempts = []
    for a in payload.answers:
        tense = a.tense_label if a.tense_label in VALID_TENSES else ""
        attempts.append(
            {
                "item_id": a.item_id,
                "tense_label": tense,
                "user_answer": a.user_answer,
                "correct": bool(a.correct),
                "elapsed_ms": int(a.elapsed_ms),
            }
        )
    try:
        inserted = await dal.create_attempts(
            db, session_id=payload.session_id, attempts=attempts
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist tense-contrast attempts")
        raise HTTPException(status_code=500, detail="Failed to save attempts")
    return TenseContrastSubmitResponse(inserted=inserted)


@router.get("/stats", response_model=TenseContrastStatsResponse)
async def get_stats(
    days: int = Query(default=30, ge=1, le=365),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> TenseContrastStatsResponse:
    """Per-tense accuracy over the last `days` days."""
    try:
        stats = await dal.get_stats(db, days=days)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute tense-contrast stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")

    by_tense = {
        tense: TenseContrastTenseStats(**info)
        for tense, info in stats["by_tense"].items()
    }
    return TenseContrastStatsResponse(
        days=stats["days"],
        total=stats["total"],
        correct=stats["correct"],
        overall_accuracy=stats["overall_accuracy"],
        by_tense=by_tense,
    )
