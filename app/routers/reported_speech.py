"""Reported Speech Transformation drill API.

Writing drill where the learner transforms a DIRECT quote into reported /
indirect speech, covering backshift, pronoun shift, time-adverb shift,
and reported questions / commands.

Flow:

    POST /api/reported-speech/session → 5 items (Copilot + static fallback)
    POST /api/reported-speech/grade   → judge an attempt, persist, return
                                        {correct, score, feedback,
                                         diff_highlights}
    GET  /api/reported-speech/weakness → focus tags with <70% accuracy
"""

from __future__ import annotations

import logging
import random
import re
import uuid
from typing import Any, Iterable

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import reported_speech as dal
from app.database import get_db_session
from app.prompts import (
    REPORTED_SPEECH_GRADE_SYSTEM,
    build_reported_speech_prompt,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reported-speech", tags=["reported-speech"])


VALID_FOCUS_TAGS = set(dal.FOCUS_TAGS)


# ---------------------------------------------------------------------------
# Static fallback bank (≥15 items across the five focus tags)
# ---------------------------------------------------------------------------

def _item(
    item_id: str,
    direct: str,
    context_hint: str,
    reference: str,
    accepted_variants: list[str],
    focus_tags: list[str],
) -> dict[str, Any]:
    return {
        "id": item_id,
        "direct": direct,
        "context_hint": context_hint,
        "reference": reference,
        "accepted_variants": list(accepted_variants),
        "focus_tags": list(focus_tags),
    }


_FALLBACK_BANK: list[dict[str, Any]] = [
    # ----- backshift + time_adverb -----
    _item("rs01",
          'She said, "I am tired today."',
          "Report what she said.",
          "She said that she was tired that day.",
          ["She said she was tired that day."],
          ["backshift", "time_adverb"]),
    _item("rs02",
          'He said, "I will call you tomorrow."',
          "Report what he promised.",
          "He said that he would call me the next day.",
          ["He said he would call me the next day.",
           "He said that he would call me the following day."],
          ["backshift", "time_adverb", "pronoun"]),
    _item("rs03",
          'Anna said, "I saw the movie yesterday."',
          "Report what Anna said.",
          "Anna said that she had seen the movie the day before.",
          ["Anna said she had seen the movie the day before.",
           "Anna said she had seen the movie the previous day."],
          ["backshift", "time_adverb", "pronoun"]),
    _item("rs04",
          'Tom said, "I am studying now."',
          "Report what Tom said.",
          "Tom said that he was studying then.",
          ["Tom said he was studying then.",
           "Tom said that he was studying at that moment."],
          ["backshift", "time_adverb", "pronoun"]),
    _item("rs05",
          'The manager said, "We have finished the report."',
          "Report what the manager said.",
          "The manager said that they had finished the report.",
          ["The manager said they had finished the report."],
          ["backshift", "pronoun"]),
    # ----- pronoun focus -----
    _item("rs06",
          'Lily said, "My brother loves your dog."',
          "Report what Lily said to you.",
          "Lily said that her brother loved my dog.",
          ["Lily said her brother loved my dog."],
          ["pronoun", "backshift"]),
    _item("rs07",
          'Dad said, "I need your help."',
          "Report what Dad said to you.",
          "Dad said that he needed my help.",
          ["Dad said he needed my help."],
          ["pronoun", "backshift"]),
    _item("rs08",
          'Mia told me, "I can fix this myself."',
          "Report what Mia told you.",
          "Mia told me that she could fix it herself.",
          ["Mia told me she could fix it herself."],
          ["pronoun", "backshift"]),
    # ----- questions (yes/no + wh) -----
    _item("rs09",
          'He asked, "Are you coming to the party?"',
          "Report the yes/no question.",
          "He asked if I was coming to the party.",
          ["He asked whether I was coming to the party."],
          ["question", "backshift", "pronoun"]),
    _item("rs10",
          'She asked, "Where do you live?"',
          "Report the wh-question.",
          "She asked where I lived.",
          ["She asked me where I lived."],
          ["question", "backshift", "pronoun"]),
    _item("rs11",
          'They asked, "Have you finished your homework?"',
          "Report the yes/no question.",
          "They asked if I had finished my homework.",
          ["They asked whether I had finished my homework."],
          ["question", "backshift", "pronoun"]),
    _item("rs12",
          'The teacher asked, "Why are you late?"',
          "Report the wh-question.",
          "The teacher asked why I was late.",
          ["The teacher asked me why I was late."],
          ["question", "backshift", "pronoun"]),
    # ----- commands -----
    _item("rs13",
          'The coach said, "Run faster!"',
          "Report the command.",
          "The coach told us to run faster.",
          ["The coach told me to run faster."],
          ["command", "pronoun"]),
    _item("rs14",
          'Mom said, "Don\'t eat too much candy."',
          "Report the negative command.",
          "Mom told me not to eat too much candy.",
          ["Mom told us not to eat too much candy."],
          ["command", "pronoun"]),
    _item("rs15",
          'The guide said, "Please be quiet."',
          "Report the polite command.",
          "The guide asked us to be quiet.",
          ["The guide told us to be quiet."],
          ["command", "pronoun"]),
    _item("rs16",
          'She said, "Call me when you arrive."',
          "Report the request.",
          "She told me to call her when I arrived.",
          ["She asked me to call her when I arrived."],
          ["command", "pronoun", "backshift"]),
    # ----- extra backshift variety -----
    _item("rs17",
          'Ben said, "I have been waiting for an hour."',
          "Report what Ben said.",
          "Ben said that he had been waiting for an hour.",
          ["Ben said he had been waiting for an hour."],
          ["backshift", "pronoun"]),
    _item("rs18",
          'Sue said, "I can swim."',
          "Report what Sue said.",
          "Sue said that she could swim.",
          ["Sue said she could swim."],
          ["backshift", "pronoun"]),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ReportedSpeechItem(BaseModel):
    id: str
    direct: str
    context_hint: str
    reference: str
    accepted_variants: list[str] = Field(default_factory=list)
    focus_tags: list[str] = Field(default_factory=list)


class ReportedSpeechSessionRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=10)


class ReportedSpeechSessionResponse(BaseModel):
    session_id: str
    items: list[ReportedSpeechItem]


class ReportedSpeechGradeRequest(BaseModel):
    item_id: str = Field(..., max_length=64)
    direct: str = Field(..., min_length=1, max_length=400)
    reference: str = Field(..., min_length=1, max_length=400)
    accepted_variants: list[str] = Field(default_factory=list)
    focus_tags: list[str] = Field(default_factory=list)
    user_answer: str = Field(..., min_length=1, max_length=400)


class ReportedSpeechDiffHighlight(BaseModel):
    kind: str  # "missing" | "wrong" | "extra"
    text: str


class ReportedSpeechGradeResponse(BaseModel):
    correct: bool
    score: int
    feedback: str
    diff_highlights: list[ReportedSpeechDiffHighlight] = Field(default_factory=list)
    matched: str = "llm"  # "exact" | "variant" | "llm" | "fallback"


class ReportedSpeechWeaknessTag(BaseModel):
    tag: str
    total: int
    correct: int
    accuracy: float


class ReportedSpeechWeaknessResponse(BaseModel):
    limit: int
    tags: list[ReportedSpeechWeaknessTag]


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable)
# ---------------------------------------------------------------------------

_PUNCT_RE = re.compile(r'[\s\.,!?;:"“”‘’\'\-]+')
_WORD_RE = re.compile(r"[a-z0-9']+")


def normalize_text(raw: str) -> str:
    """Lowercase, strip quotes/punctuation, collapse whitespace.

    Used for comparing user_answer against reference/accepted_variants.
    """
    if not raw:
        return ""
    s = str(raw).strip().lower()
    # Replace any run of punctuation/whitespace with a single space
    s = _PUNCT_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def tokenize(raw: str) -> list[str]:
    if not raw:
        return []
    return _WORD_RE.findall(str(raw).lower())


def matches_any(user_answer: str, candidates: Iterable[str]) -> bool:
    """True if the normalized user_answer matches any of the candidates."""
    u = normalize_text(user_answer)
    if not u:
        return False
    for c in candidates or []:
        if u == normalize_text(c):
            return True
    return False


def token_overlap_score(user_answer: str, reference: str) -> int:
    """Return a 0..100 score using Jaccard token overlap.

    Used as a fallback when the LLM is unavailable.
    """
    u = set(tokenize(user_answer))
    r = set(tokenize(reference))
    if not u and not r:
        return 0
    if not u or not r:
        return 0
    inter = u & r
    union = u | r
    if not union:
        return 0
    return int(round(100.0 * len(inter) / len(union)))


def compute_diff_highlights(
    user_answer: str, reference: str
) -> list[dict[str, str]]:
    """Compute a simple token-level diff suitable for UI highlighting.

    Tokens in `reference` but not `user_answer` are tagged ``missing``;
    tokens in `user_answer` but not `reference` are tagged ``extra``.
    """
    u_tokens = tokenize(user_answer)
    r_tokens = tokenize(reference)
    u_set = set(u_tokens)
    r_set = set(r_tokens)
    out: list[dict[str, str]] = []
    for tok in r_tokens:
        if tok not in u_set:
            out.append({"kind": "missing", "text": tok})
    for tok in u_tokens:
        if tok not in r_set:
            out.append({"kind": "extra", "text": tok})
    return out


def _coerce_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    item_id = str(raw.get("id") or "").strip() or f"llm-{uuid.uuid4().hex[:8]}"
    direct = str(raw.get("direct") or "").strip()
    reference = str(raw.get("reference") or "").strip()
    hint = str(raw.get("context_hint") or "").strip()
    variants_raw = raw.get("accepted_variants")
    variants = (
        [str(v).strip() for v in variants_raw if str(v).strip()]
        if isinstance(variants_raw, list)
        else []
    )
    tags_raw = raw.get("focus_tags")
    tags = (
        [str(t).strip().lower() for t in tags_raw if str(t).strip()]
        if isinstance(tags_raw, list)
        else []
    )
    tags = [t for t in tags if t in VALID_FOCUS_TAGS]
    if not direct or not reference or not tags:
        return None
    return {
        "id": item_id,
        "direct": direct,
        "context_hint": hint or "Report what was said.",
        "reference": reference,
        "accepted_variants": variants,
        "focus_tags": tags,
    }


def coerce_session_payload(raw: Any) -> list[dict[str, Any]] | None:
    """Validate LLM response. Returns list or None if malformed."""
    if not isinstance(raw, dict):
        return None
    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        return None
    items: list[dict[str, Any]] = []
    for it in items_raw:
        c = _coerce_item(it)
        if c is not None:
            items.append(c)
    if not items:
        return None
    return items


def build_fallback_session(
    count: int = 5, seed: int | None = None
) -> list[dict[str, Any]]:
    """Pick `count` items from the static bank, roughly spread across tags."""
    rng = random.Random(seed)
    bank = [dict(it) for it in _FALLBACK_BANK]
    rng.shuffle(bank)
    # Encourage spread: pick each item's primary tag round-robin
    by_tag: dict[str, list[dict[str, Any]]] = {}
    for it in bank:
        primary = (it["focus_tags"] or ["backshift"])[0]
        by_tag.setdefault(primary, []).append(it)
    tags = list(by_tag.keys())
    rng.shuffle(tags)
    out: list[dict[str, Any]] = []
    idx = 0
    guard = 0
    while len(out) < count and guard < count * 20 and any(by_tag.values()):
        tag = tags[idx % len(tags)]
        bucket = by_tag.get(tag) or []
        if bucket:
            out.append(dict(bucket.pop()))
        idx += 1
        guard += 1
    # Fill any remainder from the flat bank
    if len(out) < count:
        extra = [dict(it) for it in _FALLBACK_BANK]
        rng.shuffle(extra)
        for it in extra:
            if len(out) >= count:
                break
            if not any(o["id"] == it["id"] for o in out):
                out.append(dict(it))
    return out[:count]


def _coerce_grade_payload(raw: Any) -> dict[str, Any] | None:
    """Coerce an LLM grade response into a safe dict, or return None."""
    if not isinstance(raw, dict):
        return None
    try:
        correct = bool(raw.get("correct"))
        score = int(raw.get("score") or 0)
        score = max(0, min(100, score))
        feedback = str(raw.get("feedback") or "").strip()[:400]
        diffs_raw = raw.get("diff_highlights")
        diffs: list[dict[str, str]] = []
        if isinstance(diffs_raw, list):
            for d in diffs_raw:
                if not isinstance(d, dict):
                    continue
                kind = str(d.get("kind") or "").strip().lower()
                text = str(d.get("text") or "").strip()
                if kind in {"missing", "wrong", "extra"} and text:
                    diffs.append({"kind": kind, "text": text[:80]})
        return {
            "correct": correct,
            "score": score,
            "feedback": feedback or (
                "Good attempt." if correct else "Review the reference answer."
            ),
            "diff_highlights": diffs,
        }
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/session", response_model=ReportedSpeechSessionResponse)
async def create_session(
    payload: ReportedSpeechSessionRequest | None = None,
    count: int = Query(default=5, ge=1, le=10),
) -> ReportedSpeechSessionResponse:
    """Return a fresh session with `count` reported-speech items."""
    requested = payload.count if payload is not None else count
    items: list[dict[str, Any]] | None = None
    try:
        service = get_copilot_service()
        system_prompt, user_message = build_reported_speech_prompt(requested)
        raw = await service.ask_json(system_prompt, user_message)
        items = coerce_session_payload(raw)
        if items is None:
            logger.info("reported-speech LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("reported-speech generation failed, fallback: %s", exc)

    if not items:
        items = build_fallback_session(requested)

    if len(items) < requested:
        items = items + build_fallback_session(requested - len(items))
    items = items[:requested]

    session_id = f"rs-{uuid.uuid4().hex[:12]}"
    return ReportedSpeechSessionResponse(
        session_id=session_id,
        items=[ReportedSpeechItem(**it) for it in items],
    )


@router.post("/grade", response_model=ReportedSpeechGradeResponse)
async def grade_attempt(
    payload: ReportedSpeechGradeRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ReportedSpeechGradeResponse:
    """Grade one attempt — exact/variant match first, else LLM, else overlap."""
    candidates = [payload.reference, *(payload.accepted_variants or [])]
    matched = "llm"

    if matches_any(payload.user_answer, candidates):
        correct = True
        score = 100
        feedback = "Exact match — great work!"
        diffs: list[dict[str, str]] = []
        matched = (
            "exact"
            if normalize_text(payload.user_answer) == normalize_text(payload.reference)
            else "variant"
        )
    else:
        grade: dict[str, Any] | None = None
        try:
            service = get_copilot_service()
            user_prompt = (
                f"Direct: {payload.direct}\n"
                f"Reference: {payload.reference}\n"
                f"Accepted variants: {payload.accepted_variants}\n"
                f"Focus tags: {payload.focus_tags}\n"
                f"Student attempt: {payload.user_answer}\n"
                "Grade the student's attempt as reported speech."
            )
            raw = await service.ask_json(
                REPORTED_SPEECH_GRADE_SYSTEM, user_prompt
            )
            grade = _coerce_grade_payload(raw)
        except Exception as exc:  # noqa: BLE001
            logger.warning("reported-speech LLM grade failed: %s", exc)

        if grade is None:
            score = token_overlap_score(payload.user_answer, payload.reference)
            correct = score >= 80
            feedback = (
                "Close — compare with the reference answer."
                if correct
                else "Review the reference for the correct backshift/pronouns."
            )
            diffs = compute_diff_highlights(
                payload.user_answer, payload.reference
            )
            matched = "fallback"
        else:
            correct = bool(grade["correct"])
            score = int(grade["score"])
            feedback = str(grade["feedback"])
            diffs = list(grade["diff_highlights"])
            if not diffs:
                diffs = compute_diff_highlights(
                    payload.user_answer, payload.reference
                )

    # Persist (best-effort — never let a DB failure hide the grade).
    try:
        await dal.save_attempt(
            db,
            user_id="local",
            item_id=payload.item_id,
            direct=payload.direct,
            reference=payload.reference,
            user_answer=payload.user_answer,
            correct=correct,
            score=score,
            focus_tags=payload.focus_tags,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist reported-speech attempt")
        raise HTTPException(status_code=500, detail="Failed to save attempt")

    return ReportedSpeechGradeResponse(
        correct=correct,
        score=score,
        feedback=feedback,
        diff_highlights=[
            ReportedSpeechDiffHighlight(**d) for d in diffs
        ],
        matched=matched,
    )


@router.get("/weakness", response_model=ReportedSpeechWeaknessResponse)
async def get_weakness(
    limit: int = Query(default=20, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> ReportedSpeechWeaknessResponse:
    """Return focus tags with <70% accuracy over the latest `limit` attempts."""
    try:
        weak = await dal.get_recent_focus_weakness(
            db, user_id="local", limit=limit
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute reported-speech weakness")
        raise HTTPException(
            status_code=500, detail="Failed to compute weakness"
        )
    return ReportedSpeechWeaknessResponse(
        limit=limit,
        tags=[ReportedSpeechWeaknessTag(**w) for w in weak],
    )
