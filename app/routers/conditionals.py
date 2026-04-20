"""Conditional Transform Drill API (Type 0/1/2/3 if-sentence rewrites).

Flow:
    GET  /api/conditionals/prompt?type=0|1|2|3&level=beginner|intermediate|advanced
         → {prompt_id, base_sentence, target_type, hint}
    POST /api/conditionals/grade {prompt_id, user_answer}
         → {correct, score, model_answer, feedback, detected_type, issues[]}
    GET  /api/conditionals/history?limit=20
         → {items: [...]}  (scoped by X-User-Id header)
"""

from __future__ import annotations

import logging
import random
import re
import uuid
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import conditionals as dal
from app.database import get_db_session
from app.prompts import (
    build_conditional_grade_request,
    build_conditional_prompt_request,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conditionals", tags=["conditionals"])


VALID_TYPES = {0, 1, 2, 3}
VALID_LEVELS = {"beginner", "intermediate", "advanced"}


# ---------------------------------------------------------------------------
# Static fallback bank — base sentences per (type, level). Used when the LLM
# is unavailable so the drill still works offline.
# ---------------------------------------------------------------------------

_FALLBACK_BANK: dict[tuple[int, str], list[dict[str, str]]] = {
    (0, "beginner"): [
        {"base_sentence": "Water boils when you heat it to 100 degrees.",
         "hint": "Rewrite as a general truth with Type-0 (present, present)."},
        {"base_sentence": "Ice melts when the temperature rises.",
         "hint": "Use Type-0: if + present simple, present simple."},
        {"base_sentence": "Plants grow when they get enough sunlight.",
         "hint": "State it as a Type-0 general truth."},
    ],
    (0, "intermediate"): [
        {"base_sentence": "The alarm rings whenever the door opens at night.",
         "hint": "Rewrite as a Type-0 conditional (general rule)."},
        {"base_sentence": "Metal expands when it gets hot.",
         "hint": "Rewrite as Type-0: if + present, present."},
    ],
    (0, "advanced"): [
        {"base_sentence": "Markets tend to correct when investor sentiment shifts sharply.",
         "hint": "State as a Type-0 general truth about markets."},
    ],
    (1, "beginner"): [
        {"base_sentence": "Maybe it will rain, so I might stay home.",
         "hint": "Rewrite as Type-1: if + present, will + base."},
        {"base_sentence": "Perhaps he will call, and I will answer.",
         "hint": "Rewrite as a Type-1 real future conditional."},
        {"base_sentence": "If I have time later, I might help you.",
         "hint": "Make it a clean Type-1: if + present, will + base."},
    ],
    (1, "intermediate"): [
        {"base_sentence": "It might snow tomorrow, so the flight could be cancelled.",
         "hint": "Rewrite as Type-1 (real future)."},
        {"base_sentence": "Possibly the meeting runs long, and I will miss the bus.",
         "hint": "Use Type-1: if + present simple, will + base."},
    ],
    (1, "advanced"): [
        {"base_sentence": "Should the proposal receive backing, the team will launch next quarter.",
         "hint": "Rewrite as a standard Type-1 conditional."},
    ],
    (2, "beginner"): [
        {"base_sentence": "I don't have a car, so I don't drive to work.",
         "hint": "Rewrite as Type-2 (unreal present): if + past, would + base."},
        {"base_sentence": "She isn't rich, so she doesn't travel.",
         "hint": "Use Type-2 to imagine the opposite."},
        {"base_sentence": "We don't know his number, so we can't call him.",
         "hint": "Express the unreal present with Type-2."},
    ],
    (2, "intermediate"): [
        {"base_sentence": "I don't speak French, so I can't read this letter.",
         "hint": "Rewrite as Type-2: if + past simple, would + base."},
        {"base_sentence": "He doesn't exercise, so he doesn't feel energetic.",
         "hint": "Imagine the opposite with Type-2."},
    ],
    (2, "advanced"): [
        {"base_sentence": "The company isn't agile enough to respond to the disruption.",
         "hint": "Rewrite the unreal present as a Type-2 conditional."},
    ],
    (3, "beginner"): [
        {"base_sentence": "I didn't study, so I didn't pass the test.",
         "hint": "Rewrite as Type-3: if + past perfect, would have + pp."},
        {"base_sentence": "She didn't leave early, so she missed the train.",
         "hint": "Use Type-3 to imagine the unreal past."},
        {"base_sentence": "We didn't book tickets, so we didn't see the concert.",
         "hint": "Express the unreal past with Type-3."},
    ],
    (3, "intermediate"): [
        {"base_sentence": "He didn't bring an umbrella, so he got soaked.",
         "hint": "Rewrite as Type-3 (unreal past)."},
        {"base_sentence": "They didn't listen to the warning, so they had an accident.",
         "hint": "Use Type-3: if + past perfect, would have + past participle."},
    ],
    (3, "advanced"): [
        {"base_sentence": "The committee didn't heed the analyst's warning, and the project overran its budget.",
         "hint": "Rewrite the unreal past scenario as a Type-3 conditional."},
    ],
}


def _pick_fallback(target_type: int, level: str) -> dict[str, str]:
    """Return a fallback {base_sentence, hint} for (target_type, level)."""
    key = (int(target_type), str(level))
    bank = _FALLBACK_BANK.get(key) or _FALLBACK_BANK.get(
        (int(target_type), "intermediate")
    ) or []
    if not bank:
        # Ultra-last-resort
        return {
            "base_sentence": "If it is useful, we practice it.",
            "hint": "Rewrite as the requested conditional type.",
        }
    return dict(random.choice(bank))


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable)
# ---------------------------------------------------------------------------

_IF_CLAUSE_RE = re.compile(r"\bif\b", re.IGNORECASE)
_WOULD_HAVE_RE = re.compile(r"\bwould\s+have\b", re.IGNORECASE)
_WOULD_RE = re.compile(r"\bwould\b", re.IGNORECASE)
_WILL_RE = re.compile(r"\bwill\b", re.IGNORECASE)
_HAD_RE = re.compile(r"\bhad\b", re.IGNORECASE)


def heuristic_detect_type(text: str) -> int | None:
    """Rough heuristic to classify an attempt as conditional type 0/1/2/3.

    Used only as a fallback when the LLM is unavailable; exact matching is
    not required — the LLM grader is authoritative.
    """
    if not text:
        return None
    s = str(text).strip()
    if not _IF_CLAUSE_RE.search(s):
        return None
    if _WOULD_HAVE_RE.search(s):
        return 3
    if _WOULD_RE.search(s):
        return 2
    if _WILL_RE.search(s):
        return 1
    return 0


def _coerce_prompt_payload(raw: Any) -> dict[str, str] | None:
    """Validate an LLM prompt-generation response. Returns None on malformed."""
    if not isinstance(raw, dict):
        return None
    base = str(raw.get("base_sentence") or "").strip()
    hint = str(raw.get("hint") or "").strip()
    if not base:
        return None
    return {"base_sentence": base[:400], "hint": hint[:400]}


def _coerce_grade_payload(raw: Any) -> dict[str, Any] | None:
    """Coerce an LLM grade response into a safe dict, or return None."""
    if not isinstance(raw, dict):
        return None
    try:
        correct = bool(raw.get("correct"))
        score = int(raw.get("score") or 0)
        score = max(0, min(100, score))
        model_answer = str(raw.get("model_answer") or "").strip()[:400]
        feedback = str(raw.get("feedback") or "").strip()[:400]
        dt_raw = raw.get("detected_type")
        detected_type: int | None
        if isinstance(dt_raw, int) and dt_raw in VALID_TYPES:
            detected_type = dt_raw
        elif isinstance(dt_raw, str) and dt_raw.strip().isdigit() and int(dt_raw) in VALID_TYPES:
            detected_type = int(dt_raw)
        else:
            detected_type = None
        issues_raw = raw.get("issues")
        issues: list[str] = []
        if isinstance(issues_raw, list):
            for x in issues_raw:
                s = str(x or "").strip()
                if s:
                    issues.append(s[:120])
        return {
            "correct": correct,
            "score": score,
            "model_answer": model_answer,
            "feedback": feedback or (
                "Good attempt." if correct else "Review the model answer."
            ),
            "detected_type": detected_type,
            "issues": issues,
        }
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConditionalPromptResponse(BaseModel):
    prompt_id: str
    base_sentence: str
    target_type: int
    level: str
    hint: str = ""


class ConditionalGradeRequest(BaseModel):
    prompt_id: str = Field(..., min_length=1, max_length=64)
    user_answer: str = Field(..., min_length=1, max_length=600)


class ConditionalGradeResponse(BaseModel):
    correct: bool
    score: int
    model_answer: str
    feedback: str
    detected_type: int | None = None
    issues: list[str] = Field(default_factory=list)


class ConditionalHistoryItem(BaseModel):
    id: int
    prompt_id: str
    target_type: int
    detected_type: int | None = None
    base_sentence: str
    user_answer: str
    model_answer: str
    feedback: str
    issues: list[str] = Field(default_factory=list)
    correct: bool
    score: int
    created_at: Any


class ConditionalHistoryResponse(BaseModel):
    items: list[ConditionalHistoryItem]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/prompt", response_model=ConditionalPromptResponse)
async def get_prompt(
    type: int = Query(..., ge=0, le=3, description="Target conditional type (0/1/2/3)"),
    level: str = Query("intermediate", description="beginner|intermediate|advanced"),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ConditionalPromptResponse:
    """Return a fresh conditional-transform prompt."""
    if type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail="type must be 0, 1, 2, or 3")
    lvl = str(level or "").strip().lower()
    if lvl not in VALID_LEVELS:
        raise HTTPException(
            status_code=422,
            detail="level must be beginner|intermediate|advanced",
        )

    payload: dict[str, str] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_conditional_prompt_request(type, lvl)
        raw = await service.ask_json(system_prompt, user_message)
        payload = _coerce_prompt_payload(raw)
        if payload is None:
            logger.info("conditionals LLM payload invalid; using fallback")
    except Exception as exc:  # noqa: BLE001
        logger.warning("conditionals prompt generation failed, fallback: %s", exc)

    if payload is None:
        payload = _pick_fallback(type, lvl)

    prompt_id = f"cond-{uuid.uuid4().hex[:12]}"
    try:
        await dal.save_prompt(
            db,
            prompt_id=prompt_id,
            target_type=type,
            level=lvl,
            base_sentence=payload["base_sentence"],
            hint=payload.get("hint", ""),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist conditional prompt")
        raise HTTPException(status_code=500, detail="Failed to save prompt")

    return ConditionalPromptResponse(
        prompt_id=prompt_id,
        base_sentence=payload["base_sentence"],
        target_type=type,
        level=lvl,
        hint=payload.get("hint", ""),
    )


@router.post("/grade", response_model=ConditionalGradeResponse)
async def grade_attempt(
    payload: ConditionalGradeRequest,
    x_user_id: str = Header(default="local", alias="X-User-Id"),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ConditionalGradeResponse:
    """Grade a conditional-transform attempt via the LLM; persist the result."""
    stored = await dal.get_prompt(db, payload.prompt_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="prompt_id not found")
    target_type = int(stored["target_type"])
    base_sentence = str(stored["base_sentence"])

    grade: dict[str, Any] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_conditional_grade_request(
            target_type=target_type,
            base_sentence=base_sentence,
            user_answer=payload.user_answer,
        )
        raw = await service.ask_json(system_prompt, user_message)
        grade = _coerce_grade_payload(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("conditionals LLM grade failed: %s", exc)

    if grade is None:
        # Fallback: heuristic type detection + neutral feedback.
        detected = heuristic_detect_type(payload.user_answer)
        correct = detected == target_type
        score = 70 if correct else 30
        grade = {
            "correct": correct,
            "score": score,
            "model_answer": "",
            "feedback": (
                "Looks like the right conditional type."
                if correct
                else "The structure does not match the requested type."
            ),
            "detected_type": detected,
            "issues": [] if correct else ["structure mismatch"],
        }

    user_id = (x_user_id or "local").strip() or "local"
    try:
        await dal.save_attempt(
            db,
            user_id=user_id,
            prompt_id=payload.prompt_id,
            target_type=target_type,
            detected_type=grade["detected_type"],
            base_sentence=base_sentence,
            user_answer=payload.user_answer,
            model_answer=grade["model_answer"],
            feedback=grade["feedback"],
            issues=grade["issues"],
            correct=bool(grade["correct"]),
            score=int(grade["score"]),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist conditional attempt")
        raise HTTPException(status_code=500, detail="Failed to save attempt")

    return ConditionalGradeResponse(
        correct=bool(grade["correct"]),
        score=int(grade["score"]),
        model_answer=str(grade["model_answer"] or ""),
        feedback=str(grade["feedback"] or ""),
        detected_type=grade["detected_type"],
        issues=list(grade["issues"] or []),
    )


@router.get("/history", response_model=ConditionalHistoryResponse)
async def get_history(
    limit: int = Query(default=20, ge=1, le=200),
    x_user_id: str = Header(default="local", alias="X-User-Id"),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ConditionalHistoryResponse:
    """Return recent attempts for the requesting user."""
    user_id = (x_user_id or "local").strip() or "local"
    try:
        rows = await dal.recent_attempts(db, user_id=user_id, limit=limit)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to load conditional history")
        raise HTTPException(status_code=500, detail="Failed to load history")
    return ConditionalHistoryResponse(
        items=[ConditionalHistoryItem(**r) for r in rows]
    )
