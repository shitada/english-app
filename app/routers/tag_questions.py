"""Tag Question Drill API.

Practice English tag questions (e.g. "You're coming, aren't you?") with both
the tag grammar and the rising/falling intonation pattern.

Endpoints
---------
    GET  /api/tag-questions/session?difficulty=...&count=8
        → JSON `{difficulty, items: [...]}` generated via Copilot with a
          ≥8-item static fallback bank.
    POST /api/tag-questions/attempt
        Body: {statement, expected_tag, expected_intonation,
               user_tag, user_intonation}
        → {tag_correct, intonation_correct, score, feedback}

No DB schema changes — attempts are logged via the standard logger only.
"""

from __future__ import annotations

import logging
import random
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.prompts import build_tag_question_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tag-questions", tags=["tag-questions"])


VALID_DIFFICULTIES = {"beginner", "intermediate", "advanced"}
VALID_INTONATIONS = {"rising", "falling"}


# ---------------------------------------------------------------------------
# Static fallback bank (≥8 per difficulty)
# ---------------------------------------------------------------------------
def _item(
    statement: str,
    expected_tag: str,
    expected_intonation: str,
    context_hint: str,
    explanation: str,
    difficulty: str,
) -> dict[str, Any]:
    return {
        "statement": statement,
        "expected_tag": expected_tag,
        "expected_intonation": expected_intonation,
        "context_hint": context_hint,
        "explanation": explanation,
        "difficulty": difficulty,
    }


_FALLBACK_BANK: list[dict[str, Any]] = [
    # ----- beginner -----
    _item(
        "You're coming to the party,",
        "aren't you",
        "falling",
        "You already think they will come; you're just checking.",
        "Positive statement → negative tag. Falling tone expects agreement.",
        "beginner",
    ),
    _item(
        "She likes coffee,",
        "doesn't she",
        "falling",
        "You're confident — you just want confirmation.",
        "'likes' → auxiliary 'does' + n't; falling = expecting agreement.",
        "beginner",
    ),
    _item(
        "They don't live here,",
        "do they",
        "rising",
        "You genuinely aren't sure.",
        "Negative statement → positive tag. Rising = real question.",
        "beginner",
    ),
    _item(
        "He can swim,",
        "can't he",
        "falling",
        "You saw him swimming last summer.",
        "Modal 'can' is repeated in the tag; falling = expect 'yes'.",
        "beginner",
    ),
    _item(
        "You won't tell him,",
        "will you",
        "rising",
        "You're asking for a real promise.",
        "Negative statement → positive tag. Rising = genuine request.",
        "beginner",
    ),
    _item(
        "It's cold today,",
        "isn't it",
        "falling",
        "Making small talk about the obvious weather.",
        "'It is' → 'isn't it'. Falling = chat/agreement invite.",
        "beginner",
    ),
    _item(
        "We should leave soon,",
        "shouldn't we",
        "falling",
        "You're gently suggesting action together.",
        "Modal 'should' repeated in negative tag; falling = suggestion.",
        "beginner",
    ),
    _item(
        "You didn't lock the door,",
        "did you",
        "rising",
        "You honestly don't know whether it got locked.",
        "Negative past → positive tag 'did you'. Rising = real question.",
        "beginner",
    ),
    # ----- intermediate -----
    _item(
        "She's been working here for years,",
        "hasn't she",
        "falling",
        "Colleagues chatting about a long-time employee.",
        "Present perfect 'has been' → tag 'hasn't she'. Falling = agreement.",
        "intermediate",
    ),
    _item(
        "You've already eaten,",
        "haven't you",
        "falling",
        "You can see the empty plate.",
        "Present perfect → 'haven't you'. Falling = confirm the obvious.",
        "intermediate",
    ),
    _item(
        "He rarely complains,",
        "does he",
        "falling",
        "'Rarely' is a near-negative — so the tag flips to positive.",
        "Near-negative adverbs (rarely, seldom, hardly) take positive tags.",
        "intermediate",
    ),
    _item(
        "Let's take a break,",
        "shall we",
        "rising",
        "Inviting the group to pause.",
        "After 'let's' the tag is always 'shall we'; rising = invitation.",
        "intermediate",
    ),
    _item(
        "Open the window,",
        "will you",
        "rising",
        "Polite request, not an order.",
        "Imperatives take 'will you' / 'won't you'; rising softens to a request.",
        "intermediate",
    ),
    _item(
        "Nobody called while I was out,",
        "did they",
        "rising",
        "You genuinely don't know if anyone called.",
        "Negative subject 'nobody' → positive tag 'did they'. Rising = real Q.",
        "intermediate",
    ),
    _item(
        "I'm late,",
        "aren't I",
        "falling",
        "Apologising as you walk in.",
        "Fixed form: 'I am' → tag 'aren't I' (not 'amn't I').",
        "intermediate",
    ),
    _item(
        "You used to live in Tokyo,",
        "didn't you",
        "falling",
        "You remember it but want them to confirm.",
        "'Used to' takes 'did'-support: 'didn't you'. Falling = confirm.",
        "intermediate",
    ),
    # ----- advanced -----
    _item(
        "There's nothing we can do,",
        "is there",
        "rising",
        "You really hope there's still some option.",
        "'There is' → tag 'is there'; 'nothing' makes the clause negative so tag is positive.",
        "advanced",
    ),
    _item(
        "He'd rather stay home,",
        "wouldn't he",
        "falling",
        "You know him well.",
        "''d rather' is 'would rather' → tag 'wouldn't he'. Falling = agreement.",
        "advanced",
    ),
    _item(
        "You must have seen the email,",
        "haven't you",
        "falling",
        "You're fairly sure they saw it.",
        "Deductive 'must have' takes perfect tag 'haven't you'. Falling = expect yes.",
        "advanced",
    ),
    _item(
        "Everyone has signed the form,",
        "haven't they",
        "falling",
        "You assume it's done and want a nod.",
        "Indefinite 'everyone' takes plural tag pronoun 'they'. Falling = confirmation.",
        "advanced",
    ),
    _item(
        "Hardly anyone showed up,",
        "did they",
        "falling",
        "Complaining about the low turnout.",
        "'Hardly' is near-negative → positive tag 'did they'. Falling = shared dismay.",
        "advanced",
    ),
    _item(
        "You'd better hurry,",
        "hadn't you",
        "rising",
        "Urging them to move — tone is half-warning.",
        "'You'd better' = 'you had better' → tag 'hadn't you'.",
        "advanced",
    ),
    _item(
        "This isn't the first time, is it,",
        "is it",
        "rising",
        "Pressing for an honest admission.",
        "Negative clause → positive tag 'is it'. Rising = challenging / probing.",
        "advanced",
    ),
    _item(
        "Nothing ever changes around here,",
        "does it",
        "falling",
        "Cynical shared observation.",
        "'Nothing' makes it negative → positive tag 'does it'. Falling = commiseration.",
        "advanced",
    ),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TagQuestionItem(BaseModel):
    statement: str
    expected_tag: str
    expected_intonation: str  # 'rising' | 'falling'
    context_hint: str
    explanation: str
    difficulty: str


class TagQuestionSessionResponse(BaseModel):
    difficulty: str
    items: list[TagQuestionItem]


class TagQuestionAttemptRequest(BaseModel):
    statement: str = Field(..., min_length=1, max_length=400)
    expected_tag: str = Field(..., min_length=1, max_length=60)
    expected_intonation: str = Field(..., min_length=1, max_length=16)
    user_tag: str = Field(..., max_length=60)
    user_intonation: str = Field(..., max_length=16)


class TagQuestionAttemptResponse(BaseModel):
    tag_correct: bool
    intonation_correct: bool
    score: int = Field(..., ge=0, le=100)
    feedback: str


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested)
# ---------------------------------------------------------------------------

_PUNCT_RE = re.compile(r"[^\w\s']")

_CONTRACTION_MAP = {
    "arent": "aren't",
    "isnt": "isn't",
    "wasnt": "wasn't",
    "werent": "weren't",
    "dont": "don't",
    "doesnt": "doesn't",
    "didnt": "didn't",
    "havent": "haven't",
    "hasnt": "hasn't",
    "hadnt": "hadn't",
    "wont": "won't",
    "wouldnt": "wouldn't",
    "shouldnt": "shouldn't",
    "couldnt": "couldn't",
    "cant": "can't",
    "mustnt": "mustn't",
    "shant": "shan't",
    "neednt": "needn't",
}


def normalize_tag(raw: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace, normalize contractions."""
    if not raw:
        return ""
    s = raw.strip().lower()
    s = _PUNCT_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Token-level contraction normalization (e.g. "arent" → "aren't")
    tokens = [_CONTRACTION_MAP.get(tok, tok) for tok in s.split(" ")]
    return " ".join(tokens)


def normalize_intonation(raw: str) -> str:
    s = (raw or "").strip().lower()
    if s in VALID_INTONATIONS:
        return s
    # tolerate symbols
    if "↗" in (raw or "") or "up" in s or "rise" in s:
        return "rising"
    if "↘" in (raw or "") or "down" in s or "fall" in s:
        return "falling"
    return s


def grade_attempt(
    expected_tag: str,
    expected_intonation: str,
    user_tag: str,
    user_intonation: str,
) -> dict[str, Any]:
    """Grade a single attempt and return tag_correct / intonation_correct /
    score / feedback.

    Scoring: tag worth 70, intonation worth 30 (sum 100).
    """
    tag_correct = normalize_tag(expected_tag) == normalize_tag(user_tag) and bool(
        normalize_tag(user_tag)
    )
    intonation_correct = normalize_intonation(expected_intonation) == normalize_intonation(
        user_intonation
    )
    score = (70 if tag_correct else 0) + (30 if intonation_correct else 0)

    if tag_correct and intonation_correct:
        feedback = "Perfect — correct tag and intonation."
    elif tag_correct and not intonation_correct:
        feedback = (
            f"Tag is right. Intonation should be {normalize_intonation(expected_intonation)} "
            f"({'↗' if normalize_intonation(expected_intonation) == 'rising' else '↘'})."
        )
    elif intonation_correct and not tag_correct:
        feedback = f"Intonation is right. The expected tag is '{expected_tag.strip()}'."
    else:
        feedback = (
            f"Expected tag '{expected_tag.strip()}' with "
            f"{normalize_intonation(expected_intonation)} intonation."
        )
    return {
        "tag_correct": tag_correct,
        "intonation_correct": intonation_correct,
        "score": int(score),
        "feedback": feedback,
    }


def _coerce_item(raw: Any, difficulty: str) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    statement = str(raw.get("statement") or "").strip()
    expected_tag = str(raw.get("expected_tag") or "").strip()
    intonation = str(raw.get("expected_intonation") or "").strip().lower()
    if not statement or not expected_tag:
        return None
    if intonation not in VALID_INTONATIONS:
        return None
    return {
        "statement": statement,
        "expected_tag": expected_tag,
        "expected_intonation": intonation,
        "context_hint": str(raw.get("context_hint") or "").strip(),
        "explanation": str(raw.get("explanation") or "").strip()
        or "Tag agrees with the auxiliary of the statement.",
        "difficulty": difficulty,
    }


def coerce_session_payload(raw: Any, difficulty: str) -> list[dict[str, Any]] | None:
    """Validate an LLM response. Returns list of items or None if malformed."""
    if not isinstance(raw, dict):
        return None
    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        return None
    items: list[dict[str, Any]] = []
    for it in items_raw:
        coerced = _coerce_item(it, difficulty)
        if coerced is not None:
            items.append(coerced)
    if len(items) < 1:
        return None
    return items


def build_fallback_session(
    difficulty: str, count: int, seed: int | None = None
) -> list[dict[str, Any]]:
    """Pick `count` items from the curated bank for the given difficulty."""
    pool = [it for it in _FALLBACK_BANK if it["difficulty"] == difficulty]
    if not pool:
        pool = list(_FALLBACK_BANK)
    rng = random.Random(seed)
    rng.shuffle(pool)
    # Allow wrap-around if pool smaller than requested count
    out = list(pool)
    while len(out) < count:
        extra = list(pool)
        rng.shuffle(extra)
        out.extend(extra)
    return [dict(it) for it in out[:count]]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/session", response_model=TagQuestionSessionResponse)
async def get_session(
    difficulty: str = Query(default="beginner"),
    count: int = Query(default=8, ge=1, le=20),
) -> TagQuestionSessionResponse:
    """Return a session of tag-question items."""
    diff = (difficulty or "beginner").strip().lower()
    if diff not in VALID_DIFFICULTIES:
        diff = "beginner"

    items: list[dict[str, Any]] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_tag_question_prompt(diff, count)
        raw = await service.ask_json(system_prompt, user_message)
        items = coerce_session_payload(raw, diff)
        if items is None:
            logger.info("tag-questions LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("tag-questions generation failed, using fallback: %s", exc)

    if not items:
        items = build_fallback_session(diff, count)

    # Trim/pad to requested count
    if len(items) < count:
        items = items + build_fallback_session(diff, count - len(items))
    items = items[:count]

    return TagQuestionSessionResponse(
        difficulty=diff,
        items=[TagQuestionItem(**it) for it in items],
    )


@router.post("/attempt", response_model=TagQuestionAttemptResponse)
async def post_attempt(
    payload: TagQuestionAttemptRequest,
) -> TagQuestionAttemptResponse:
    """Grade one tag-question attempt."""
    try:
        result = grade_attempt(
            expected_tag=payload.expected_tag,
            expected_intonation=payload.expected_intonation,
            user_tag=payload.user_tag,
            user_intonation=payload.user_intonation,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to grade tag-question attempt")
        raise HTTPException(status_code=500, detail="Failed to grade attempt")

    try:
        logger.info(
            "tag_questions.attempt tag_correct=%s intonation_correct=%s score=%d",
            result["tag_correct"],
            result["intonation_correct"],
            result["score"],
        )
    except Exception:  # noqa: BLE001
        pass

    return TagQuestionAttemptResponse(**result)
