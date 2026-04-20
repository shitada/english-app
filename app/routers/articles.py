"""Article Chip Drill API (a/an/the/∅).

Each session contains 8 sentences with one or more blanks; the learner
fills each blank by tapping a chip (a / an / the / —). Correct answers
are taken from the LLM-generated payload, with a rich static fallback
bank keyed by difficulty.

Endpoints
---------
    GET  /api/articles/session?difficulty=easy|medium|hard
    POST /api/articles/submit
    GET  /api/articles/stats
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
from app.dal import articles as dal
from app.database import get_db_session
from app.prompts import build_article_drill_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/articles", tags=["articles"])


VALID_ANSWERS = {"a", "an", "the", "none"}
VALID_DIFFICULTIES = {"easy", "medium", "hard"}
SESSION_SIZE = 8


# ---------------------------------------------------------------------------
# Static fallback bank (~20 sentences per level)
# ---------------------------------------------------------------------------
def _s(
    sid: str,
    template: str,
    blanks: list[dict[str, str]],
) -> dict[str, Any]:
    return {"id": sid, "sentence_template": template, "blanks": blanks}


def _B(i: int, a: str, rule: str, hint: str) -> dict[str, Any]:
    return {"index": i, "answer": a, "rule_category": rule, "hint": hint}


_FALLBACK_EASY: list[dict[str, Any]] = [
    _s("e01", "I saw __1__ cat in the garden.",
       [_B(1, "a", "indefinite_consonant", "Singular count noun, consonant sound → 'a'.")]),
    _s("e02", "She is __1__ honest student.",
       [_B(1, "an", "indefinite_vowel_sound", "'honest' begins with a vowel sound → 'an'.")]),
    _s("e03", "__1__ sun rises in the east.",
       [_B(1, "the", "definite_unique", "Unique object → 'the'.")]),
    _s("e04", "He plays __1__ football after school.",
       [_B(1, "none", "zero_sports", "Sports/games take no article → ∅.")]),
    _s("e05", "I bought __1__ apple and __2__ banana.",
       [_B(1, "an", "indefinite_vowel_sound", "'apple' starts with a vowel sound → 'an'."),
        _B(2, "a", "indefinite_consonant", "Singular count noun, consonant sound → 'a'.")]),
    _s("e06", "She plays __1__ piano every day.",
       [_B(1, "the", "definite_musical_instrument", "Musical instruments take 'the'.")]),
    _s("e07", "__1__ Nile is a famous river.",
       [_B(1, "the", "definite_proper_rivers", "Rivers take 'the'.")]),
    _s("e08", "I have __1__ hour to spare.",
       [_B(1, "an", "indefinite_vowel_sound", "'hour' begins with a vowel sound → 'an'.")]),
    _s("e09", "They go to school by __1__ bus.",
       [_B(1, "none", "zero_by_transport", "'by + transport' takes no article.")]),
    _s("e10", "We had __1__ dinner at 7pm.",
       [_B(1, "none", "zero_meals", "Meal names take no article in general use → ∅.")]),
    _s("e11", "__1__ moon is bright tonight.",
       [_B(1, "the", "definite_unique", "Unique celestial body → 'the'.")]),
    _s("e12", "I need __1__ umbrella.",
       [_B(1, "an", "indefinite_vowel_sound", "'umbrella' begins with a vowel sound → 'an'.")]),
    _s("e13", "He is __1__ European diplomat.",
       [_B(1, "a", "indefinite_consonant", "'European' begins with a 'yu' consonant sound → 'a'.")]),
    _s("e14", "She visits her grandmother every __1__ day.",
       [_B(1, "none", "zero_every", "'every + day' takes no article → ∅.")]),
    _s("e15", "__1__ book on the table is mine.",
       [_B(1, "the", "definite_specific", "Specific known object → 'the'.")]),
    _s("e16", "I want __1__ orange juice.",
       [_B(1, "none", "zero_uncountable", "Uncountable noun in general → ∅.")]),
    _s("e17", "He bought __1__ new bicycle.",
       [_B(1, "a", "indefinite_consonant", "Singular count noun, consonant sound → 'a'.")]),
    _s("e18", "__1__ Queen visited Japan.",
       [_B(1, "the", "definite_title", "Unique title → 'the'.")]),
    _s("e19", "They arrived at __1__ airport late.",
       [_B(1, "the", "definite_specific", "Specific known place → 'the'.")]),
    _s("e20", "I study __1__ English at university.",
       [_B(1, "none", "zero_languages", "Language names take no article → ∅.")]),
]

_FALLBACK_MEDIUM: list[dict[str, Any]] = [
    _s("m01", "He plays __1__ violin beautifully.",
       [_B(1, "the", "definite_musical_instrument", "Musical instruments take 'the'.")]),
    _s("m02", "We went to __1__ bed early last night.",
       [_B(1, "none", "zero_places_purpose", "'go to bed' (purpose) takes no article.")]),
    _s("m03", "__1__ Alps are a beautiful mountain range.",
       [_B(1, "the", "definite_proper_plural", "Plural mountain ranges take 'the'.")]),
    _s("m04", "I'd like __1__ cup of coffee, please.",
       [_B(1, "a", "indefinite_consonant", "Singular count noun, consonant sound → 'a'.")]),
    _s("m05", "She is __1__ MBA student.",
       [_B(1, "an", "indefinite_vowel_sound", "'MBA' starts with the vowel sound /ɛ/ → 'an'.")]),
    _s("m06", "__1__ information she gave me was useful.",
       [_B(1, "the", "definite_specific", "Specific known information → 'the'.")]),
    _s("m07", "I love __1__ music.",
       [_B(1, "none", "zero_abstract", "Abstract noun in general → ∅.")]),
    _s("m08", "He is __1__ best player on __2__ team.",
       [_B(1, "the", "definite_superlative", "Superlatives take 'the'."),
        _B(2, "the", "definite_specific", "Specific known team → 'the'.")]),
    _s("m09", "__1__ life is full of surprises.",
       [_B(1, "none", "zero_abstract", "Abstract noun in general → ∅.")]),
    _s("m10", "She wants to be __1__ engineer.",
       [_B(1, "an", "indefinite_vowel_sound", "Profession starting with vowel sound → 'an'.")]),
    _s("m11", "I go to __1__ church every Sunday.",
       [_B(1, "none", "zero_places_purpose", "'go to church' (purpose) takes no article.")]),
    _s("m12", "__1__ rich should help __2__ poor.",
       [_B(1, "the", "definite_group_adjective", "'the + adj' for a group → 'the'."),
        _B(2, "the", "definite_group_adjective", "'the + adj' for a group → 'the'.")]),
    _s("m13", "She traveled across __1__ United States.",
       [_B(1, "the", "definite_proper_country", "Country names with plural/union noun take 'the'.")]),
    _s("m14", "__1__ Mount Fuji is in Japan.",
       [_B(1, "none", "zero_single_mountain", "Single mountain names take no article → ∅.")]),
    _s("m15", "I read __1__ interesting article today.",
       [_B(1, "an", "indefinite_vowel_sound", "'interesting' begins with a vowel sound → 'an'.")]),
    _s("m16", "He gave me __1__ advice.",
       [_B(1, "none", "zero_uncountable", "Uncountable noun in general → ∅.")]),
    _s("m17", "We had __1__ wonderful time at __2__ party.",
       [_B(1, "a", "indefinite_consonant", "Singular count noun → 'a'."),
        _B(2, "the", "definite_specific", "Specific party → 'the'.")]),
    _s("m18", "__1__ elephant is __2__ large animal.",
       [_B(1, "an", "indefinite_vowel_sound", "'elephant' begins with a vowel sound → 'an'."),
        _B(2, "a", "indefinite_consonant", "Singular count noun, consonant sound → 'a'.")]),
    _s("m19", "I listen to __1__ radio every morning.",
       [_B(1, "the", "definite_media", "'the radio' takes 'the'.")]),
    _s("m20", "He watches __1__ TV in the evening.",
       [_B(1, "none", "zero_tv", "'watch TV' takes no article → ∅.")]),
]

_FALLBACK_HARD: list[dict[str, Any]] = [
    _s("h01", "__1__ Dutch are known for their tulips.",
       [_B(1, "the", "definite_nationality_plural", "Nationality as a group → 'the'.")]),
    _s("h02", "She plays __1__ guitar in __2__ band.",
       [_B(1, "the", "definite_musical_instrument", "Musical instruments take 'the'."),
        _B(2, "a", "indefinite_consonant", "A non-specific band → 'a'.")]),
    _s("h03", "__1__ poverty is a global problem.",
       [_B(1, "none", "zero_abstract", "Abstract noun in general → ∅.")]),
    _s("h04", "He arrived at __1__ university by __2__ taxi.",
       [_B(1, "the", "definite_specific", "Specific known university → 'the'."),
        _B(2, "none", "zero_by_transport", "'by + transport' takes no article.")]),
    _s("h05", "__1__ Hague is the seat of government.",
       [_B(1, "the", "definite_proper_city", "Certain cities like 'The Hague' take 'the'.")]),
    _s("h06", "I saw __1__ unusual bird yesterday.",
       [_B(1, "an", "indefinite_vowel_sound", "'unusual' begins with a vowel sound → 'an'.")]),
    _s("h07", "__1__ French eat a lot of bread.",
       [_B(1, "the", "definite_nationality_plural", "Nationality as a group → 'the'.")]),
    _s("h08", "She's __1__ honor student at __2__ university.",
       [_B(1, "an", "indefinite_vowel_sound", "'honor' begins with a vowel sound → 'an'."),
        _B(2, "a", "indefinite_consonant", "Non-specific university, 'yu' sound → 'a'.")]),
    _s("h09", "__1__ Earth orbits __2__ Sun.",
       [_B(1, "none", "zero_planet", "Planet names take no article → ∅."),
        _B(2, "the", "definite_unique", "Unique celestial body → 'the'.")]),
    _s("h10", "We discussed __1__ climate change in __2__ class.",
       [_B(1, "none", "zero_abstract", "Abstract noun in general → ∅."),
        _B(2, "none", "zero_places_purpose", "'in class' (purpose) takes no article.")]),
    _s("h11", "__1__ Smiths are coming for dinner.",
       [_B(1, "the", "definite_family_plural", "Family surnames pluralised take 'the'.")]),
    _s("h12", "He plays __1__ chess and __2__ golf.",
       [_B(1, "none", "zero_sports", "Games take no article → ∅."),
        _B(2, "none", "zero_sports", "Games take no article → ∅.")]),
    _s("h13", "__1__ Pacific Ocean is vast.",
       [_B(1, "the", "definite_proper_ocean", "Oceans take 'the'.")]),
    _s("h14", "She has __1__ PhD in __2__ economics.",
       [_B(1, "a", "indefinite_consonant", "'PhD' starts with /p/ consonant sound → 'a'."),
        _B(2, "none", "zero_academic", "Academic subjects in general → ∅.")]),
    _s("h15", "__1__ more you read, __2__ more you learn.",
       [_B(1, "the", "definite_comparative", "'the + comparative' correlative → 'the'."),
        _B(2, "the", "definite_comparative", "'the + comparative' correlative → 'the'.")]),
    _s("h16", "I prefer __1__ tea to __2__ coffee.",
       [_B(1, "none", "zero_uncountable", "Uncountable noun in general → ∅."),
        _B(2, "none", "zero_uncountable", "Uncountable noun in general → ∅.")]),
    _s("h17", "He works at __1__ hospital downtown.",
       [_B(1, "a", "indefinite_consonant", "Non-specific hospital, consonant sound → 'a'.")]),
    _s("h18", "__1__ Queen of England gave __2__ speech.",
       [_B(1, "the", "definite_title", "Unique title → 'the'."),
        _B(2, "a", "indefinite_consonant", "Non-specific speech → 'a'.")]),
    _s("h19", "Every __1__ day, he runs in __2__ park.",
       [_B(1, "none", "zero_every", "'every + day' takes no article → ∅."),
        _B(2, "the", "definite_specific", "Specific known park → 'the'.")]),
    _s("h20", "__1__ history teaches us __2__ important lessons.",
       [_B(1, "none", "zero_academic", "Subject in general → ∅."),
        _B(2, "none", "zero_plural_generic", "Plural generic noun → ∅.")]),
]


_BANKS_BY_DIFFICULTY: dict[str, list[dict[str, Any]]] = {
    "easy": _FALLBACK_EASY,
    "medium": _FALLBACK_MEDIUM,
    "hard": _FALLBACK_HARD,
}


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ArticleBlank(BaseModel):
    index: int
    answer: str
    rule_category: str
    hint: str


class ArticleItem(BaseModel):
    id: str
    sentence_template: str
    blanks: list[ArticleBlank]


class ArticleSessionResponse(BaseModel):
    session_id: str
    difficulty: str
    items: list[ArticleItem]


class ArticleSubmitItem(BaseModel):
    id: str = Field(..., max_length=64)
    sentence_template: str = Field(..., max_length=400)
    blanks: list[ArticleBlank]
    user_answers: list[str] = Field(default_factory=list)


class ArticleSubmitRequest(BaseModel):
    difficulty: str = Field(default="medium", max_length=20)
    items: list[ArticleSubmitItem] = Field(default_factory=list)


class ArticleBlankResult(BaseModel):
    item_id: str
    index: int
    correct_answer: str
    user_answer: str
    correct: bool
    rule_category: str
    hint: str


class ArticleCategoryStat(BaseModel):
    correct: int
    total: int


class ArticleSubmitResponse(BaseModel):
    correct_count: int
    total_count: int
    accuracy: float
    per_blank_results: list[ArticleBlankResult]
    category_breakdown: dict[str, ArticleCategoryStat]


class ArticleStatsResponse(BaseModel):
    days: int
    total: int
    correct: int
    accuracy: float
    per_category: dict[str, dict[str, float]]
    weakest_category: str | None


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable)
# ---------------------------------------------------------------------------

def normalize_article_answer(raw: Any) -> str:
    """Lowercase + canonicalise. '', '-', '—', '∅' all map to 'none'."""
    if raw is None:
        return ""
    s = str(raw).strip().lower()
    if s in ("-", "—", "–", "∅", "zero", "0"):
        return "none"
    if s in ("", "a", "an", "the", "none"):
        return s
    return s


def _coerce_blank(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        idx = int(raw.get("index"))
    except (ValueError, TypeError):
        return None
    answer = normalize_article_answer(raw.get("answer"))
    if answer not in VALID_ANSWERS:
        return None
    rule_category = str(raw.get("rule_category") or "other").strip() or "other"
    hint = str(raw.get("hint") or "").strip()
    return {
        "index": idx,
        "answer": answer,
        "rule_category": rule_category,
        "hint": hint or "Article usage rule.",
    }


def _coerce_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    item_id = str(raw.get("id") or "").strip()
    template = str(raw.get("sentence_template") or "").strip()
    blanks_raw = raw.get("blanks")
    if not template or not isinstance(blanks_raw, list) or not blanks_raw:
        return None
    blanks: list[dict[str, Any]] = []
    for b in blanks_raw:
        cb = _coerce_blank(b)
        if cb is not None:
            blanks.append(cb)
    if not blanks:
        return None
    if not item_id:
        item_id = f"llm-{uuid.uuid4().hex[:8]}"
    return {"id": item_id, "sentence_template": template, "blanks": blanks}


def coerce_session_payload(raw: Any) -> list[dict[str, Any]] | None:
    """Validate an LLM payload. Returns list[item] or None if malformed."""
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
    difficulty: str = "medium",
    count: int = SESSION_SIZE,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Pick `count` sentences from the static bank for the requested level."""
    diff = difficulty if difficulty in VALID_DIFFICULTIES else "medium"
    bank = list(_BANKS_BY_DIFFICULTY[diff])
    rng = random.Random(seed)
    rng.shuffle(bank)
    out: list[dict[str, Any]] = []
    while len(out) < count:
        if not bank:
            bank = list(_BANKS_BY_DIFFICULTY[diff])
            rng.shuffle(bank)
        picked = bank.pop()
        out.append(
            {
                "id": picked["id"],
                "sentence_template": picked["sentence_template"],
                "blanks": [dict(b) for b in picked["blanks"]],
            }
        )
    return out[:count]


def score_submission(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Score a submitted session.

    Each item dict: {id, sentence_template, blanks, user_answers}.
    Returns {correct_count, total_count, per_blank_results, category_breakdown}.
    """
    per_blank: list[dict[str, Any]] = []
    category: dict[str, dict[str, int]] = {}
    total = 0
    correct = 0
    for it in items or []:
        item_id = str(it.get("id") or "")
        blanks = it.get("blanks") or []
        users = it.get("user_answers") or []
        for i, blank in enumerate(blanks):
            if not isinstance(blank, dict):
                continue
            ans = normalize_article_answer(blank.get("answer"))
            if ans not in VALID_ANSWERS:
                continue
            user_raw = users[i] if i < len(users) else ""
            user = normalize_article_answer(user_raw)
            ok = user == ans
            total += 1
            if ok:
                correct += 1
            rule = str(blank.get("rule_category") or "other") or "other"
            bucket = category.setdefault(rule, {"correct": 0, "total": 0})
            bucket["total"] += 1
            if ok:
                bucket["correct"] += 1
            per_blank.append(
                {
                    "item_id": item_id,
                    "index": int(blank.get("index") or (i + 1)),
                    "correct_answer": ans,
                    "user_answer": user,
                    "correct": ok,
                    "rule_category": rule,
                    "hint": str(blank.get("hint") or ""),
                }
            )
    return {
        "correct_count": correct,
        "total_count": total,
        "per_blank_results": per_blank,
        "category_breakdown": category,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/session", response_model=ArticleSessionResponse)
async def get_session(
    difficulty: str = Query(default="medium"),
) -> ArticleSessionResponse:
    """Return a fresh 8-item article drill session."""
    diff = (difficulty or "medium").strip().lower()
    if diff not in VALID_DIFFICULTIES:
        raise HTTPException(status_code=422, detail="Invalid difficulty")

    items: list[dict[str, Any]] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_article_drill_prompt(
            difficulty=diff, count=SESSION_SIZE
        )
        raw = await service.ask_json(system_prompt, user_message)
        items = coerce_session_payload(raw)
        if items is None:
            logger.info("article-drill LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "article-drill generation failed, using fallback: %s", exc
        )

    if not items:
        items = build_fallback_session(difficulty=diff, count=SESSION_SIZE)

    if len(items) < SESSION_SIZE:
        items = items + build_fallback_session(
            difficulty=diff, count=SESSION_SIZE - len(items)
        )
    items = items[:SESSION_SIZE]

    session_id = f"art-{uuid.uuid4().hex[:12]}"
    return ArticleSessionResponse(
        session_id=session_id,
        difficulty=diff,
        items=[ArticleItem(**it) for it in items],
    )


@router.post("/submit", response_model=ArticleSubmitResponse)
async def submit_session(
    payload: ArticleSubmitRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ArticleSubmitResponse:
    """Score the submitted session and persist one row."""
    diff = (payload.difficulty or "medium").strip().lower()
    if diff not in VALID_DIFFICULTIES:
        raise HTTPException(status_code=422, detail="Invalid difficulty")
    if not payload.items:
        raise HTTPException(status_code=422, detail="items is required")

    items_for_scoring: list[dict[str, Any]] = []
    for it in payload.items:
        items_for_scoring.append(
            {
                "id": it.id,
                "sentence_template": it.sentence_template,
                "blanks": [b.model_dump() for b in it.blanks],
                "user_answers": list(it.user_answers or []),
            }
        )

    scored = score_submission(items_for_scoring)
    total = scored["total_count"]
    if total == 0:
        raise HTTPException(status_code=422, detail="No valid blanks to score")

    try:
        await dal.insert_attempt(
            db,
            difficulty=diff,
            total_count=total,
            correct_count=scored["correct_count"],
            blanks=[
                {
                    "id": it.id,
                    "sentence_template": it.sentence_template,
                    "blanks": [b.model_dump() for b in it.blanks],
                }
                for it in payload.items
            ],
            answers=[list(it.user_answers or []) for it in payload.items],
            categories=scored["category_breakdown"],
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist article-drill attempt")
        raise HTTPException(status_code=500, detail="Failed to save attempt")

    accuracy = (
        scored["correct_count"] / total if total else 0.0
    )
    return ArticleSubmitResponse(
        correct_count=scored["correct_count"],
        total_count=total,
        accuracy=accuracy,
        per_blank_results=[
            ArticleBlankResult(**r) for r in scored["per_blank_results"]
        ],
        category_breakdown={
            cat: ArticleCategoryStat(**info)
            for cat, info in scored["category_breakdown"].items()
        },
    )


@router.get("/stats", response_model=ArticleStatsResponse)
async def get_stats(
    days: int = Query(default=30, ge=1, le=365),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ArticleStatsResponse:
    """Per-category accuracy over the last `days` days."""
    try:
        stats = await dal.category_stats(db, days=days)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute article-drill stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")

    return ArticleStatsResponse(
        days=stats["days"],
        total=stats["total"],
        correct=stats["correct"],
        accuracy=stats["accuracy"],
        per_category={
            cat: {
                "total": float(info["total"]),
                "correct": float(info["correct"]),
                "accuracy": float(info["accuracy"]),
            }
            for cat, info in stats["per_category"].items()
        },
        weakest_category=stats["weakest_category"],
    )
