"""Error Correction Drill — typing-based grammar repair mini-game.

Flow:
    POST /api/error-correction/start    → 5 items with ONE error each.
    POST /api/error-correction/grade    → grade one typed answer (normalize +
                                         LLM borderline grader), persist.
    POST /api/error-correction/finish   → summary score + missed error types.
"""

from __future__ import annotations

import logging
import random
import re
import uuid
from difflib import SequenceMatcher
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import error_correction as dal
from app.database import get_db_session
from app.prompts import (
    ERROR_CORRECTION_CATEGORIES,
    build_error_correction_grade_prompt,
    build_error_correction_prompt,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/error-correction", tags=["error-correction"])

VALID_CATEGORIES = set(ERROR_CORRECTION_CATEGORIES)
VALID_LEVELS = {"beginner", "intermediate", "advanced"}

DEFAULT_COUNT = 5


# ---------------------------------------------------------------------------
# Static fallback bank (used when Copilot is unavailable)
# ---------------------------------------------------------------------------
def _f(wrong: str, reference: str, error_type: str, hint_ja: str,
       category: str, level: str) -> dict[str, Any]:
    return {
        "wrong": wrong,
        "reference": reference,
        "error_type": error_type,
        "hint_ja": hint_ja,
        "category": category,
        "level": level,
    }


_FALLBACK_BANK: list[dict[str, Any]] = [
    # subject_verb_agreement
    _f("She go to school every day.", "She goes to school every day.",
       "subject-verb agreement", "主語と動詞の一致に注目",
       "subject_verb_agreement", "beginner"),
    _f("They was waiting for an hour.", "They were waiting for an hour.",
       "subject-verb agreement", "be動詞の形に注目",
       "subject_verb_agreement", "beginner"),
    _f("My brother don't like coffee.", "My brother doesn't like coffee.",
       "subject-verb agreement", "三単現の否定形に注目",
       "subject_verb_agreement", "beginner"),
    _f("Everyone have their own opinion.", "Everyone has their own opinion.",
       "subject-verb agreement", "everyone は単数扱い",
       "subject_verb_agreement", "intermediate"),
    _f("Neither of the answers are correct.", "Neither of the answers is correct.",
       "subject-verb agreement", "neither of の主語の扱い",
       "subject_verb_agreement", "advanced"),
    # article
    _f("I saw elephant at the zoo.", "I saw an elephant at the zoo.",
       "article", "可算名詞に冠詞が必要",
       "article", "beginner"),
    _f("She is best student in class.", "She is the best student in the class.",
       "article", "最上級と限定された名詞の冠詞",
       "article", "beginner"),
    _f("He plays the soccer every weekend.", "He plays soccer every weekend.",
       "article", "スポーツ名には冠詞不要",
       "article", "intermediate"),
    _f("I had the dinner at 7 pm.", "I had dinner at 7 pm.",
       "article", "食事名には冠詞不要",
       "article", "intermediate"),
    _f("She plays a piano very well.", "She plays the piano very well.",
       "article", "楽器には the が必要",
       "article", "advanced"),
    # preposition
    _f("I arrived to Tokyo yesterday.", "I arrived in Tokyo yesterday.",
       "preposition", "arrive の後の前置詞",
       "preposition", "beginner"),
    _f("She is good in math.", "She is good at math.",
       "preposition", "good の後の前置詞",
       "preposition", "beginner"),
    _f("We listen music every morning.", "We listen to music every morning.",
       "preposition", "listen の後の前置詞",
       "preposition", "intermediate"),
    _f("He is afraid from dogs.", "He is afraid of dogs.",
       "preposition", "afraid の後の前置詞",
       "preposition", "intermediate"),
    _f("She depends from her parents.", "She depends on her parents.",
       "preposition", "depend の後の前置詞",
       "preposition", "advanced"),
    # tense
    _f("I have seen him yesterday.", "I saw him yesterday.",
       "tense", "yesterday は過去形",
       "tense", "beginner"),
    _f("She is living in Tokyo since 2015.", "She has lived in Tokyo since 2015.",
       "tense", "since + 現在完了",
       "tense", "intermediate"),
    _f("When I arrived, they already left.", "When I arrived, they had already left.",
       "tense", "過去完了を使う場面",
       "tense", "advanced"),
    _f("He didn't went to school yesterday.", "He didn't go to school yesterday.",
       "tense", "did の後は原形",
       "tense", "beginner"),
    _f("I am knowing the answer now.", "I know the answer now.",
       "tense", "know は通常進行形にしない",
       "tense", "intermediate"),
    # word_order
    _f("She speaks English very well always.", "She always speaks English very well.",
       "word order", "頻度副詞の位置",
       "word_order", "beginner"),
    _f("I know not what to do.", "I don't know what to do.",
       "word order", "否定形の語順",
       "word_order", "intermediate"),
    _f("Do you know where is the station?", "Do you know where the station is?",
       "word order", "間接疑問文の語順",
       "word_order", "intermediate"),
    _f("Never I have seen such a movie.", "Never have I seen such a movie.",
       "word order", "否定倒置の語順",
       "word_order", "advanced"),
    # plural_countable
    _f("I need some advices.", "I need some advice.",
       "plural/countable", "advice は不可算",
       "plural_countable", "intermediate"),
    _f("He gave me many informations.", "He gave me a lot of information.",
       "plural/countable", "information は不可算",
       "plural_countable", "intermediate"),
    _f("She bought two breads.", "She bought two loaves of bread.",
       "plural/countable", "bread は不可算",
       "plural_countable", "advanced"),
    _f("There are many childrens in the park.", "There are many children in the park.",
       "plural/countable", "child の複数形",
       "plural_countable", "beginner"),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class StartRequest(BaseModel):
    category: str = Field(default="tense")
    level: str = Field(default="beginner")
    count: int = Field(default=DEFAULT_COUNT, ge=1, le=10)


class StartItem(BaseModel):
    id: str
    wrong: str
    error_type: str
    hint_ja: str


class StartResponse(BaseModel):
    session_id: str
    category: str
    level: str
    items: list[StartItem]


class GradeRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=64)
    item_id: str = Field(..., min_length=1, max_length=64)
    user_answer: str = Field(..., min_length=1, max_length=400)


class DiffToken(BaseModel):
    token: str
    status: str  # 'same' | 'insert' | 'delete'


class GradeResponse(BaseModel):
    is_correct: bool
    reference: str
    explanation_ja: str
    diff: list[DiffToken]


class FinishRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=64)


class MistakeItem(BaseModel):
    id: str
    wrong: str
    reference: str
    error_type: str
    user_answer: str
    explanation_ja: str


class FinishResponse(BaseModel):
    total: int
    attempted: int
    correct: int
    score: int
    mistakes: list[MistakeItem]


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested)
# ---------------------------------------------------------------------------

_PUNCT_STRIP_RE = re.compile(r"[\".,!?;:()\[\]\u2018\u2019\u201C\u201D]+")


def normalize_sentence(s: str) -> str:
    """Lowercase, trim, collapse whitespace, and strip punctuation / quotes.
    Internal apostrophes (contractions) are preserved.
    """
    if not s:
        return ""
    out = s.strip().lower()
    out = _PUNCT_STRIP_RE.sub(" ", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def _tokenize(s: str) -> list[str]:
    norm = normalize_sentence(s)
    return norm.split(" ") if norm else []


def sentences_equivalent(a: str, b: str) -> bool:
    """True when two sentences match after normalization."""
    ta = _tokenize(a)
    tb = _tokenize(b)
    return bool(ta) and ta == tb


def word_diff(reference: str, user_answer: str) -> list[dict[str, str]]:
    """Compute a word-level diff.

    Returns a flat list of {token, status} where status is one of:
      - 'same'    — token matches in both
      - 'insert'  — extra token in user_answer (should be removed)
      - 'delete'  — token missing from user_answer (should be added)
    Replacements are emitted as a delete followed by an insert.
    """
    ref = _tokenize(reference)
    usr = _tokenize(user_answer)
    sm = SequenceMatcher(a=ref, b=usr, autojunk=False)
    out: list[dict[str, str]] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for tok in ref[i1:i2]:
                out.append({"token": tok, "status": "same"})
        elif tag == "insert":
            for tok in usr[j1:j2]:
                out.append({"token": tok, "status": "insert"})
        elif tag == "delete":
            for tok in ref[i1:i2]:
                out.append({"token": tok, "status": "delete"})
        elif tag == "replace":
            for tok in ref[i1:i2]:
                out.append({"token": tok, "status": "delete"})
            for tok in usr[j1:j2]:
                out.append({"token": tok, "status": "insert"})
    return out


def _coerce_generated_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    wrong = str(raw.get("wrong") or "").strip()
    reference = str(raw.get("reference") or "").strip()
    error_type = str(raw.get("error_type") or "").strip()
    hint_ja = str(raw.get("hint_ja") or "").strip()
    if not wrong or not reference:
        return None
    if sentences_equivalent(wrong, reference):
        return None
    return {
        "wrong": wrong,
        "reference": reference,
        "error_type": error_type or "grammar",
        "hint_ja": hint_ja or "文法ミスに注目",
    }


def coerce_start_payload(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        return None
    out: list[dict[str, Any]] = []
    for it in items_raw:
        coerced = _coerce_generated_item(it)
        if coerced is not None:
            out.append(coerced)
    return out or None


def build_fallback_batch(
    category: str, level: str, count: int, seed: int | None = None
) -> list[dict[str, Any]]:
    pool = [
        it for it in _FALLBACK_BANK
        if it["category"] == category and it["level"] == level
    ]
    if not pool:
        pool = [it for it in _FALLBACK_BANK if it["category"] == category]
    if not pool:
        pool = list(_FALLBACK_BANK)
    rng = random.Random(seed)
    rng.shuffle(pool)
    out: list[dict[str, Any]] = []
    while len(out) < count:
        out.extend(pool)
    return [
        {
            "wrong": it["wrong"],
            "reference": it["reference"],
            "error_type": it["error_type"],
            "hint_ja": it["hint_ja"],
        }
        for it in out[:count]
    ]


def coerce_grade_payload(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    ok = raw.get("is_correct")
    if ok is None:
        return None
    explanation = str(raw.get("explanation_ja") or "").strip()
    return {
        "is_correct": bool(ok),
        "explanation_ja": explanation,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/start", response_model=StartResponse)
async def start_drill(
    payload: StartRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> StartResponse:
    category = (payload.category or "tense").strip().lower()
    level = (payload.level or "beginner").strip().lower()
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    if level not in VALID_LEVELS:
        raise HTTPException(status_code=400, detail="Invalid level")

    count = int(payload.count or DEFAULT_COUNT)

    items: list[dict[str, Any]] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_error_correction_prompt(
            category, level, count
        )
        raw = await service.ask_json(system_prompt, user_message)
        items = coerce_start_payload(raw)
        if items is None:
            logger.info("error-correction LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("error-correction generation failed, using fallback: %s", exc)

    if not items:
        items = build_fallback_batch(category, level, count)
    if len(items) < count:
        items = items + build_fallback_batch(category, level, count - len(items))
    items = items[:count]

    session_id = f"ec-{uuid.uuid4().hex[:12]}"
    try:
        await dal.create_session(
            db, session_id=session_id, category=category, level=level
        )
        persisted_items: list[dict[str, Any]] = []
        for idx, it in enumerate(items):
            item_id = f"{session_id}-{idx+1}"
            persisted_items.append(
                {
                    "id": item_id,
                    "idx": idx,
                    "wrong": it["wrong"],
                    "reference": it["reference"],
                    "error_type": it["error_type"],
                    "hint_ja": it["hint_ja"],
                }
            )
        await dal.save_items(db, session_id=session_id, items=persisted_items)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist error-correction session")
        raise HTTPException(status_code=500, detail="Failed to create session")

    return StartResponse(
        session_id=session_id,
        category=category,
        level=level,
        items=[
            StartItem(
                id=it["id"],
                wrong=it["wrong"],
                error_type=it["error_type"],
                hint_ja=it["hint_ja"],
            )
            for it in persisted_items
        ],
    )


@router.post("/grade", response_model=GradeResponse)
async def grade_item(
    payload: GradeRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> GradeResponse:
    item = await dal.get_item(
        db, session_id=payload.session_id, item_id=payload.item_id
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    reference = item["reference"]
    wrong = item["wrong"]
    user_answer = payload.user_answer.strip()

    is_correct = sentences_equivalent(user_answer, reference)
    explanation_ja = ""

    # Borderline: learner changed the sentence but didn't exactly match ref.
    if not is_correct and not sentences_equivalent(user_answer, wrong):
        try:
            service = get_copilot_service()
            system_prompt, user_message = build_error_correction_grade_prompt(
                wrong=wrong,
                reference=reference,
                user_answer=user_answer,
                error_type=item.get("error_type") or "",
            )
            raw = await service.ask_json(system_prompt, user_message)
            coerced = coerce_grade_payload(raw)
            if coerced is not None:
                is_correct = bool(coerced["is_correct"])
                explanation_ja = coerced["explanation_ja"]
        except Exception as exc:  # noqa: BLE001
            logger.warning("error-correction borderline grade failed: %s", exc)

    if not is_correct and not explanation_ja:
        explanation_ja = "もう一度、正しい文を入力してください。"

    diff_tokens = word_diff(reference, user_answer)

    try:
        await dal.record_answer(
            db,
            session_id=payload.session_id,
            item_id=payload.item_id,
            user_answer=user_answer,
            is_correct=is_correct,
            explanation_ja=explanation_ja,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist error-correction answer")

    return GradeResponse(
        is_correct=is_correct,
        reference=reference,
        explanation_ja=explanation_ja,
        diff=[DiffToken(**t) for t in diff_tokens],
    )


@router.post("/finish", response_model=FinishResponse)
async def finish(
    payload: FinishRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> FinishResponse:
    try:
        summary = await dal.finish_session(db, session_id=payload.session_id)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to finish error-correction session")
        raise HTTPException(status_code=500, detail="Failed to finish session")

    return FinishResponse(
        total=summary["total"],
        attempted=summary["attempted"],
        correct=summary["correct"],
        score=summary["score"],
        mistakes=[MistakeItem(**m) for m in summary["mistakes"]],
    )
