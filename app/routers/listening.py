"""Listening practice API endpoints (minimal-pair drills, etc.)."""

from __future__ import annotations

import logging
import random
import re
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.copilot_client import get_copilot_service
from app.dal import minimal_pair as mp_dal
from app.dal import numbers_drill as nd_dal
from app.database import get_db_session
from app.prompts import NUMBERS_DRILL_PROMPT

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


# ---------------------------------------------------------------------------
# Quick Numbers & Dates dictation drill
# ---------------------------------------------------------------------------

VALID_KINDS = {"price", "year", "phone", "time", "date", "quantity"}


def normalize_answer(text: str) -> str:
    """Normalize a number/date answer for tolerant comparison.

    Strips spaces, ``$``, commas, dashes, dots, slashes and colons,
    lowercases the result. The intent is to accept variants like
    ``$1,250``/``1250``/``1 250`` or ``3:30 PM``/``330pm`` as equivalent.
    """
    if text is None:
        return ""
    s = str(text).lower().strip()
    # Strip currency, separators, whitespace
    s = re.sub(r"[\s,\$\-\.\/:]", "", s)
    return s


def compare_answers(expected: str, accept_variants: list[str], user: str) -> bool:
    """Return True if user's normalized answer matches expected or any variant."""
    nu = normalize_answer(user)
    if not nu:
        return False
    candidates = [expected, *(accept_variants or [])]
    return any(normalize_answer(c) == nu for c in candidates if c is not None)


# Local fallback items used if the Copilot SDK is unavailable / errors.
_FALLBACK_NUMBERS_DRILL: list[dict[str, Any]] = [
    {
        "id": 1, "kind": "price",
        "spoken_text": "The total comes to twenty-four dollars and ninety-nine cents.",
        "expected_answer": "$24.99",
        "accept_variants": ["24.99", "24.99 dollars", "twenty-four dollars and ninety-nine cents"],
        "hint": "a price under $50",
    },
    {
        "id": 2, "kind": "year",
        "spoken_text": "The company was founded in nineteen ninety-eight.",
        "expected_answer": "1998",
        "accept_variants": ["nineteen ninety-eight"],
        "hint": "a year in the late 1990s",
    },
    {
        "id": 3, "kind": "phone",
        "spoken_text": "You can call me at five five five, one two three, four five six seven.",
        "expected_answer": "555-123-4567",
        "accept_variants": ["5551234567", "(555) 123-4567"],
        "hint": "a US-style phone number",
    },
    {
        "id": 4, "kind": "time",
        "spoken_text": "The meeting starts at three thirty PM.",
        "expected_answer": "3:30 PM",
        "accept_variants": ["3:30pm", "15:30", "330 pm"],
        "hint": "an afternoon time",
    },
    {
        "id": 5, "kind": "date",
        "spoken_text": "The event is on July fourth, twenty twenty-five.",
        "expected_answer": "July 4, 2025",
        "accept_variants": ["7/4/2025", "07/04/2025", "Jul 4 2025"],
        "hint": "a US Independence Day date",
    },
]


class NumbersDrillItem(BaseModel):
    id: int
    kind: str
    spoken_text: str
    expected_answer: str
    accept_variants: list[str] = Field(default_factory=list)
    hint: str = ""

    @field_validator("kind")
    @classmethod
    def _kind_allowed(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in VALID_KINDS:
            # Coerce unknowns to 'quantity' so the client never breaks
            return "quantity"
        return v


class NumbersDrillResponse(BaseModel):
    items: list[NumbersDrillItem]


class NumbersDrillSubmitItem(BaseModel):
    id: int
    kind: str
    expected_answer: str
    accept_variants: list[str] = Field(default_factory=list)
    user_answer: str = ""


class NumbersDrillSubmitRequest(BaseModel):
    items: list[NumbersDrillSubmitItem] = Field(min_length=1, max_length=20)


class NumbersDrillResultItem(BaseModel):
    id: int
    kind: str
    expected_answer: str
    user_answer: str
    is_correct: bool
    expected_normalized: str


class NumbersDrillSubmitResponse(BaseModel):
    results: list[NumbersDrillResultItem]
    correct: int
    total: int


def _coerce_drill_items(raw: Any) -> list[dict[str, Any]]:
    """Normalize whatever shape Copilot returns into a list of item dicts."""
    if isinstance(raw, dict):
        items = raw.get("items")
        if items is None and "drill" in raw:
            items = raw.get("drill")
    else:
        items = raw
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    for i, it in enumerate(items, start=1):
        if not isinstance(it, dict):
            continue
        out.append({
            "id": int(it.get("id") or i),
            "kind": str(it.get("kind") or "quantity"),
            "spoken_text": str(it.get("spoken_text") or "").strip(),
            "expected_answer": str(it.get("expected_answer") or "").strip(),
            "accept_variants": [str(v) for v in (it.get("accept_variants") or []) if v],
            "hint": str(it.get("hint") or "").strip(),
        })
    # Filter out clearly broken items
    return [it for it in out if it["spoken_text"] and it["expected_answer"]]


@router.post("/numbers-drill", response_model=NumbersDrillResponse)
async def generate_numbers_drill() -> NumbersDrillResponse:
    """Generate 5 listening dictation items focused on numbers/dates."""
    try:
        service = get_copilot_service()
        raw = await service.ask_json(
            NUMBERS_DRILL_PROMPT(),
            "Generate 5 numbers-and-dates dictation items now.",
        )
        items = _coerce_drill_items(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("numbers-drill generation failed, using fallback: %s", exc)
        items = []

    if len(items) < 5:
        # Top up from fallback so the client always gets a usable set
        needed = 5 - len(items)
        items.extend(random.sample(_FALLBACK_NUMBERS_DRILL, k=min(needed, len(_FALLBACK_NUMBERS_DRILL))))

    items = items[:5]
    # Re-id sequentially so client keys are stable
    for i, it in enumerate(items, start=1):
        it["id"] = i

    return NumbersDrillResponse(items=[NumbersDrillItem(**it) for it in items])


@router.post("/numbers-drill/submit", response_model=NumbersDrillSubmitResponse)
async def submit_numbers_drill(
    payload: NumbersDrillSubmitRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> NumbersDrillSubmitResponse:
    """Score user's answers and persist each attempt."""
    results: list[NumbersDrillResultItem] = []
    correct = 0
    for item in payload.items:
        is_correct = compare_answers(item.expected_answer, item.accept_variants, item.user_answer)
        if is_correct:
            correct += 1
        try:
            await nd_dal.record_attempt(
                db,
                kind=item.kind,
                expected=item.expected_answer,
                user_answer=item.user_answer or "",
                is_correct=is_correct,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed to record numbers-drill attempt")
            raise HTTPException(status_code=500, detail="Failed to record attempt")
        results.append(NumbersDrillResultItem(
            id=item.id,
            kind=item.kind,
            expected_answer=item.expected_answer,
            user_answer=item.user_answer or "",
            is_correct=is_correct,
            expected_normalized=normalize_answer(item.expected_answer),
        ))
    return NumbersDrillSubmitResponse(results=results, correct=correct, total=len(payload.items))
