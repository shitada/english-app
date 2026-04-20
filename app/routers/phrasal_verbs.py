"""Phrasal Verb Particle Drill API.

Typing-based productive recall drill for common English phrasal verbs.

Users see a definition + example sentence with the particle blanked
(e.g. "Please turn ____ the lights.") and must TYPE the missing
particle (e.g. "off"). This trains spelling and productive recall.

Endpoints
---------
    GET  /api/phrasal-verbs/drill?count=10&level=beginner|intermediate|advanced
        → shuffled selection of items from a curated bank.
    POST /api/phrasal-verbs/attempt {id, user_answer, correct}
        → fire-and-forget logging. Always 200 with {"ok": True} unless the
          payload is malformed.

No DB schema changes — attempts are logged via the standard application
logger only.
"""

from __future__ import annotations

import logging
import random
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/phrasal-verbs", tags=["phrasal-verbs"])


LEVELS = ("beginner", "intermediate", "advanced")


def _item(
    item_id: str,
    verb: str,
    particle: str,
    meaning: str,
    example_full: str,
    example_with_blank: str,
    level: str,
    accepted: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "verb": verb,
        "particle": particle,
        "meaning": meaning,
        "example_full": example_full,
        "example_with_blank": example_with_blank,
        "level": level,
        "accepted": list(accepted or []),
    }


# ---------------------------------------------------------------------------
# Curated bank — ~60 common phrasal verbs across three levels.
# The blank in example_with_blank is represented by "____" (4 underscores).
# `accepted` lists optional synonym particles that should also be graded
# as correct (used by the frontend). The primary `particle` is always
# considered correct on its own.
# ---------------------------------------------------------------------------
_BANK: list[dict[str, Any]] = [
    # ------------------ beginner (22) ------------------
    _item("b01", "turn", "off", "stop a device/light from running",
          "Please turn off the lights when you leave.",
          "Please turn ____ the lights when you leave.",
          "beginner"),
    _item("b02", "turn", "on", "start a device/light",
          "Can you turn on the TV?",
          "Can you turn ____ the TV?",
          "beginner"),
    _item("b03", "get", "up", "rise from bed in the morning",
          "I usually get up at seven.",
          "I usually get ____ at seven.",
          "beginner"),
    _item("b04", "sit", "down", "take a seat",
          "Please sit down and relax.",
          "Please sit ____ and relax.",
          "beginner"),
    _item("b05", "stand", "up", "rise to one's feet",
          "Everyone had to stand up when the judge entered.",
          "Everyone had to stand ____ when the judge entered.",
          "beginner"),
    _item("b06", "wake", "up", "stop sleeping",
          "I wake up at six every morning.",
          "I wake ____ at six every morning.",
          "beginner"),
    _item("b07", "put", "on", "dress oneself in clothing",
          "It's cold — put on your coat.",
          "It's cold — put ____ your coat.",
          "beginner"),
    _item("b08", "take", "off", "remove clothing",
          "Please take off your shoes at the door.",
          "Please take ____ your shoes at the door.",
          "beginner"),
    _item("b09", "pick", "up", "collect something or someone",
          "I'll pick up the kids from school.",
          "I'll pick ____ the kids from school.",
          "beginner"),
    _item("b10", "come", "back", "return",
          "She'll come back tomorrow.",
          "She'll come ____ tomorrow.",
          "beginner"),
    _item("b11", "go", "out", "leave the house socially",
          "We're going out for dinner tonight.",
          "We're going ____ for dinner tonight.",
          "beginner"),
    _item("b12", "look", "at", "direct one's gaze toward",
          "Look at this photo — isn't it great?",
          "Look ____ this photo — isn't it great?",
          "beginner"),
    _item("b13", "look", "for", "search for",
          "I'm looking for my keys.",
          "I'm looking ____ my keys.",
          "beginner"),
    _item("b14", "wait", "for", "remain until something/somebody arrives",
          "I'll wait for you outside.",
          "I'll wait ____ you outside.",
          "beginner"),
    _item("b15", "write", "down", "record in writing",
          "Write down your phone number here.",
          "Write ____ your phone number here.",
          "beginner"),
    _item("b16", "clean", "up", "tidy a mess",
          "Please clean up your room.",
          "Please clean ____ your room.",
          "beginner"),
    _item("b17", "throw", "away", "discard",
          "Don't throw away those old photos.",
          "Don't throw ____ those old photos.",
          "beginner", ["out"]),
    _item("b18", "try", "on", "test clothing for fit",
          "Can I try on these jeans?",
          "Can I try ____ these jeans?",
          "beginner"),
    _item("b19", "give", "up", "stop trying / quit",
          "Don't give up — you're almost there.",
          "Don't give ____ — you're almost there.",
          "beginner"),
    _item("b20", "find", "out", "discover",
          "I just found out she's moving to Paris.",
          "I just found ____ she's moving to Paris.",
          "beginner"),
    _item("b21", "grow", "up", "mature from childhood",
          "I grew up in a small town.",
          "I grew ____ in a small town.",
          "beginner"),
    _item("b22", "hang", "up", "end a phone call",
          "She hung up before I could reply.",
          "She hung ____ before I could reply.",
          "beginner"),

    # ------------------ intermediate (24) ------------------
    _item("i01", "look", "up", "search for info (e.g. in a dictionary)",
          "I'll look up the word in a dictionary.",
          "I'll look ____ the word in a dictionary.",
          "intermediate"),
    _item("i02", "run", "into", "meet unexpectedly",
          "I ran into an old friend at the store.",
          "I ran ____ an old friend at the store.",
          "intermediate"),
    _item("i03", "break", "down", "stop functioning (machines)",
          "My car broke down on the highway.",
          "My car broke ____ on the highway.",
          "intermediate"),
    _item("i04", "bring", "up", "mention a topic",
          "Don't bring up politics at dinner.",
          "Don't bring ____ politics at dinner.",
          "intermediate"),
    _item("i05", "call", "off", "cancel",
          "They called off the meeting at the last minute.",
          "They called ____ the meeting at the last minute.",
          "intermediate"),
    _item("i06", "check", "out", "investigate / leave a hotel",
          "You should check out that new cafe.",
          "You should check ____ that new cafe.",
          "intermediate"),
    _item("i07", "fill", "out", "complete (a form)",
          "Please fill out this application.",
          "Please fill ____ this application.",
          "intermediate", ["in"]),
    _item("i08", "figure", "out", "solve / understand",
          "I can't figure out this puzzle.",
          "I can't figure ____ this puzzle.",
          "intermediate"),
    _item("i09", "get", "along", "have a good relationship",
          "They get along really well.",
          "They get ____ really well.",
          "intermediate"),
    _item("i10", "give", "back", "return something",
          "Can you give back my book?",
          "Can you give ____ my book?",
          "intermediate"),
    _item("i11", "hand", "in", "submit",
          "Please hand in your essays on Friday.",
          "Please hand ____ your essays on Friday.",
          "intermediate"),
    _item("i12", "hold", "on", "wait a moment",
          "Hold on — I'll be right back.",
          "Hold ____ — I'll be right back.",
          "intermediate"),
    _item("i13", "keep", "up", "maintain pace",
          "I can't keep up with the latest news.",
          "I can't keep ____ with the latest news.",
          "intermediate"),
    _item("i14", "make", "up", "invent (a story) / reconcile",
          "He made up a silly excuse.",
          "He made ____ a silly excuse.",
          "intermediate"),
    _item("i15", "put", "off", "postpone",
          "Don't put off your homework until tomorrow.",
          "Don't put ____ your homework until tomorrow.",
          "intermediate"),
    _item("i16", "run", "out", "exhaust a supply",
          "We ran out of milk this morning.",
          "We ran ____ of milk this morning.",
          "intermediate"),
    _item("i17", "show", "up", "arrive / appear",
          "He showed up late to the meeting.",
          "He showed ____ late to the meeting.",
          "intermediate"),
    _item("i18", "take", "over", "assume control",
          "A new manager will take over next month.",
          "A new manager will take ____ next month.",
          "intermediate"),
    _item("i19", "turn", "down", "refuse / reduce volume",
          "She turned down the job offer.",
          "She turned ____ the job offer.",
          "intermediate"),
    _item("i20", "work", "out", "exercise / resolve",
          "I work out three times a week.",
          "I work ____ three times a week.",
          "intermediate"),
    _item("i21", "set", "up", "arrange / install",
          "We need to set up the projector.",
          "We need to set ____ the projector.",
          "intermediate"),
    _item("i22", "come", "across", "encounter by chance",
          "I came across an interesting article.",
          "I came ____ an interesting article.",
          "intermediate"),
    _item("i23", "get", "over", "recover from",
          "It took her weeks to get over the flu.",
          "It took her weeks to get ____ the flu.",
          "intermediate"),
    _item("i24", "go", "through", "experience (often difficult)",
          "She's going through a tough time.",
          "She's going ____ a tough time.",
          "intermediate"),

    # ------------------ advanced (16) ------------------
    _item("a01", "put", "up with", "tolerate",
          "I can't put up with this noise any longer.",
          "I can't put ____ this noise any longer.",
          "advanced"),
    _item("a02", "look", "forward to", "anticipate eagerly",
          "I look forward to your reply.",
          "I look ____ your reply.",
          "advanced"),
    _item("a03", "come", "up with", "invent / think of",
          "She came up with a brilliant idea.",
          "She came ____ a brilliant idea.",
          "advanced"),
    _item("a04", "get", "away with", "escape punishment for",
          "He got away with cheating on the test.",
          "He got ____ cheating on the test.",
          "advanced"),
    _item("a05", "run", "out of", "exhaust a supply of",
          "We're running out of time.",
          "We're running ____ time.",
          "advanced"),
    _item("a06", "back", "out of", "withdraw from a commitment",
          "He backed out of the deal at the last minute.",
          "He backed ____ the deal at the last minute.",
          "advanced"),
    _item("a07", "cut", "down on", "reduce consumption of",
          "I'm trying to cut down on sugar.",
          "I'm trying to cut ____ sugar.",
          "advanced", ["back on"]),
    _item("a08", "keep", "up with", "stay informed/at pace with",
          "It's hard to keep up with the news.",
          "It's hard to keep ____ the news.",
          "advanced"),
    _item("a09", "look", "down on", "regard with contempt",
          "Don't look down on people with less experience.",
          "Don't look ____ people with less experience.",
          "advanced"),
    _item("a10", "stand", "up for", "defend",
          "You should stand up for what you believe in.",
          "You should stand ____ what you believe in.",
          "advanced"),
    _item("a11", "come", "down with", "become ill with",
          "I think I'm coming down with a cold.",
          "I think I'm coming ____ a cold.",
          "advanced"),
    _item("a12", "get", "through to", "reach / communicate with",
          "I couldn't get through to him on the phone.",
          "I couldn't get ____ him on the phone.",
          "advanced"),
    _item("a13", "fall", "back on", "resort to (as backup)",
          "If the plan fails, we can fall back on savings.",
          "If the plan fails, we can fall ____ savings.",
          "advanced"),
    _item("a14", "live", "up to", "meet (expectations)",
          "The movie didn't live up to the hype.",
          "The movie didn't live ____ the hype.",
          "advanced"),
    _item("a15", "do", "away with", "abolish / get rid of",
          "They did away with the old rules.",
          "They did ____ the old rules.",
          "advanced"),
    _item("a16", "make", "up for", "compensate for",
          "I'll make up for the missed class next week.",
          "I'll make ____ the missed class next week.",
          "advanced"),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PhrasalVerbItem(BaseModel):
    id: str
    verb: str
    particle: str
    meaning: str
    example_full: str
    example_with_blank: str
    level: str
    accepted: list[str] = Field(default_factory=list)


class PhrasalVerbDrillResponse(BaseModel):
    level: str
    items: list[PhrasalVerbItem]


class PhrasalVerbAttemptRequest(BaseModel):
    id: str
    user_answer: str
    correct: bool


class PhrasalVerbAttemptResponse(BaseModel):
    ok: bool = True


# ---------------------------------------------------------------------------
# Helpers (pure, testable)
# ---------------------------------------------------------------------------

def build_drill(
    count: int = 10,
    level: str = "beginner",
    seed: int | None = None,
) -> dict[str, Any]:
    """Return a shuffled drill of `count` items for `level`.

    Invalid levels fall back to 'beginner'. `count` is clamped [1, 30].
    """
    level_norm = level if level in LEVELS else "beginner"
    count = max(1, min(int(count), 30))

    pool = [it for it in _BANK if it["level"] == level_norm]
    rng = random.Random(seed)
    rng.shuffle(pool)

    picked = pool[:count]
    return {"level": level_norm, "items": picked}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/drill", response_model=PhrasalVerbDrillResponse)
async def get_drill(
    count: int = Query(default=10, ge=1, le=30),
    level: str = Query(default="beginner"),
) -> PhrasalVerbDrillResponse:
    """Return a shuffled drill from the curated phrasal-verb bank."""
    data = build_drill(count=count, level=level)
    return PhrasalVerbDrillResponse(
        level=data["level"],
        items=[PhrasalVerbItem(**it) for it in data["items"]],
    )


@router.post("/attempt", response_model=PhrasalVerbAttemptResponse)
async def post_attempt(
    payload: PhrasalVerbAttemptRequest,
) -> PhrasalVerbAttemptResponse:
    """Fire-and-forget attempt logging (no DB persistence)."""
    try:
        logger.info(
            "phrasal_verbs.attempt id=%s correct=%s answer=%r",
            payload.id,
            payload.correct,
            (payload.user_answer or "")[:40],
        )
    except Exception:  # noqa: BLE001 — logging must never fail the request
        logger.exception("Failed to log phrasal-verb attempt")
        raise HTTPException(status_code=500, detail="Failed to log attempt")
    return PhrasalVerbAttemptResponse(ok=True)
