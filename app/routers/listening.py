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
from app.dal import listening_speed as ls_dal
from app.dal import minimal_pair as mp_dal
from app.dal import numbers_drill as nd_dal
from app.dal import sentence_echo as se_dal
from app.database import get_db_session
from app.prompts import NUMBERS_DRILL_PROMPT, SENTENCE_ECHO_PROMPT, THOUGHT_GROUP_PROMPT

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
async def start_minimal_pair_session(
    rounds: int = 5,
    contrast: str | None = None,
) -> MinimalPairStartResponse:
    """Pick a contrast set and return N rounds for the client to play.

    If ``contrast`` is provided and matches one of ``MINIMAL_PAIR_SETS``,
    that set is used (focused drill). Otherwise a random set is chosen.

    Each round randomly chooses which of the two words to speak via TTS so the
    listener has to discriminate.
    """
    n = max(1, min(rounds, 10))
    contrast_set: dict[str, Any] | None = None
    if contrast:
        for s in MINIMAL_PAIR_SETS:
            if s["contrast"] == contrast:
                contrast_set = s
                break
    if contrast_set is None:
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


@router.get("/minimal-pair/weak-contrasts")
async def get_minimal_pair_weak_contrasts(
    lookback: int = 30,
    min_attempts: int = 3,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> dict[str, Any]:
    """Return up to 3 weakest phoneme contrasts based on recent sessions."""
    contrasts = await mp_dal.aggregate_contrast_accuracy(
        db, lookback=lookback, min_attempts=min_attempts
    )
    return {"contrasts": contrasts}


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


# ---------------------------------------------------------------------------
# Speed Ladder progress (per-topic best playback rate)
# ---------------------------------------------------------------------------

class SpeedProgressResponse(BaseModel):
    topic: str
    max_speed: float


class SpeedProgressRequest(BaseModel):
    topic: str = Field(default="", max_length=200)
    speed: float = Field(..., ge=0.5, le=2.0)


class SpeedProgressSaveResponse(BaseModel):
    ok: bool
    topic: str
    max_speed: float


@router.get("/speed/{topic}", response_model=SpeedProgressResponse)
async def get_listening_speed(
    topic: str,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SpeedProgressResponse:
    """Return the saved best playback speed for a topic (default 1.0)."""
    # Treat reserved sentinel "all" / "any" / "none" as the global bucket
    norm = topic.strip().lower()
    if norm in {"all", "any", "none", "global", "_"}:
        norm = ""
    try:
        max_speed = await ls_dal.get_max_speed(db, norm)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to fetch listening speed for topic=%s", topic)
        raise HTTPException(status_code=500, detail="Failed to fetch listening speed")
    return SpeedProgressResponse(topic=norm, max_speed=max_speed)


@router.post("/speed", response_model=SpeedProgressSaveResponse)
async def save_listening_speed(
    payload: SpeedProgressRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SpeedProgressSaveResponse:
    """UPSERT a new best speed for a topic (only persists if greater)."""
    try:
        new_max = await ls_dal.record_speed(db, payload.topic, payload.speed)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record listening speed: topic=%s speed=%s",
                         payload.topic, payload.speed)
        raise HTTPException(status_code=500, detail="Failed to record listening speed")
    norm = (payload.topic or "").strip().lower()
    logger.info("listening_speed: topic=%s submitted=%s stored_max=%s",
                norm, payload.speed, new_max)
    return SpeedProgressSaveResponse(ok=True, topic=norm, max_speed=new_max)


# ---------------------------------------------------------------------------
# Quick Thought-Group Phrasing drill
# ---------------------------------------------------------------------------

VALID_DIFFICULTIES = {"beginner", "intermediate", "advanced"}


# Hand-curated fallback bank used when the LLM is unavailable or returns
# malformed JSON. Each entry's pause_indices are 1-based positions of words
# AFTER which a natural thought-group pause occurs.
_FALLBACK_THOUGHT_GROUPS: list[dict[str, Any]] = [
    {
        "sentence": "When the meeting finally ended, everyone stood up, gathered their belongings, and quietly left the conference room.",
        "pause_indices": [5, 9, 13],
        "rules": ["after subordinate clause", "between coordinated verbs", "between coordinated verbs"],
    },
    {
        "sentence": "Although the weather forecast predicted heavy rain, we decided to continue our hike up the mountain.",
        "pause_indices": [7, 11],
        "rules": ["after subordinate clause", "after main verb phrase"],
    },
    {
        "sentence": "The new manager, who joined the company last month, has already introduced several important changes to the team.",
        "pause_indices": [3, 9, 14],
        "rules": ["before relative clause", "after relative clause", "after main verb phrase"],
    },
    {
        "sentence": "After finishing her homework, Sarah went to the kitchen, made a quick sandwich, and sat down to read.",
        "pause_indices": [4, 9, 13],
        "rules": ["after introductory phrase", "between coordinated clauses", "between coordinated verbs"],
    },
    {
        "sentence": "If you finish the project early, you can leave the office before five and enjoy the weekend.",
        "pause_indices": [6, 12],
        "rules": ["after subordinate clause", "between coordinated clauses"],
    },
    {
        "sentence": "My younger brother, a talented musician, has been performing in local jazz clubs since he was sixteen.",
        "pause_indices": [3, 6, 12],
        "rules": ["before appositive", "after appositive", "before subordinate clause"],
    },
    {
        "sentence": "Before you make any final decisions, please review the document carefully and discuss it with your team.",
        "pause_indices": [5, 11],
        "rules": ["after introductory clause", "between coordinated verbs"],
    },
    {
        "sentence": "The book that I borrowed from the library last week was much more interesting than I had expected.",
        "pause_indices": [2, 9, 13],
        "rules": ["before relative clause", "after relative clause", "before comparison clause"],
    },
]


class ThoughtGroupResponse(BaseModel):
    sentence: str
    words: list[str]
    pause_indices: list[int]
    rules: list[str]
    difficulty: str


def _split_sentence(sentence: str) -> list[str]:
    return [w for w in re.split(r"\s+", sentence.strip()) if w]


def _coerce_thought_group(raw: Any) -> dict[str, Any] | None:
    """Validate and normalize an LLM thought-group payload. Returns None if invalid."""
    if not isinstance(raw, dict):
        return None
    sentence = str(raw.get("sentence") or "").strip()
    if not sentence:
        return None

    raw_words = raw.get("words")
    if isinstance(raw_words, list) and raw_words:
        words = [str(w).strip() for w in raw_words if str(w).strip()]
    else:
        words = _split_sentence(sentence)

    n = len(words)
    if n < 15 or n > 25:
        return None

    raw_indices = raw.get("pause_indices") or []
    if not isinstance(raw_indices, list):
        return None

    pause_indices: list[int] = []
    for v in raw_indices:
        try:
            i = int(v)
        except (TypeError, ValueError):
            continue
        if 1 <= i <= n - 1 and i not in pause_indices:
            pause_indices.append(i)
    pause_indices.sort()
    if len(pause_indices) < 2 or len(pause_indices) > 4:
        return None

    raw_rules = raw.get("rules") or []
    if isinstance(raw_rules, list):
        rules = [str(r).strip() for r in raw_rules if str(r).strip()]
    else:
        rules = []
    # Pad / trim rules to match pause_indices length
    if len(rules) < len(pause_indices):
        rules = rules + ["thought-group boundary"] * (len(pause_indices) - len(rules))
    rules = rules[: len(pause_indices)]

    return {
        "sentence": " ".join(words),
        "words": words,
        "pause_indices": pause_indices,
        "rules": rules,
    }


def _fallback_thought_group() -> dict[str, Any]:
    item = random.choice(_FALLBACK_THOUGHT_GROUPS)
    words = _split_sentence(item["sentence"])
    return {
        "sentence": item["sentence"],
        "words": words,
        "pause_indices": list(item["pause_indices"]),
        "rules": list(item["rules"]),
    }


@router.get("/thought-group", response_model=ThoughtGroupResponse)
async def get_thought_group(difficulty: str = "intermediate") -> ThoughtGroupResponse:
    """Return a sentence with curated/llm-suggested thought-group pause indices."""
    norm = (difficulty or "intermediate").strip().lower()
    if norm not in VALID_DIFFICULTIES:
        norm = "intermediate"

    coerced: dict[str, Any] | None = None
    try:
        service = get_copilot_service()
        raw = await service.ask_json(
            THOUGHT_GROUP_PROMPT(),
            f"Generate one {norm}-level thought-group sentence now.",
        )
        coerced = _coerce_thought_group(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("thought-group generation failed, using fallback: %s", exc)

    if coerced is None:
        coerced = _fallback_thought_group()

    return ThoughtGroupResponse(
        sentence=coerced["sentence"],
        words=coerced["words"],
        pause_indices=coerced["pause_indices"],
        rules=coerced["rules"],
        difficulty=norm,
    )


# ---------------------------------------------------------------------------
# Sentence Echo — progressive listening memory-span drill
# ---------------------------------------------------------------------------

VALID_ECHO_LEVELS = {"beginner", "intermediate", "advanced"}

# Curated fallback sentences keyed by exact word count, used when the LLM
# response is missing or has the wrong length.
_SENTENCE_ECHO_FALLBACKS: dict[int, list[str]] = {
    6: [
        "She left her keys at home.",
        "The morning bus is always late.",
        "I bought a new pair of shoes.",
    ],
    9: [
        "The children played quietly in the small back garden.",
        "He always drinks coffee before going to the office.",
    ],
    12: [
        "On Sunday morning we usually walk along the beach for an hour.",
        "The train was delayed because of heavy snow on the northern line.",
    ],
    15: [
        "After dinner she sat by the window and read her book until the sun finally set.",
        "We spent the entire weekend cleaning the garage and finally found the missing camping gear.",
    ],
    18: [
        "Although it had been raining heavily all morning the children still wanted to go to the park after lunch.",
        "When the meeting finished she walked across the bridge to the small cafe near the river to relax.",
    ],
}


def _coerce_echo_payload(raw: Any, span: int) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    sentence = raw.get("sentence")
    if not isinstance(sentence, str):
        return None
    sentence = sentence.strip()
    # Verify word count matches requested span.
    word_count = len(re.findall(r"[A-Za-z0-9']+", sentence))
    if word_count != span:
        return None
    ipa_hint = raw.get("ipa_hint")
    if not isinstance(ipa_hint, str):
        ipa_hint = ""
    return {"sentence": sentence, "ipa_hint": ipa_hint.strip()}


def _fallback_echo_sentence(span: int) -> dict[str, str]:
    bucket = _SENTENCE_ECHO_FALLBACKS.get(span)
    if not bucket:
        # Find nearest available span.
        keys = sorted(_SENTENCE_ECHO_FALLBACKS.keys(), key=lambda k: abs(k - span))
        bucket = _SENTENCE_ECHO_FALLBACKS[keys[0]]
    return {"sentence": random.choice(bucket), "ipa_hint": ""}


class SentenceEchoGenerateRequest(BaseModel):
    span: int = Field(..., ge=4, le=24)
    level: str = Field(default="intermediate", max_length=32)


class SentenceEchoGenerateResponse(BaseModel):
    sentence: str
    ipa_hint: str = ""
    span: int


class SentenceEchoScoreRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=600)
    heard: str = Field(default="", max_length=600)
    span: int = Field(..., ge=4, le=24)


class SentenceEchoScoreResponse(BaseModel):
    accuracy: float
    passed: bool
    next_span: int
    best_span: int


class SentenceEchoTrendPoint(BaseModel):
    date: str
    max_span: int
    avg_accuracy: float
    attempts: int


class SentenceEchoTrendResponse(BaseModel):
    points: list[SentenceEchoTrendPoint]
    best_span: int


@router.post("/sentence-echo/generate", response_model=SentenceEchoGenerateResponse)
async def generate_sentence_echo(
    payload: SentenceEchoGenerateRequest,
) -> SentenceEchoGenerateResponse:
    """Generate one sentence containing exactly `span` words at the given CEFR level."""
    level = (payload.level or "intermediate").strip().lower()
    if level not in VALID_ECHO_LEVELS:
        level = "intermediate"
    span = int(payload.span)

    coerced: dict[str, str] | None = None
    try:
        service = get_copilot_service()
        raw = await service.ask_json(
            SENTENCE_ECHO_PROMPT(),
            f"Generate one {level}-level English sentence containing EXACTLY "
            f"{span} words for a listening memory-span drill.",
        )
        coerced = _coerce_echo_payload(raw, span)
    except Exception as exc:  # noqa: BLE001
        logger.warning("sentence-echo generation failed, using fallback: %s", exc)

    if coerced is None:
        coerced = _fallback_echo_sentence(span)

    return SentenceEchoGenerateResponse(
        sentence=coerced["sentence"],
        ipa_hint=coerced.get("ipa_hint", ""),
        span=span,
    )


@router.post("/sentence-echo/score", response_model=SentenceEchoScoreResponse)
async def score_sentence_echo(
    payload: SentenceEchoScoreRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SentenceEchoScoreResponse:
    """Compute word-level accuracy server-side, persist the attempt, and
    advise the next span value."""
    accuracy = se_dal.word_accuracy(payload.target, payload.heard)
    passed = accuracy >= se_dal.PASS_THRESHOLD
    try:
        await se_dal.record_attempt(db, span=payload.span, accuracy=accuracy, passed=passed)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record sentence-echo attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")
    nxt = se_dal.next_span(payload.span, passed)
    best = await se_dal.get_best_span(db)
    return SentenceEchoScoreResponse(
        accuracy=round(accuracy, 4),
        passed=passed,
        next_span=nxt,
        best_span=best,
    )


@router.get("/sentence-echo/trend", response_model=SentenceEchoTrendResponse)
async def get_sentence_echo_trend(
    days: int = 14,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SentenceEchoTrendResponse:
    """Return daily memory-span trend points and the user's best span."""
    days = max(1, min(int(days), 90))
    points = await se_dal.get_recent_span_trend(db, days=days)
    best = await se_dal.get_best_span(db)
    return SentenceEchoTrendResponse(
        points=[SentenceEchoTrendPoint(**p) for p in points],
        best_span=best,
    )
