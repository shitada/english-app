"""Paraphrase Practice API.

Standalone CEFR-leveled rewrite drill:

    GET  /api/paraphrase/session?level=easy&count=5  → source sentences
    POST /api/paraphrase/score                        → LLM-graded scores
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import paraphrase as dal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/paraphrase", tags=["paraphrase"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ParaphraseSentence(BaseModel):
    text: str
    level: str


class ParaphraseSessionResponse(BaseModel):
    level: str
    items: list[ParaphraseSentence]


class ParaphraseScoreRequest(BaseModel):
    source: str = Field(..., min_length=1, max_length=600)
    attempt: str = Field(..., min_length=1, max_length=600)


class ParaphraseScoreResponse(BaseModel):
    meaning_score: int
    grammar_score: int
    naturalness_score: int
    overall: int
    kept_meaning: bool
    used_different_words: bool
    feedback: str
    suggested_paraphrase: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/session", response_model=ParaphraseSessionResponse)
async def get_session(
    level: str = Query(default="easy"),
    count: int = Query(default=5, ge=1, le=10),
) -> ParaphraseSessionResponse:
    """Return ``count`` source sentences at the requested CEFR level.

    Unknown levels fall back to ``easy`` (handled by ``normalize_level``).
    """
    normalized = dal.normalize_level(level)
    items = dal.get_random_sentences(normalized, count=count)
    return ParaphraseSessionResponse(
        level=normalized,
        items=[ParaphraseSentence(**it) for it in items],
    )


@router.post("/score", response_model=ParaphraseScoreResponse)
async def score(payload: ParaphraseScoreRequest) -> ParaphraseScoreResponse:
    """Grade a single paraphrase attempt with the LLM."""
    copilot = get_copilot_service()
    result = await dal.score_paraphrase(
        copilot,
        source=payload.source,
        attempt=payload.attempt,
    )
    return ParaphraseScoreResponse(**result)
