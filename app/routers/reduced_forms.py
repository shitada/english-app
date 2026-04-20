"""Reduced Forms drill API.

Each round delivers 5 short utterances using natural connected-speech
reductions (gonna, wanna, gotta, hafta, lemme, dunno, coulda/shoulda/woulda,
t-flapping, schwa reductions). The flow is Listen -> Expand -> Shadow.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dal import reduced_forms as rf_dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reduced-forms", tags=["reduced-forms"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ReducedFormItem(BaseModel):
    id: str
    reduction_type: str
    reduced_text: str
    full_text: str
    focus_chunks: list[str]


class ReducedFormRoundResponse(BaseModel):
    items: list[ReducedFormItem]


class ReducedFormAttemptRequest(BaseModel):
    item_id: str = Field(min_length=1, max_length=100)
    reduction_type: str = Field(min_length=1, max_length=80)
    reduced_text: str = Field(min_length=1, max_length=400)
    full_text: str = Field(min_length=1, max_length=400)
    user_expand: str = Field(default="", max_length=400)
    shadow_accuracy: float = Field(default=0.0, ge=0.0, le=100.0)


class ReducedFormAttemptResponse(BaseModel):
    id: int
    expand_correct: bool
    shadow_accuracy: float
    weakness: dict[str, float]


# ---------------------------------------------------------------------------
# Expand grader — case/punct/whitespace insensitive, contraction-aware.
# ---------------------------------------------------------------------------

# Map common contractions to their expanded form (used both ways).
_CONTRACTIONS: dict[str, str] = {
    "i'm": "i am",
    "you're": "you are",
    "we're": "we are",
    "they're": "they are",
    "he's": "he is",
    "she's": "she is",
    "it's": "it is",
    "that's": "that is",
    "what's": "what is",
    "there's": "there is",
    "let's": "let us",
    "i've": "i have",
    "you've": "you have",
    "we've": "we have",
    "they've": "they have",
    "i'd": "i would",
    "you'd": "you would",
    "he'd": "he would",
    "she'd": "she would",
    "we'd": "we would",
    "they'd": "they would",
    "i'll": "i will",
    "you'll": "you will",
    "he'll": "he will",
    "she'll": "she will",
    "we'll": "we will",
    "they'll": "they will",
    "don't": "do not",
    "doesn't": "does not",
    "didn't": "did not",
    "won't": "will not",
    "wouldn't": "would not",
    "shouldn't": "should not",
    "couldn't": "could not",
    "can't": "cannot",
    "isn't": "is not",
    "aren't": "are not",
    "wasn't": "was not",
    "weren't": "were not",
    "hasn't": "has not",
    "haven't": "have not",
    "hadn't": "had not",
    "would've": "would have",
    "could've": "could have",
    "should've": "should have",
    "might've": "might have",
    "must've": "must have",
    "i'd've": "i would have",
}

_PUNCT_RE = re.compile(r"[^\w\s']")
_WS_RE = re.compile(r"\s+")
_TOKEN_RE = re.compile(r"[a-z']+")


def _expand_contractions(text: str) -> str:
    tokens = _TOKEN_RE.findall(text.lower())
    out: list[str] = []
    for tok in tokens:
        out.append(_CONTRACTIONS.get(tok, tok))
    # Normalise "cannot" -> "can not" so both forms collapse identically.
    joined = " ".join(out).replace("cannot", "can not")
    return joined


def normalize_for_grading(text: str) -> str:
    """Normalize for the Expand grader.

    - lowercase
    - strip punctuation (keep apostrophes for contractions, then expand them)
    - expand common contractions ("I'm" == "I am")
    - collapse whitespace
    """
    if not text:
        return ""
    lower = text.lower()
    # Replace punctuation (except apostrophes) with space.
    cleaned = _PUNCT_RE.sub(" ", lower)
    expanded = _expand_contractions(cleaned)
    return _WS_RE.sub(" ", expanded).strip()


def grade_expand(expected_full: str, user_input: str) -> bool:
    return normalize_for_grading(expected_full) == normalize_for_grading(user_input)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/round", response_model=ReducedFormRoundResponse)
async def get_round(
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ReducedFormRoundResponse:
    """Return 5 reduced-form items, weakest reduction-type first."""
    try:
        weakness = await rf_dal.get_weakness_stats(db)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to read reduced-forms weakness stats")
        weakness = {}

    items = rf_dal.sample_round(weakness=weakness, n=5)
    return ReducedFormRoundResponse(
        items=[ReducedFormItem(**_to_item(it)) for it in items],
    )


def _to_item(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw["id"],
        "reduction_type": raw["reduction_type"],
        "reduced_text": raw["reduced_text"],
        "full_text": raw["full_text"],
        "focus_chunks": list(raw.get("focus_chunks") or []),
    }


@router.post("/attempt", response_model=ReducedFormAttemptResponse)
async def submit_attempt(
    payload: ReducedFormAttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ReducedFormAttemptResponse:
    """Persist an attempt and return updated weakness stats."""
    expand_correct = grade_expand(payload.full_text, payload.user_expand)
    try:
        new_id = await rf_dal.record_attempt(
            db,
            item_id=payload.item_id,
            reduction_type=payload.reduction_type,
            reduced_text=payload.reduced_text,
            full_text=payload.full_text,
            user_expand=payload.user_expand or "",
            expand_correct=expand_correct,
            shadow_accuracy=payload.shadow_accuracy,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record reduced-forms attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")

    try:
        weakness = await rf_dal.get_weakness_stats(db)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to read reduced-forms weakness stats")
        weakness = {}

    return ReducedFormAttemptResponse(
        id=new_id,
        expand_correct=expand_correct,
        shadow_accuracy=payload.shadow_accuracy,
        weakness=weakness,
    )
