"""Number & Date Dictation API.

A focused listening micro-drill that helps users decode commonly-misheard
spoken numerics: large numbers (fifteen vs fifty), prices ($3.49), years
(2019), dates (March 3rd), times (7:45), and phone numbers.

Items are deterministically generated in Python — no LLM call. The frontend
is responsible for actually speaking the `spoken_form` via the browser's
SpeechSynthesis API; the backend only ships the text to read.

Endpoints:
    POST /api/number-dictation/start     — start a session, return N items
    POST /api/number-dictation/answer    — normalize + score one item
    POST /api/number-dictation/complete  — persist a session summary
"""

from __future__ import annotations

import logging
import random
import re
import uuid
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dal import number_dictation as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/number-dictation", tags=["number-dictation"])


# ---------------------------------------------------------------------------
# Categories & generators
# ---------------------------------------------------------------------------

CATEGORIES = ["teens_vs_tens", "prices", "dates", "times", "years", "phone", "mixed"]
DEFAULT_CATEGORY = "mixed"
SESSION_SIZE = 6
VALID_DIFFICULTIES = {"beginner", "intermediate", "advanced"}

_TEENS = {
    13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen",
    17: "seventeen", 18: "eighteen", 19: "nineteen",
}
_TENS = {
    30: "thirty", 40: "forty", 50: "fifty", 60: "sixty",
    70: "seventy", 80: "eighty", 90: "ninety",
}
_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _ordinal(n: int) -> str:
    if 10 <= (n % 100) <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _ordinal_word(n: int) -> str:
    words = {
        1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
        6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
        11: "eleventh", 12: "twelfth", 13: "thirteenth", 14: "fourteenth",
        15: "fifteenth", 16: "sixteenth", 17: "seventeenth",
        18: "eighteenth", 19: "nineteenth", 20: "twentieth",
        21: "twenty-first", 22: "twenty-second", 23: "twenty-third",
        24: "twenty-fourth", 25: "twenty-fifth", 26: "twenty-sixth",
        27: "twenty-seventh", 28: "twenty-eighth", 29: "twenty-ninth",
        30: "thirtieth", 31: "thirty-first",
    }
    return words.get(n, _ordinal(n))


def _gen_teens_vs_tens(rng: random.Random) -> dict[str, Any]:
    pair_index = rng.randint(0, 6)
    teen_val = 13 + pair_index
    ten_val = 30 + pair_index * 10
    chosen = rng.choice([teen_val, ten_val])
    word = _TEENS[teen_val] if chosen == teen_val else _TENS[ten_val]
    hint = (
        f"Listen for the stress: '{_TEENS[teen_val]}' stresses the second "
        f"syllable, '{_TENS[ten_val]}' the first."
    )
    return {
        "category": "teens_vs_tens",
        "expected_text": str(chosen),
        "spoken_form": word,
        "hint": hint,
    }


def _gen_prices(rng: random.Random) -> dict[str, Any]:
    dollars = rng.randint(1, 199)
    cents = rng.choice([0, 9, 19, 25, 39, 49, 75, 89, 95, 99])
    spoken = f"{dollars} dollars and {cents} cents" if cents else f"{dollars} dollars"
    expected = f"${dollars}.{cents:02d}" if cents else f"${dollars}.00"
    return {
        "category": "prices",
        "expected_text": expected,
        "spoken_form": spoken,
        "hint": "Write as $X.XX. Commas and the dollar sign are stripped when scoring.",
    }


def _gen_dates(rng: random.Random) -> dict[str, Any]:
    month_idx = rng.randint(0, 11)
    day = rng.randint(1, 28)
    month = _MONTHS[month_idx]
    spoken = f"{month} {_ordinal_word(day)}"
    expected = f"{month} {_ordinal(day)}"
    return {
        "category": "dates",
        "expected_text": expected,
        "spoken_form": spoken,
        "hint": "Use 'Month Nth' (e.g., 'March 3rd'). Numeric day forms also accepted.",
    }


def _gen_times(rng: random.Random) -> dict[str, Any]:
    hour = rng.randint(1, 12)
    minute = rng.choice([0, 5, 13, 15, 18, 30, 40, 45, 50, 55])
    if minute == 0:
        spoken = f"{hour} o'clock"
        expected = f"{hour}:00"
    else:
        spoken = f"{hour} {minute:02d}" if minute < 10 else f"{hour} {minute}"
        expected = f"{hour}:{minute:02d}"
    return {
        "category": "times",
        "expected_text": expected,
        "spoken_form": spoken,
        "hint": "Use H:MM. Spaces or no colon are accepted.",
    }


def _year_chunk(n: int) -> str:
    if n < 0 or n > 99:
        return str(n)
    units = [
        "zero", "one", "two", "three", "four", "five",
        "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen",
        "sixteen", "seventeen", "eighteen", "nineteen",
    ]
    if n < 20:
        return units[n]
    tens_word = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty",
                 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety"}[n // 10]
    rem = n % 10
    return tens_word if rem == 0 else f"{tens_word}-{units[rem]}"


def _gen_years(rng: random.Random) -> dict[str, Any]:
    year = rng.choice(
        [1815, 1903, 1914, 1929, 1945, 1969, 1989, 1999, 2001, 2008, 2013, 2019, 2020, 2024]
    )
    if 2000 <= year <= 2009:
        last = year - 2000
        spoken = "two thousand" if last == 0 else f"two thousand {_year_chunk(last)}"
    elif 2010 <= year <= 2099:
        first = year // 100
        last = year % 100
        spoken = f"{_year_chunk(first)} {_year_chunk(last)}"
    else:
        first = year // 100
        last = year % 100
        spoken = f"{_year_chunk(first)} hundred" if last == 0 else f"{_year_chunk(first)} {_year_chunk(last)}"
    return {
        "category": "years",
        "expected_text": str(year),
        "spoken_form": spoken,
        "hint": "Just type the 4-digit year.",
    }


def _gen_phone(rng: random.Random) -> dict[str, Any]:
    area = rng.randint(200, 999)
    mid = rng.randint(200, 999)
    last = rng.randint(0, 9999)
    expected = f"{area}-{mid}-{last:04d}"
    digits = f"{area}{mid}{last:04d}"
    spoken_digits = " ".join(_year_chunk(int(d)) for d in digits)
    return {
        "category": "phone",
        "expected_text": expected,
        "spoken_form": spoken_digits,
        "hint": "Type the 10 digits; dashes/spaces are ignored when scoring.",
    }


_GENERATORS = {
    "teens_vs_tens": _gen_teens_vs_tens,
    "prices": _gen_prices,
    "dates": _gen_dates,
    "times": _gen_times,
    "years": _gen_years,
    "phone": _gen_phone,
}


def generate_session(
    category: str = DEFAULT_CATEGORY,
    count: int = SESSION_SIZE,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Build N items deterministically generated in Python."""
    rng = random.Random(seed)
    cat = (category or DEFAULT_CATEGORY).strip().lower()
    if cat not in CATEGORIES:
        cat = DEFAULT_CATEGORY
    if cat == "mixed":
        cats = list(_GENERATORS.keys())
        rng.shuffle(cats)
        chosen = [cats[i % len(cats)] for i in range(count)]
    else:
        chosen = [cat] * count

    items: list[dict[str, Any]] = []
    for c in chosen:
        item = _GENERATORS[c](rng)
        items.append({
            "id": uuid.uuid4().hex[:12],
            "category": item["category"],
            "expected_text": item["expected_text"],
            "spoken_form": item["spoken_form"],
            # Use a 'speech:' scheme so the frontend knows to play the text
            # via the browser SpeechSynthesis API. (No backend MP3 file.)
            "audio_url": f"speech:{item['spoken_form']}",
            "hint": item["hint"],
        })
    return items


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

_WORD_TO_DIGIT = {
    "zero": "0", "oh": "0", "o": "0",
    "one": "1", "two": "2", "to": "2", "too": "2",
    "three": "3", "four": "4", "for": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "ate": "8",
    "nine": "9",
    "ten": "10", "eleven": "11", "twelve": "12",
    "thirteen": "13", "fourteen": "14", "fifteen": "15",
    "sixteen": "16", "seventeen": "17", "eighteen": "18", "nineteen": "19",
    "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50",
    "sixty": "60", "seventy": "70", "eighty": "80", "ninety": "90",
    "hundred": "100",
}


def normalize_answer(text: str) -> str:
    """Aggressively normalize a numeric answer for comparison.

    Rules:
      - lowercase, strip
      - drop $ , . : / - and any whitespace
      - convert simple number words to digits
    """
    if text is None:
        return ""
    s = str(text).strip().lower()
    parts: list[str] = []
    for tok in re.split(r"\s+", s):
        if not tok:
            continue
        word_key = re.sub(r"[^a-z]", "", tok)
        if word_key in _WORD_TO_DIGIT:
            parts.append(_WORD_TO_DIGIT[word_key])
        else:
            parts.append(tok)
    s = " ".join(parts)
    s = re.sub(r"[\s$,:/\-_.()]", "", s)
    return s


_MONTH_LOOKUP: dict[str, str] = {m.lower(): str(i + 1) for i, m in enumerate(_MONTHS)}
_MONTH_LOOKUP.update({m.lower()[:3]: str(i + 1) for i, m in enumerate(_MONTHS)})


def _normalize_date(text: str) -> str:
    """Map 'March 3rd' / 'Mar 3' / '3/3' / 'march third' to canonical 'M-D'."""
    if text is None:
        return ""
    s = text.strip().lower().replace(",", " ")
    ord_words = {
        "first": "1", "second": "2", "third": "3", "fourth": "4",
        "fifth": "5", "sixth": "6", "seventh": "7", "eighth": "8",
        "ninth": "9", "tenth": "10", "eleventh": "11", "twelfth": "12",
        "thirteenth": "13", "fourteenth": "14", "fifteenth": "15",
        "sixteenth": "16", "seventeenth": "17", "eighteenth": "18",
        "nineteenth": "19", "twentieth": "20",
        "twenty-first": "21", "twenty-second": "22", "twenty-third": "23",
        "twenty-fourth": "24", "twenty-fifth": "25", "twenty-sixth": "26",
        "twenty-seventh": "27", "twenty-eighth": "28", "twenty-ninth": "29",
        "thirtieth": "30", "thirty-first": "31",
    }
    for w, d in ord_words.items():
        s = re.sub(rf"\b{re.escape(w)}\b", d, s)
    s = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", s)

    m = re.match(r"^\s*([a-z]+)\s+(\d{1,2})\s*$", s)
    if m and m.group(1) in _MONTH_LOOKUP:
        return f"{_MONTH_LOOKUP[m.group(1)]}-{int(m.group(2))}"

    m = re.match(r"^\s*(\d{1,2})[\/\-](\d{1,2})\s*$", s)
    if m:
        return f"{int(m.group(1))}-{int(m.group(2))}"

    return re.sub(r"\s+", "", s)


def compare_answer(category: str, expected: str, user: str) -> tuple[bool, str, str]:
    """Return (correct, expected_normalized, user_normalized)."""
    if category == "dates":
        en = _normalize_date(expected)
        un = _normalize_date(user)
    else:
        en = normalize_answer(expected)
        un = normalize_answer(user)
    return (en == un and en != "", en, un)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class NumberDictationItem(BaseModel):
    id: str
    category: str
    expected_text: str
    spoken_form: str
    audio_url: str
    hint: str


class StartRequest(BaseModel):
    category: str | None = Field(default=DEFAULT_CATEGORY)
    difficulty: str | None = Field(default="intermediate")
    count: int = Field(default=SESSION_SIZE, ge=1, le=20)
    seed: int | None = None


class StartResponse(BaseModel):
    session_id: str
    category: str
    difficulty: str
    items: list[NumberDictationItem]


class AnswerRequest(BaseModel):
    item_id: str = Field(min_length=1, max_length=64)
    category: str = Field(min_length=1, max_length=32)
    expected_text: str = Field(min_length=1, max_length=128)
    user_answer: str = Field(default="", max_length=256)
    hint: str = Field(default="", max_length=256)


class AnswerResponse(BaseModel):
    correct: bool
    expected_normalized: str
    user_normalized: str
    hint: str


class CompleteResultItem(BaseModel):
    item_id: str
    category: str
    correct: bool


class CompleteRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    category: str = Field(default=DEFAULT_CATEGORY, min_length=1, max_length=32)
    results: list[CompleteResultItem] = Field(default_factory=list)


class CompleteResponse(BaseModel):
    session_id: str
    total: int
    correct: int
    accuracy: float
    saved_id: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/start", response_model=StartResponse)
async def start_session(payload: StartRequest) -> StartResponse:
    """Start a new dictation session and return N items."""
    cat = (payload.category or DEFAULT_CATEGORY).strip().lower()
    if cat not in CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of {sorted(CATEGORIES)}",
        )
    difficulty = (payload.difficulty or "intermediate").strip().lower()
    if difficulty not in VALID_DIFFICULTIES:
        difficulty = "intermediate"

    items = generate_session(category=cat, count=payload.count, seed=payload.seed)
    return StartResponse(
        session_id=uuid.uuid4().hex,
        category=cat,
        difficulty=difficulty,
        items=[NumberDictationItem(**it) for it in items],
    )


@router.post("/answer", response_model=AnswerResponse)
async def submit_answer(payload: AnswerRequest) -> AnswerResponse:
    """Score a single item answer using normalization."""
    cat = payload.category.strip().lower()
    if cat not in CATEGORIES:
        raise HTTPException(status_code=400, detail="unknown category")
    correct, expected_norm, user_norm = compare_answer(
        cat, payload.expected_text, payload.user_answer
    )
    return AnswerResponse(
        correct=correct,
        expected_normalized=expected_norm,
        user_normalized=user_norm,
        hint=payload.hint,
    )


@router.post("/complete", response_model=CompleteResponse)
async def complete_session(
    payload: CompleteRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> CompleteResponse:
    """Persist a summary row for the just-finished session."""
    total = len(payload.results)
    correct = sum(1 for r in payload.results if r.correct)
    accuracy = (correct / total) if total else 0.0
    cat = (payload.category or DEFAULT_CATEGORY).strip().lower()
    if cat not in CATEGORIES:
        cat = DEFAULT_CATEGORY
    saved_id = await dal.record_session(
        db, category=cat, total=total, correct=correct
    )
    return CompleteResponse(
        session_id=payload.session_id,
        total=total,
        correct=correct,
        accuracy=accuracy,
        saved_id=saved_id,
    )


@router.get("/recent")
async def recent_stats(
    db: aiosqlite.Connection = Depends(get_db_session),
    limit: int = 50,
) -> dict[str, Any]:
    """Return aggregated stats from recent sessions."""
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be 1..500")
    return await dal.get_recent_stats(db, limit=limit)
