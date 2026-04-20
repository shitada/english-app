"""Listening Speed Ladder drill API.

A distinct 3-step progressive-comprehension drill: the same passage is
played 3 times at 0.8x, 1.0x, and 1.25x, with one MCQ after each speed.

Namespace: /api/speed-ladder/* with table speed_ladder_attempts. This is
deliberately separate from the existing `/api/listening/speed` max-speed
tracker to avoid any conflict.
"""

from __future__ import annotations

import hashlib
import logging
import random
import uuid
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.copilot_client import get_copilot_service
from app.dal import speed_ladder as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/speed-ladder", tags=["speed-ladder"])


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SPEEDS: list[float] = [0.8, 1.0, 1.25]


# ---------------------------------------------------------------------------
# Static fallback bank — robust local content when the LLM is unavailable.
# ---------------------------------------------------------------------------

_FALLBACK_ITEMS: list[dict[str, Any]] = [
    {
        "passage_text": (
            "Last weekend, Mia visited her grandmother in a small mountain "
            "village. The train ride took about three hours. When she "
            "arrived, her grandmother had already baked a warm apple pie. "
            "They spent the afternoon walking along a quiet forest path. "
            "Mia took many photos of the bright autumn leaves."
        ),
        "questions": [
            {
                "prompt": "Who did Mia visit?",
                "choices": [
                    "Her aunt",
                    "Her grandmother",
                    "Her cousin",
                    "A friend from school",
                ],
                "correct_index": 1,
                "explanation": "The passage says Mia visited her grandmother.",
            },
            {
                "prompt": "How long was the train ride?",
                "choices": [
                    "About three hours",
                    "About thirty minutes",
                    "About one hour",
                    "Almost all day",
                ],
                "correct_index": 0,
                "explanation": "It was about three hours.",
            },
            {
                "prompt": "What did they do in the afternoon?",
                "choices": [
                    "Cooked a big dinner",
                    "Watched a movie indoors",
                    "Walked on a forest path",
                    "Went shopping in town",
                ],
                "correct_index": 2,
                "explanation": "They walked along a quiet forest path.",
            },
        ],
    },
    {
        "passage_text": (
            "A new bakery opened last month near the main station. The "
            "owner used to be an engineer before changing careers. Her "
            "sourdough bread quickly became popular with commuters. On "
            "weekends, a line forms outside before the shop opens. The "
            "owner says she plans to hire two more bakers next month."
        ),
        "questions": [
            {
                "prompt": "What did the owner do before opening the bakery?",
                "choices": [
                    "She was a teacher",
                    "She was an engineer",
                    "She was a chef",
                    "She was a student",
                ],
                "correct_index": 1,
                "explanation": "She used to be an engineer.",
            },
            {
                "prompt": "Which bread became popular?",
                "choices": [
                    "Rye bread",
                    "White bread",
                    "Sourdough bread",
                    "Banana bread",
                ],
                "correct_index": 2,
                "explanation": "Her sourdough bread was mentioned.",
            },
            {
                "prompt": "What will she do next month?",
                "choices": [
                    "Close on weekends",
                    "Hire two more bakers",
                    "Open a second shop",
                    "Raise all prices",
                ],
                "correct_index": 1,
                "explanation": "She plans to hire two more bakers.",
            },
        ],
    },
    {
        "passage_text": (
            "Tom wanted to learn to play the guitar. He bought a cheap "
            "used instrument and watched free lessons online. After three "
            "months, he could play several simple songs. His neighbour, "
            "a retired music teacher, offered to give him weekly advice. "
            "By the end of the year, Tom performed at a local open mic."
        ),
        "questions": [
            {
                "prompt": "How did Tom start learning?",
                "choices": [
                    "He took private lessons",
                    "He joined a music school",
                    "He watched free lessons online",
                    "A friend taught him",
                ],
                "correct_index": 2,
                "explanation": "He watched free lessons online.",
            },
            {
                "prompt": "Who offered to help him?",
                "choices": [
                    "His cousin",
                    "A retired music teacher",
                    "A professional guitarist",
                    "His older brother",
                ],
                "correct_index": 1,
                "explanation": "His neighbour, a retired music teacher.",
            },
            {
                "prompt": "What did Tom do by the end of the year?",
                "choices": [
                    "Quit playing",
                    "Recorded an album",
                    "Performed at an open mic",
                    "Taught his own class",
                ],
                "correct_index": 2,
                "explanation": "He performed at a local open mic.",
            },
        ],
    },
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SpeedLadderQuestion(BaseModel):
    id: str
    prompt: str
    choices: list[str]
    correct_index: int = Field(ge=0, le=3)
    speed: float
    explanation: str = ""


class SpeedLadderStartResponse(BaseModel):
    session_id: str
    passage_text: str
    tts_audio_url: str | None = None
    questions: list[SpeedLadderQuestion]


class SpeedLadderAnswerRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=64)
    question_id: str = Field(..., min_length=1, max_length=64)
    choice_index: int = Field(..., ge=0, le=9)
    speed: float = Field(..., ge=0.25, le=3.0)
    correct_index: int = Field(..., ge=0, le=9)
    explanation: str = Field(default="", max_length=500)


class SpeedLadderAnswerResponse(BaseModel):
    correct: bool
    correct_index: int
    explanation: str


class SpeedLadderSpeedAccuracy(BaseModel):
    total: int
    correct: int
    accuracy: float


class SpeedLadderSessionHistory(BaseModel):
    session_id: str
    created_at: str
    total: int
    correct: int
    by_speed: dict[str, SpeedLadderSpeedAccuracy]


class SpeedLadderHistoryResponse(BaseModel):
    sessions: list[SpeedLadderSessionHistory]
    overall_by_speed: dict[str, SpeedLadderSpeedAccuracy]


# ---------------------------------------------------------------------------
# LLM prompt + parsing
# ---------------------------------------------------------------------------

def _speed_ladder_system_prompt() -> str:
    return (
        "You generate short English audio passages plus multiple-choice "
        "comprehension questions for a 'Speed Ladder' drill. The learner "
        "hears the same passage three times at increasing speeds (0.8x, "
        "1.0x, 1.25x) and answers ONE question after each playback.\n\n"
        "Return STRICT JSON of this exact shape:\n"
        '{ "passage_text": "...",'
        ' "questions": ['
        '   {"prompt": "...", "choices": ["A","B","C","D"],'
        '    "correct_index": 0, "explanation": "..."},'
        '   {"prompt": "...", "choices": ["A","B","C","D"],'
        '    "correct_index": 2, "explanation": "..."},'
        '   {"prompt": "...", "choices": ["A","B","C","D"],'
        '    "correct_index": 1, "explanation": "..."}'
        ' ] }\n\n'
        "Rules:\n"
        "- passage_text MUST be a coherent English passage of 3 to 5 "
        "sentences (~40-80 words). Use natural everyday vocabulary.\n"
        "- Return EXACTLY 3 questions, each with EXACTLY 4 choices.\n"
        "- Question 1 tests the MAIN IDEA / gist (easiest).\n"
        "- Question 2 tests a specific factual detail.\n"
        "- Question 3 tests an inference or less-central detail (hardest).\n"
        "- Distractors must be plausible but clearly wrong given the passage.\n"
        "- explanation is one short sentence justifying the correct answer.\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )


def _coerce_llm_payload(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    text = raw.get("passage_text")
    qs = raw.get("questions")
    if not isinstance(text, str) or not isinstance(qs, list):
        return None
    text = text.strip()
    if len(text) < 30 or len(text) > 1000:
        return None
    if len(qs) != 3:
        return None
    coerced_qs: list[dict[str, Any]] = []
    for q in qs:
        if not isinstance(q, dict):
            return None
        prompt = q.get("prompt")
        choices = q.get("choices")
        ci = q.get("correct_index")
        if not isinstance(prompt, str) or not prompt.strip():
            return None
        if not isinstance(choices, list) or len(choices) != 4:
            return None
        choices = [str(c).strip() for c in choices]
        if not all(choices):
            return None
        try:
            ci = int(ci)
        except (TypeError, ValueError):
            return None
        if not (0 <= ci < 4):
            return None
        explanation = str(q.get("explanation", "")).strip()[:300]
        coerced_qs.append(
            {
                "prompt": prompt.strip(),
                "choices": choices,
                "correct_index": ci,
                "explanation": explanation,
            }
        )
    return {"passage_text": text, "questions": coerced_qs}


def _question_id(session_id: str, speed: float, index: int) -> str:
    raw = f"{session_id}:{speed}:{index}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def _build_response_from_item(item: dict[str, Any]) -> dict[str, Any]:
    """Attach a session_id + per-question ids+speeds to an item payload."""
    session_id = uuid.uuid4().hex[:16]
    questions: list[dict[str, Any]] = []
    for idx, q in enumerate(item["questions"]):
        speed = SPEEDS[idx] if idx < len(SPEEDS) else SPEEDS[-1]
        questions.append(
            {
                "id": _question_id(session_id, speed, idx),
                "prompt": q["prompt"],
                "choices": list(q["choices"]),
                "correct_index": int(q["correct_index"]),
                "speed": speed,
                "explanation": q.get("explanation", ""),
            }
        )
    return {
        "session_id": session_id,
        "passage_text": item["passage_text"],
        "tts_audio_url": None,  # Frontend uses SpeechSynthesis with playbackRate.
        "questions": questions,
    }


def _fallback_payload() -> dict[str, Any]:
    return _build_response_from_item(random.choice(_FALLBACK_ITEMS))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/start", response_model=SpeedLadderStartResponse)
async def start_session() -> SpeedLadderStartResponse:
    """Generate a new passage + 3 MCQs for the Speed Ladder drill."""
    payload: dict[str, Any] | None = None
    try:
        service = get_copilot_service()
        raw = await service.ask_json(
            _speed_ladder_system_prompt(),
            "Generate one Speed Ladder drill passage plus 3 MCQ questions.",
        )
        coerced = _coerce_llm_payload(raw)
        if coerced is not None:
            payload = _build_response_from_item(coerced)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "speed-ladder generation failed, using static fallback: %s", exc
        )

    if payload is None:
        payload = _fallback_payload()

    return SpeedLadderStartResponse(
        session_id=payload["session_id"],
        passage_text=payload["passage_text"],
        tts_audio_url=payload.get("tts_audio_url"),
        questions=[SpeedLadderQuestion(**q) for q in payload["questions"]],
    )


@router.post("/answer", response_model=SpeedLadderAnswerResponse)
async def submit_answer(
    payload: SpeedLadderAnswerRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SpeedLadderAnswerResponse:
    """Record one answer attempt and return correctness + explanation."""
    is_correct = int(payload.choice_index) == int(payload.correct_index)
    try:
        await dal.record_attempt(
            db,
            session_id=payload.session_id,
            speed=float(payload.speed),
            correct=bool(is_correct),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist speed-ladder attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")

    return SpeedLadderAnswerResponse(
        correct=is_correct,
        correct_index=int(payload.correct_index),
        explanation=payload.explanation or "",
    )


@router.get("/history", response_model=SpeedLadderHistoryResponse)
async def get_history(
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> SpeedLadderHistoryResponse:
    """Return per-session per-speed accuracy plus an overall speed aggregate."""
    try:
        sessions = await dal.get_session_history(db, limit=limit)
        overall = await dal.get_overall_by_speed(db)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to fetch speed-ladder history")
        raise HTTPException(status_code=500, detail="Failed to fetch history")

    sess_models = [
        SpeedLadderSessionHistory(
            session_id=s["session_id"],
            created_at=s["created_at"],
            total=s["total"],
            correct=s["correct"],
            by_speed={
                k: SpeedLadderSpeedAccuracy(**v) for k, v in s["by_speed"].items()
            },
        )
        for s in sessions
    ]
    overall_models = {
        k: SpeedLadderSpeedAccuracy(**v) for k, v in overall.items()
    }
    return SpeedLadderHistoryResponse(
        sessions=sess_models,
        overall_by_speed=overall_models,
    )
