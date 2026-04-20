"""Linker Speak Drill API.

Trains cohesive connectors (however, therefore, although, because, meanwhile,
in fact, on the other hand, so, as a result, even though).

Flow per round (default 5 items):
    1. Frontend shows two short sentences + 4 connector chips.
    2. User picks the most natural connector → correctness + 1-line note.
    3. Combined sentence shown with Listen + Speak buttons; the frontend scores
       speech-vs-target via case-insensitive token Jaccard (0–100) and POSTs.

Items come from a static curated bank covering 5 categories:
    contrast, cause, addition, time, result.
"""

from __future__ import annotations

import logging
import random
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dal import linker_drill as dal
from app.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/linker-drill", tags=["linker-drill"])


# Connector taxonomy
CATEGORIES = ["contrast", "cause", "addition", "time", "result"]

CATEGORY_CONNECTORS: dict[str, list[str]] = {
    "contrast": ["however", "although", "even though", "on the other hand"],
    "cause": ["because", "since", "as", "due to the fact that"],
    "addition": ["in addition", "moreover", "in fact", "furthermore"],
    "time": ["meanwhile", "afterwards", "before that", "at the same time"],
    "result": ["therefore", "so", "as a result", "consequently"],
}


def _item(
    item_id: str,
    s1: str,
    s2: str,
    correct: str,
    combined: str,
    explanation: str,
    category: str,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "sentence_a": s1,
        "sentence_b": s2,
        "correct_linker": correct,
        "combined_sentence": combined,
        "explanation": explanation,
        "category": category,
    }


_BANK: list[dict[str, Any]] = [
    # ----- contrast -----
    _item("c01", "I studied hard.", "I failed the test.",
          "however",
          "I studied hard; however, I failed the test.",
          "Two clauses contrast an expectation with the outcome.",
          "contrast"),
    _item("c02", "She is very talented.", "She rarely practices.",
          "although",
          "Although she is very talented, she rarely practices.",
          "'Although' concedes a point that contrasts with the main idea.",
          "contrast"),
    _item("c03", "The hotel looked beautiful.", "The service was terrible.",
          "however",
          "The hotel looked beautiful; however, the service was terrible.",
          "Use 'however' to contrast a positive with a negative observation.",
          "contrast"),
    _item("c04", "He had no experience.", "He got the job.",
          "even though",
          "Even though he had no experience, he got the job.",
          "'Even though' stresses a stronger contrast than 'although'.",
          "contrast"),
    _item("c05", "Some people enjoy crowded cities.",
          "Others prefer the countryside.",
          "on the other hand",
          "Some people enjoy crowded cities; on the other hand, others prefer the countryside.",
          "'On the other hand' presents an alternative viewpoint.",
          "contrast"),
    _item("c06", "The plan sounds reasonable.", "It is too expensive.",
          "however",
          "The plan sounds reasonable; however, it is too expensive.",
          "Use 'however' when something positive is followed by a problem.",
          "contrast"),
    _item("c07", "It was raining heavily.", "We went for a walk.",
          "although",
          "Although it was raining heavily, we went for a walk.",
          "Concession of weather vs. action.",
          "contrast"),
    _item("c08", "He apologised.", "She refused to forgive him.",
          "even though",
          "Even though he apologised, she refused to forgive him.",
          "Stronger concession with 'even though'.",
          "contrast"),
    # ----- cause -----
    _item("u01", "We cancelled the picnic.", "It started raining.",
          "because",
          "We cancelled the picnic because it started raining.",
          "'Because' introduces the direct reason for an action.",
          "cause"),
    _item("u02", "She was promoted.", "She had outperformed her peers.",
          "because",
          "She was promoted because she had outperformed her peers.",
          "'Because' links the result to its cause.",
          "cause"),
    _item("u03", "I'll make dinner tonight.", "You're tired from work.",
          "since",
          "I'll make dinner tonight since you're tired from work.",
          "'Since' gives a known/obvious reason.",
          "cause"),
    _item("u04", "The flight was delayed.", "There was heavy fog.",
          "because",
          "The flight was delayed because there was heavy fog.",
          "Direct causal explanation.",
          "cause"),
    _item("u05", "We started early.", "We wanted to beat the traffic.",
          "because",
          "We started early because we wanted to beat the traffic.",
          "Reason for an action.",
          "cause"),
    _item("u06", "We ordered takeout.", "Nobody felt like cooking.",
          "since",
          "We ordered takeout since nobody felt like cooking.",
          "'Since' suits a casually known reason.",
          "cause"),
    _item("u07", "The library closed early.", "It was a public holiday.",
          "because",
          "The library closed early because it was a public holiday.",
          "Causal connector for a factual reason.",
          "cause"),
    _item("u08", "He couldn't attend the meeting.", "His train was cancelled.",
          "because",
          "He couldn't attend the meeting because his train was cancelled.",
          "Direct cause-and-effect link.",
          "cause"),
    # ----- addition -----
    _item("a01", "The proposal saves money.", "It improves quality.",
          "in addition",
          "The proposal saves money. In addition, it improves quality.",
          "'In addition' adds a second positive point.",
          "addition"),
    _item("a02", "She speaks three languages.",
          "She has lived on four continents.",
          "moreover",
          "She speaks three languages. Moreover, she has lived on four continents.",
          "'Moreover' adds a stronger reinforcing fact.",
          "addition"),
    _item("a03", "The book is well written.", "It is genuinely funny.",
          "in fact",
          "The book is well written. In fact, it is genuinely funny.",
          "'In fact' adds a stronger or more specific point.",
          "addition"),
    _item("a04", "He is a talented engineer.",
          "He mentors others on the team.",
          "in addition",
          "He is a talented engineer. In addition, he mentors others on the team.",
          "Adds another quality of the same person.",
          "addition"),
    _item("a05", "The product is affordable.",
          "It comes with a long warranty.",
          "moreover",
          "The product is affordable. Moreover, it comes with a long warranty.",
          "'Moreover' stacks an additional selling point.",
          "addition"),
    _item("a06", "The route is scenic.", "It is the fastest way there.",
          "in fact",
          "The route is scenic. In fact, it is the fastest way there.",
          "'In fact' adds a surprising stronger point.",
          "addition"),
    _item("a07", "The course covers grammar.",
          "It includes pronunciation drills.",
          "in addition",
          "The course covers grammar. In addition, it includes pronunciation drills.",
          "Adds a second feature of the course.",
          "addition"),
    _item("a08", "He was on time.", "He brought everything we needed.",
          "moreover",
          "He was on time. Moreover, he brought everything we needed.",
          "Stronger additive linker.",
          "addition"),
    # ----- time -----
    _item("t01", "I was cooking dinner.", "My partner set the table.",
          "meanwhile",
          "I was cooking dinner; meanwhile, my partner set the table.",
          "'Meanwhile' links two simultaneous actions.",
          "time"),
    _item("t02", "The teacher explained the rule.", "The students took notes.",
          "meanwhile",
          "The teacher explained the rule; meanwhile, the students took notes.",
          "Two parallel actions happening at the same time.",
          "time"),
    _item("t03", "She finished her homework.", "She watched a movie.",
          "afterwards",
          "She finished her homework; afterwards, she watched a movie.",
          "'Afterwards' marks the next event in time.",
          "time"),
    _item("t04", "We toured the museum.", "We had visited the cathedral.",
          "before that",
          "We toured the museum. Before that, we had visited the cathedral.",
          "'Before that' refers to an earlier event.",
          "time"),
    _item("t05", "The chef prepared the sauce.",
          "The assistant chopped the vegetables.",
          "at the same time",
          "The chef prepared the sauce; at the same time, the assistant chopped the vegetables.",
          "Explicitly simultaneous actions.",
          "time"),
    _item("t06", "He sent the email.", "He went to bed.",
          "afterwards",
          "He sent the email; afterwards, he went to bed.",
          "Sequential events, second after first.",
          "time"),
    _item("t07", "We celebrated our anniversary.",
          "We had taken a long walk on the beach.",
          "before that",
          "We celebrated our anniversary. Before that, we had taken a long walk on the beach.",
          "Refers back to an earlier event.",
          "time"),
    _item("t08", "Our team launched the product.",
          "Marketing prepared the campaign.",
          "meanwhile",
          "Our team launched the product; meanwhile, marketing prepared the campaign.",
          "Two parallel workstreams.",
          "time"),
    # ----- result -----
    _item("r01", "The road was closed.", "We had to take a detour.",
          "so",
          "The road was closed, so we had to take a detour.",
          "'So' introduces a direct, conversational result.",
          "result"),
    _item("r02", "The new policy was unpopular.", "It was withdrawn.",
          "as a result",
          "The new policy was unpopular; as a result, it was withdrawn.",
          "'As a result' marks a clear consequence.",
          "result"),
    _item("r03", "Sales dropped sharply this quarter.", "We must cut costs.",
          "therefore",
          "Sales dropped sharply this quarter; therefore, we must cut costs.",
          "'Therefore' is a formal logical consequence.",
          "result"),
    _item("r04", "The bridge collapsed.", "Traffic was rerouted for weeks.",
          "as a result",
          "The bridge collapsed; as a result, traffic was rerouted for weeks.",
          "Real-world consequence linker.",
          "result"),
    _item("r05", "I forgot my umbrella.", "I got soaked on the way home.",
          "so",
          "I forgot my umbrella, so I got soaked on the way home.",
          "'So' for a casual everyday consequence.",
          "result"),
    _item("r06", "The evidence was inconclusive.", "The case was dismissed.",
          "therefore",
          "The evidence was inconclusive; therefore, the case was dismissed.",
          "Formal logical conclusion.",
          "result"),
    _item("r07", "The company missed its targets.", "The CEO resigned.",
          "consequently",
          "The company missed its targets; consequently, the CEO resigned.",
          "'Consequently' marks a formal consequence.",
          "result"),
    _item("r08", "We finished early.", "We caught an earlier flight.",
          "so",
          "We finished early, so we caught an earlier flight.",
          "Casual consequence linker.",
          "result"),
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class LinkerDrillItem(BaseModel):
    id: str
    sentence_a: str
    sentence_b: str
    options: list[str]
    correct_linker: str
    combined_sentence: str
    explanation: str
    category: str


class LinkerDrillRoundResponse(BaseModel):
    items: list[LinkerDrillItem]


class LinkerDrillAttemptRequest(BaseModel):
    item_id: str
    chosen_linker: str
    correct_linker: str
    is_correct: bool
    category: str
    spoken_similarity: float | None = Field(default=None, ge=0.0, le=100.0)


class LinkerDrillAttemptResponse(BaseModel):
    id: int
    is_correct: bool


class LinkerDrillCategoryStats(BaseModel):
    total: int
    accuracy: float
    avg_similarity: float | None


class LinkerDrillStatsResponse(BaseModel):
    total: int
    overall_accuracy: float
    avg_similarity: float | None
    by_category: dict[str, LinkerDrillCategoryStats]
    weakest_category: str | None


# ---------------------------------------------------------------------------
# Helpers (pure)
# ---------------------------------------------------------------------------

def _build_options(item: dict[str, Any], rng: random.Random) -> list[str]:
    """Return 4 connector options containing the correct one.

    Mostly drawn from the same category to keep the choice meaningful, with
    one distractor from a different category for variety.
    """
    correct = item["correct_linker"]
    same_cat = [c for c in CATEGORY_CONNECTORS[item["category"]] if c != correct]
    rng.shuffle(same_cat)
    picked = [correct] + same_cat[:2]

    other_cats = [c for c in CATEGORIES if c != item["category"]]
    rng.shuffle(other_cats)
    distractor_pool = CATEGORY_CONNECTORS[other_cats[0]]
    distractor = rng.choice(distractor_pool)
    while distractor in picked:
        distractor = rng.choice(distractor_pool)
    picked.append(distractor)

    rng.shuffle(picked)
    return picked


def build_round(count: int = 5, seed: int | None = None) -> list[dict[str, Any]]:
    """Pick `count` items balanced across categories. Pure helper for tests."""
    count = max(1, min(int(count), 20))
    rng = random.Random(seed)

    by_cat: dict[str, list[dict[str, Any]]] = {c: [] for c in CATEGORIES}
    for it in _BANK:
        by_cat[it["category"]].append(it)
    for bucket in by_cat.values():
        rng.shuffle(bucket)

    chosen: list[dict[str, Any]] = []
    cats_cycle = list(CATEGORIES)
    rng.shuffle(cats_cycle)
    idx = 0
    while len(chosen) < count:
        cat = cats_cycle[idx % len(cats_cycle)]
        if by_cat[cat]:
            chosen.append(by_cat[cat].pop())
        elif all(not bucket for bucket in by_cat.values()):
            break
        idx += 1

    out: list[dict[str, Any]] = []
    for it in chosen:
        out.append({**it, "options": _build_options(it, rng)})
    return out


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/round", response_model=LinkerDrillRoundResponse)
async def get_round(
    count: int = Query(default=5, ge=1, le=20),
) -> LinkerDrillRoundResponse:
    """Return a balanced round of items (default 5)."""
    items = build_round(count=count)
    return LinkerDrillRoundResponse(
        items=[LinkerDrillItem(**it) for it in items]
    )


@router.post("/attempt", response_model=LinkerDrillAttemptResponse)
async def submit_attempt(
    payload: LinkerDrillAttemptRequest,
    db: aiosqlite.Connection = Depends(get_db_session),
) -> LinkerDrillAttemptResponse:
    """Persist one drill attempt."""
    category = payload.category if payload.category in CATEGORIES else "contrast"
    try:
        new_id = await dal.record_attempt(
            db,
            item_id=payload.item_id,
            chosen_linker=payload.chosen_linker,
            correct_linker=payload.correct_linker,
            is_correct=bool(payload.is_correct),
            category=category,
            spoken_similarity=payload.spoken_similarity,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record linker-drill attempt")
        raise HTTPException(status_code=500, detail="Failed to record attempt")
    return LinkerDrillAttemptResponse(id=new_id, is_correct=payload.is_correct)


@router.get("/stats", response_model=LinkerDrillStatsResponse)
async def get_stats(
    limit: int = Query(default=50, ge=1, le=500),
    db: aiosqlite.Connection = Depends(get_db_session),
) -> LinkerDrillStatsResponse:
    """Return recent overall + per-category accuracy and weakest category."""
    try:
        stats = await dal.get_recent_stats(db, limit=limit)
        weakest = await dal.get_weakest_category(db, limit=limit)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to compute linker-drill stats")
        raise HTTPException(status_code=500, detail="Failed to compute stats")

    by_cat = {
        cat: LinkerDrillCategoryStats(**info)
        for cat, info in stats["by_category"].items()
    }
    return LinkerDrillStatsResponse(
        total=stats["total"],
        overall_accuracy=stats["overall_accuracy"],
        avg_similarity=stats["avg_similarity"],
        by_category=by_cat,
        weakest_category=weakest,
    )
