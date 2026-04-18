"""Listening practice API endpoints (minimal-pair drills, etc.)."""

from __future__ import annotations

import logging
import random
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.dal import minimal_pair as mp_dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/listening", tags=["listening"])


# ---------------------------------------------------------------------------
# Curated minimal-pair sets (server-side fallback / source of truth)
# ---------------------------------------------------------------------------
MINIMAL_PAIR_SETS: list[dict[str, Any]] = [
    {
        "contrast": "/i/-/iː/",
        "pairs": [
            {"word_a": "ship",  "word_b": "sheep", "ipa_a": "ʃɪp",  "ipa_b": "ʃiːp"},
            {"word_a": "bit",   "word_b": "beat",  "ipa_a": "bɪt",  "ipa_b": "biːt"},
            {"word_a": "fit",   "word_b": "feet",  "ipa_a": "fɪt",  "ipa_b": "fiːt"},
            {"word_a": "live",  "word_b": "leave", "ipa_a": "lɪv",  "ipa_b": "liːv"},
            {"word_a": "sit",   "word_b": "seat",  "ipa_a": "sɪt",  "ipa_b": "siːt"},
        ],
    },
    {
        "contrast": "/l/-/r/",
        "pairs": [
            {"word_a": "light",  "word_b": "right",  "ipa_a": "laɪt",  "ipa_b": "raɪt"},
            {"word_a": "lice",   "word_b": "rice",   "ipa_a": "laɪs",  "ipa_b": "raɪs"},
            {"word_a": "lock",   "word_b": "rock",   "ipa_a": "lɒk",   "ipa_b": "rɒk"},
            {"word_a": "long",   "word_b": "wrong",  "ipa_a": "lɔːŋ",  "ipa_b": "rɔːŋ"},
            {"word_a": "collect","word_b": "correct","ipa_a": "kəˈlɛkt","ipa_b": "kəˈrɛkt"},
        ],
    },
    {
        "contrast": "/v/-/b/",
        "pairs": [
            {"word_a": "very",  "word_b": "berry", "ipa_a": "ˈvɛri", "ipa_b": "ˈbɛri"},
            {"word_a": "vest",  "word_b": "best",  "ipa_a": "vɛst",  "ipa_b": "bɛst"},
            {"word_a": "vase",  "word_b": "base",  "ipa_a": "veɪs",  "ipa_b": "beɪs"},
            {"word_a": "vat",   "word_b": "bat",   "ipa_a": "væt",   "ipa_b": "bæt"},
            {"word_a": "vow",   "word_b": "bow",   "ipa_a": "vaʊ",   "ipa_b": "baʊ"},
        ],
    },
    {
        "contrast": "/θ/-/s/",
        "pairs": [
            {"word_a": "think", "word_b": "sink",  "ipa_a": "θɪŋk",  "ipa_b": "sɪŋk"},
            {"word_a": "thick", "word_b": "sick",  "ipa_a": "θɪk",   "ipa_b": "sɪk"},
            {"word_a": "thumb", "word_b": "sum",   "ipa_a": "θʌm",   "ipa_b": "sʌm"},
            {"word_a": "path",  "word_b": "pass",  "ipa_a": "pɑːθ",  "ipa_b": "pɑːs"},
            {"word_a": "thin",  "word_b": "sin",   "ipa_a": "θɪn",   "ipa_b": "sɪn"},
        ],
    },
    {
        "contrast": "/æ/-/ɛ/",
        "pairs": [
            {"word_a": "bad",  "word_b": "bed",  "ipa_a": "bæd",  "ipa_b": "bɛd"},
            {"word_a": "man",  "word_b": "men",  "ipa_a": "mæn",  "ipa_b": "mɛn"},
            {"word_a": "pan",  "word_b": "pen",  "ipa_a": "pæn",  "ipa_b": "pɛn"},
            {"word_a": "sad",  "word_b": "said", "ipa_a": "sæd",  "ipa_b": "sɛd"},
            {"word_a": "had",  "word_b": "head", "ipa_a": "hæd",  "ipa_b": "hɛd"},
        ],
    },
    {
        "contrast": "/ɔː/-/ɜː/",
        "pairs": [
            {"word_a": "walk",  "word_b": "work",  "ipa_a": "wɔːk",  "ipa_b": "wɜːk"},
            {"word_a": "ward",  "word_b": "word",  "ipa_a": "wɔːd",  "ipa_b": "wɜːd"},
            {"word_a": "born",  "word_b": "burn",  "ipa_a": "bɔːn",  "ipa_b": "bɜːn"},
        ],
    },
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class MinimalPairRound(BaseModel):
    word_a: str
    word_b: str
    ipa_a: str
    ipa_b: str
    contrast: str
    play: str  # 'a' or 'b' — server-decided word the client should speak via TTS


class MinimalPairStartResponse(BaseModel):
    contrast: str
    rounds: list[MinimalPairRound]


class ContrastResultItem(BaseModel):
    contrast: str
    correct: int = Field(ge=0)
    total: int = Field(ge=0)


class MinimalPairResultRequest(BaseModel):
    total: int = Field(ge=0, le=50)
    correct: int = Field(ge=0)
    contrast_summary: list[ContrastResultItem] = Field(default_factory=list)

    @field_validator("correct")
    @classmethod
    def _correct_le_total(cls, v: int, info) -> int:  # type: ignore[no-untyped-def]
        total = info.data.get("total")
        if total is not None and v > total:
            raise ValueError("correct cannot exceed total")
        return v


class MinimalPairResultResponse(BaseModel):
    id: int
    correct: int
    total: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/minimal-pair/start", response_model=MinimalPairStartResponse)
async def start_minimal_pair_session(rounds: int = 5) -> MinimalPairStartResponse:
    """Pick a random contrast set and return N rounds for the client to play.

    Each round randomly chooses which of the two words to speak via TTS so the
    listener has to discriminate.
    """
    n = max(1, min(rounds, 10))
    contrast_set = random.choice(MINIMAL_PAIR_SETS)
    pool = list(contrast_set["pairs"])
    if len(pool) < n:
        # Repeat as needed for small contrast sets
        while len(pool) < n:
            pool.append(random.choice(contrast_set["pairs"]))
    chosen = random.sample(pool, n) if len(pool) >= n else pool[:n]

    out: list[MinimalPairRound] = []
    for p in chosen:
        out.append(MinimalPairRound(
            word_a=p["word_a"],
            word_b=p["word_b"],
            ipa_a=p["ipa_a"],
            ipa_b=p["ipa_b"],
            contrast=contrast_set["contrast"],
            play=random.choice(["a", "b"]),
        ))
    return MinimalPairStartResponse(contrast=contrast_set["contrast"], rounds=out)


@router.post("/minimal-pair/result", response_model=MinimalPairResultResponse)
async def save_minimal_pair_result(
    payload: MinimalPairResultRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> MinimalPairResultResponse:
    """Persist a completed minimal-pair session result."""
    summary = {item.contrast: {"correct": item.correct, "total": item.total}
               for item in payload.contrast_summary}
    try:
        new_id = await mp_dal.save_session(db, payload.correct, payload.total, summary)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MinimalPairResultResponse(id=new_id, correct=payload.correct, total=payload.total)


@router.get("/minimal-pair/history")
async def get_minimal_pair_history(
    limit: int = 20,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> dict[str, Any]:
    sessions = await mp_dal.get_recent_sessions(db, limit=limit)
    return {"sessions": sessions}
