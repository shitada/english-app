"""WH-Question Formation speaking drill (Jeopardy-style).

Flow:
    POST /api/wh-questions/start → 5 items (Copilot + static fallback).
    POST /api/wh-questions/grade → grade one spoken attempt via Copilot,
        persist the result, return feedback.
    GET  /api/wh-questions/stats → recent accuracy by wh-word.

The user is given a SHORT ANSWER STATEMENT (TTS + text) and must SPEAK the
WH-question that elicits it, e.g.::

    answer:  "She left at 7 a.m. because she had a meeting."
    → "Why did she leave at 7 a.m.?"
"""

from __future__ import annotations

import logging
import random
import uuid
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import wh_questions as dal
from app.database import get_db_session
from app.prompts import build_wh_question_grade_prompt, build_wh_question_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wh-questions", tags=["wh-questions"])


VALID_WH = {"who", "what", "when", "where", "why", "how"}
DEFAULT_USER_ID = "local"


# ---------------------------------------------------------------------------
# Static fallback bank
# ---------------------------------------------------------------------------
def _seed(
    item_id: str, answer_sentence: str, target_wh: str, hint: str
) -> dict[str, Any]:
    return {
        "id": item_id,
        "answer_sentence": answer_sentence,
        "target_wh": target_wh,
        "hint": hint,
    }


_FALLBACK_BANK: list[dict[str, Any]] = [
    _seed("wh-who-1", "My sister wrote that email.", "who", "Ask about the agent."),
    _seed("wh-who-2", "The manager called the meeting.", "who", "Ask who performed the action."),
    _seed("wh-what-1", "She ordered a cappuccino and a croissant.", "what",
          "Ask about the object."),
    _seed("wh-what-2", "They watched a documentary last night.", "what",
          "Ask about what they watched."),
    _seed("wh-when-1", "The train leaves at 6:45.", "when", "Ask about the time."),
    _seed("wh-when-2", "He finished the project on Friday.", "when",
          "Ask about the day."),
    _seed("wh-where-1", "She put the keys in the top drawer.", "where",
          "Ask about the location."),
    _seed("wh-where-2", "We met at the coffee shop on Fifth Avenue.", "where",
          "Ask about the place."),
    _seed("wh-why-1", "She left at 7 a.m. because she had a meeting.", "why",
          "Ask about the reason."),
    _seed("wh-why-2", "He's quitting the job because the commute is too long.", "why",
          "Ask why."),
    _seed("wh-how-1", "She fixed the bike with a wrench and patience.", "how",
          "Ask about the method."),
    _seed("wh-how-2", "They got to the airport by taxi.", "how",
          "Ask about the means of transport."),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class WhQuestionItem(BaseModel):
    id: str
    answer_sentence: str
    target_wh: str
    hint: str = ""


class WhQuestionStartRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=10)


class WhQuestionStartResponse(BaseModel):
    items: list[WhQuestionItem]


class WhQuestionGradeRequest(BaseModel):
    item_id: str = Field(..., min_length=1, max_length=64)
    answer_sentence: str = Field(..., min_length=1, max_length=400)
    target_wh: str = Field(..., min_length=1, max_length=16)
    user_question: str = Field(..., min_length=1, max_length=400)


class WhQuestionGradeResponse(BaseModel):
    correctness: bool
    wh_word_matches: bool
    grammar_ok: bool
    feedback: str
    corrected: str


class WhQuestionWhStats(BaseModel):
    total: int
    correct: int
    accuracy: float


class WhQuestionStatsResponse(BaseModel):
    total: int
    correct: int
    grammar_ok: int
    overall_accuracy: float
    by_wh: dict[str, WhQuestionWhStats]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    item_id = str(raw.get("id") or "").strip()
    answer = str(raw.get("answer_sentence") or "").strip()
    wh = str(raw.get("target_wh") or "").strip().lower()
    hint = str(raw.get("hint") or "").strip()
    if not answer or wh not in VALID_WH:
        return None
    if not item_id:
        item_id = f"llm-{uuid.uuid4().hex[:8]}"
    return {
        "id": item_id,
        "answer_sentence": answer,
        "target_wh": wh,
        "hint": hint,
    }


def coerce_start_payload(raw: Any) -> list[dict[str, Any]] | None:
    """Validate an LLM /start response. Returns list of items or None."""
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


def build_fallback_batch(count: int = 5, seed: int | None = None) -> list[dict[str, Any]]:
    """Return `count` items from the fallback bank, roughly spread across wh-words."""
    rng = random.Random(seed)
    by_wh: dict[str, list[dict[str, Any]]] = {w: [] for w in VALID_WH}
    for it in _FALLBACK_BANK:
        by_wh.setdefault(it["target_wh"], []).append(dict(it))
    for bucket in by_wh.values():
        rng.shuffle(bucket)

    wh_order = list(VALID_WH)
    rng.shuffle(wh_order)

    out: list[dict[str, Any]] = []
    idx = 0
    guard = 0
    while len(out) < count and guard < count * 20:
        wh = wh_order[idx % len(wh_order)]
        if by_wh[wh]:
            out.append(dict(by_wh[wh].pop()))
        elif all(not b for b in by_wh.values()):
            for it in _FALLBACK_BANK:
                by_wh[it["target_wh"]].append(dict(it))
            for bucket in by_wh.values():
                rng.shuffle(bucket)
        idx += 1
        guard += 1
    return out[:count]


def coerce_grade_payload(raw: Any) -> dict[str, Any] | None:
    """Validate an LLM /grade response. Returns a sanitised dict or None."""
    if not isinstance(raw, dict):
        return None
    correctness = raw.get("correctness")
    wh_match = raw.get("wh_word_matches")
    grammar_ok = raw.get("grammar_ok")
    feedback = str(raw.get("feedback") or "").strip()
    corrected = str(raw.get("corrected") or "").strip()
    if correctness is None or wh_match is None or grammar_ok is None:
        return None
    return {
        "correctness": bool(correctness),
        "wh_word_matches": bool(wh_match),
        "grammar_ok": bool(grammar_ok),
        "feedback": feedback or ("Nice work." if correctness else "Check the word order."),
        "corrected": corrected,
    }


def heuristic_grade(
    answer_sentence: str, target_wh: str, user_question: str
) -> dict[str, Any]:
    """Simple offline grading used when the LLM grader is unavailable."""
    wh = (target_wh or "").strip().lower()
    uq = (user_question or "").strip()
    uq_lower = uq.lower()

    wh_match = bool(wh) and uq_lower.startswith(wh)
    has_qmark = uq.endswith("?")
    tokens = uq_lower.split()
    has_aux = any(
        t in tokens
        for t in (
            "do", "does", "did", "is", "are", "was", "were", "am",
            "has", "have", "had", "can", "could", "will", "would",
            "should", "may", "might", "must",
        )
    )
    grammar_ok = wh_match and has_aux and len(tokens) >= 3
    correctness = wh_match and grammar_ok
    if correctness:
        feedback = "Looks like a well-formed question."
    elif not wh_match:
        feedback = f"Start the question with '{wh}'."
    elif not has_aux:
        feedback = "Include an auxiliary verb (do/did/does, is/are, etc.)."
    else:
        feedback = "Check word order and punctuation."
    corrected = uq if correctness else f"{wh.capitalize()} ...?"
    if not has_qmark and correctness:
        corrected = f"{uq}?"
    return {
        "correctness": correctness,
        "wh_word_matches": wh_match,
        "grammar_ok": grammar_ok,
        "feedback": feedback,
        "corrected": corrected,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/start", response_model=WhQuestionStartResponse)
async def start_drill(
    payload: WhQuestionStartRequest | None = None,
    count: int = Query(default=5, ge=1, le=10),
) -> WhQuestionStartResponse:
    """Return a fresh batch of WH-question items."""
    requested = payload.count if payload is not None else count

    items: list[dict[str, Any]] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_wh_question_prompt(requested)
        raw = await service.ask_json(system_prompt, user_message)
        items = coerce_start_payload(raw)
        if items is None:
            logger.info("wh-questions LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("wh-questions generation failed, using fallback: %s", exc)

    if not items:
        items = build_fallback_batch(requested)
    if len(items) < requested:
        items = items + build_fallback_batch(requested - len(items))
    items = items[:requested]

    return WhQuestionStartResponse(
        items=[WhQuestionItem(**it) for it in items],
    )


@router.post("/grade", response_model=WhQuestionGradeResponse)
async def grade_attempt(
    payload: WhQuestionGradeRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> WhQuestionGradeResponse:
    """Grade one spoken attempt via Copilot, persist the result."""
    target_wh = payload.target_wh.strip().lower()
    if target_wh not in VALID_WH:
        raise HTTPException(status_code=400, detail="Invalid target_wh")

    result: dict[str, Any] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_wh_question_grade_prompt(
            payload.answer_sentence, target_wh, payload.user_question
        )
        raw = await service.ask_json(system_prompt, user_message)
        result = coerce_grade_payload(raw)
        if result is None:
            logger.info("wh-questions grade payload invalid; using heuristic")
    except Exception as exc:  # noqa: BLE001
        logger.warning("wh-questions grading failed, using heuristic: %s", exc)

    if result is None:
        result = heuristic_grade(
            payload.answer_sentence, target_wh, payload.user_question
        )

    try:
        await dal.record_attempt(
            db,
            user_id=DEFAULT_USER_ID,
            target_wh=target_wh,
            is_correct=bool(result["correctness"]),
            grammar_ok=bool(result["grammar_ok"]),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist wh-question attempt")
        # Don't fail the whole grade response because of a DB write problem.

    return WhQuestionGradeResponse(**result)


@router.get("/stats", response_model=WhQuestionStatsResponse)
async def get_stats(
    limit: int = Query(default=30, ge=1, le=500),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> WhQuestionStatsResponse:
    """Per-wh-word accuracy over the latest `limit` attempts."""
    try:
        stats = await dal.get_recent_stats(db, user_id=DEFAULT_USER_ID, limit=limit)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute wh-question stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")

    by_wh = {
        wh: WhQuestionWhStats(**info) for wh, info in stats["by_wh"].items()
    }
    return WhQuestionStatsResponse(
        total=stats["total"],
        correct=stats["correct"],
        grammar_ok=stats["grammar_ok"],
        overall_accuracy=stats["overall_accuracy"],
        by_wh=by_wh,
    )
