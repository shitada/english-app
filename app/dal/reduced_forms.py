"""DAL + curated seed list for the Reduced Forms drill.

Each seed item contains:
  - id: stable string id
  - reduction_type: short tag (gonna / wanna / gotta / hafta / lemme / dunno /
    coulda-shoulda-woulda / t-flap / schwa)
  - reduced_text: how it sounds in connected speech
  - full_text: the citation / written form (used for grading the Expand step)
  - focus_chunks: words/phrases the learner should produce as the reduced form
"""

from __future__ import annotations

import random
from typing import Any

import aiosqlite


# ---------------------------------------------------------------------------
# Curated seed list. >= 30 items, >= 5 reduction types.
# ---------------------------------------------------------------------------

SEED_ITEMS: list[dict[str, Any]] = [
    # gonna (going to)
    {"id": "gonna-01", "reduction_type": "gonna",
     "reduced_text": "I'm gonna grab a coffee, wanna come?",
     "full_text": "I am going to grab a coffee, do you want to come?",
     "focus_chunks": ["gonna", "wanna"]},
    {"id": "gonna-02", "reduction_type": "gonna",
     "reduced_text": "She's gonna call you back later.",
     "full_text": "She is going to call you back later.",
     "focus_chunks": ["gonna"]},
    {"id": "gonna-03", "reduction_type": "gonna",
     "reduced_text": "We're gonna miss the bus if we don't hurry.",
     "full_text": "We are going to miss the bus if we do not hurry.",
     "focus_chunks": ["gonna"]},
    {"id": "gonna-04", "reduction_type": "gonna",
     "reduced_text": "What're you gonna do this weekend?",
     "full_text": "What are you going to do this weekend?",
     "focus_chunks": ["gonna"]},

    # wanna (want to / want a)
    {"id": "wanna-01", "reduction_type": "wanna",
     "reduced_text": "I wanna learn how to surf.",
     "full_text": "I want to learn how to surf.",
     "focus_chunks": ["wanna"]},
    {"id": "wanna-02", "reduction_type": "wanna",
     "reduced_text": "Do you wanna grab dinner tonight?",
     "full_text": "Do you want to grab dinner tonight?",
     "focus_chunks": ["wanna"]},
    {"id": "wanna-03", "reduction_type": "wanna",
     "reduced_text": "I don't wanna talk about it right now.",
     "full_text": "I do not want to talk about it right now.",
     "focus_chunks": ["wanna"]},

    # gotta (got to / have got to)
    {"id": "gotta-01", "reduction_type": "gotta",
     "reduced_text": "I gotta finish this report by five.",
     "full_text": "I have got to finish this report by five.",
     "focus_chunks": ["gotta"]},
    {"id": "gotta-02", "reduction_type": "gotta",
     "reduced_text": "You gotta try the new ramen place.",
     "full_text": "You have got to try the new ramen place.",
     "focus_chunks": ["gotta"]},
    {"id": "gotta-03", "reduction_type": "gotta",
     "reduced_text": "We gotta leave in ten minutes.",
     "full_text": "We have got to leave in ten minutes.",
     "focus_chunks": ["gotta"]},

    # hafta / hasta (have to / has to)
    {"id": "hafta-01", "reduction_type": "hafta",
     "reduced_text": "I hafta wake up early tomorrow.",
     "full_text": "I have to wake up early tomorrow.",
     "focus_chunks": ["hafta"]},
    {"id": "hafta-02", "reduction_type": "hafta",
     "reduced_text": "She hasta pick up her sister at three.",
     "full_text": "She has to pick up her sister at three.",
     "focus_chunks": ["hasta"]},
    {"id": "hafta-03", "reduction_type": "hafta",
     "reduced_text": "Do we hafta bring anything?",
     "full_text": "Do we have to bring anything?",
     "focus_chunks": ["hafta"]},

    # lemme (let me)
    {"id": "lemme-01", "reduction_type": "lemme",
     "reduced_text": "Lemme know when you're ready.",
     "full_text": "Let me know when you are ready.",
     "focus_chunks": ["lemme"]},
    {"id": "lemme-02", "reduction_type": "lemme",
     "reduced_text": "Lemme see what I can do.",
     "full_text": "Let me see what I can do.",
     "focus_chunks": ["lemme"]},
    {"id": "lemme-03", "reduction_type": "lemme",
     "reduced_text": "Just lemme grab my jacket real quick.",
     "full_text": "Just let me grab my jacket real quick.",
     "focus_chunks": ["lemme"]},

    # dunno (don't know)
    {"id": "dunno-01", "reduction_type": "dunno",
     "reduced_text": "I dunno what time it starts.",
     "full_text": "I do not know what time it starts.",
     "focus_chunks": ["dunno"]},
    {"id": "dunno-02", "reduction_type": "dunno",
     "reduced_text": "I dunno, maybe next week?",
     "full_text": "I do not know, maybe next week?",
     "focus_chunks": ["dunno"]},
    {"id": "dunno-03", "reduction_type": "dunno",
     "reduced_text": "Honestly, I dunno where she went.",
     "full_text": "Honestly, I do not know where she went.",
     "focus_chunks": ["dunno"]},

    # coulda / shoulda / woulda
    {"id": "coulda-01", "reduction_type": "coulda-shoulda-woulda",
     "reduced_text": "I coulda told you that.",
     "full_text": "I could have told you that.",
     "focus_chunks": ["coulda"]},
    {"id": "shoulda-01", "reduction_type": "coulda-shoulda-woulda",
     "reduced_text": "You shoulda seen the look on his face.",
     "full_text": "You should have seen the look on his face.",
     "focus_chunks": ["shoulda"]},
    {"id": "woulda-01", "reduction_type": "coulda-shoulda-woulda",
     "reduced_text": "I woulda gone if I'd known.",
     "full_text": "I would have gone if I had known.",
     "focus_chunks": ["woulda"]},
    {"id": "musta-01", "reduction_type": "coulda-shoulda-woulda",
     "reduced_text": "He musta forgotten the meeting.",
     "full_text": "He must have forgotten the meeting.",
     "focus_chunks": ["musta"]},
    {"id": "shouldna-01", "reduction_type": "coulda-shoulda-woulda",
     "reduced_text": "I shouldna said that.",
     "full_text": "I should not have said that.",
     "focus_chunks": ["shouldna"]},

    # t-flap (intervocalic /t/ -> /d/-like flap)
    {"id": "tflap-01", "reduction_type": "t-flap",
     "reduced_text": "Get a little water on it.",
     "full_text": "Get a little water on it.",
     "focus_chunks": ["get a", "little", "water"]},
    {"id": "tflap-02", "reduction_type": "t-flap",
     "reduced_text": "I gotta lotta work to do.",
     "full_text": "I have got a lot of work to do.",
     "focus_chunks": ["gotta", "lotta"]},
    {"id": "tflap-03", "reduction_type": "t-flap",
     "reduced_text": "Put it on the counter, please.",
     "full_text": "Put it on the counter, please.",
     "focus_chunks": ["put it", "counter"]},
    {"id": "tflap-04", "reduction_type": "t-flap",
     "reduced_text": "I bet it'll rain later.",
     "full_text": "I bet it will rain later.",
     "focus_chunks": ["bet it", "later"]},

    # schwa reduction (for -> fer, to -> ta, of -> a, and -> n)
    {"id": "schwa-01", "reduction_type": "schwa",
     "reduced_text": "This is fer you.",
     "full_text": "This is for you.",
     "focus_chunks": ["fer"]},
    {"id": "schwa-02", "reduction_type": "schwa",
     "reduced_text": "I need ta go now.",
     "full_text": "I need to go now.",
     "focus_chunks": ["ta"]},
    {"id": "schwa-03", "reduction_type": "schwa",
     "reduced_text": "A cup a coffee, please.",
     "full_text": "A cup of coffee, please.",
     "focus_chunks": ["a"]},
    {"id": "schwa-04", "reduction_type": "schwa",
     "reduced_text": "Bread n butter.",
     "full_text": "Bread and butter.",
     "focus_chunks": ["n"]},
    {"id": "schwa-05", "reduction_type": "schwa",
     "reduced_text": "Whaddaya think?",
     "full_text": "What do you think?",
     "focus_chunks": ["whaddaya"]},
    {"id": "schwa-06", "reduction_type": "schwa",
     "reduced_text": "Gimme a minute.",
     "full_text": "Give me a minute.",
     "focus_chunks": ["gimme"]},

    # 'd've contractions (would've / could've / should've)
    {"id": "dve-01", "reduction_type": "d-ve",
     "reduced_text": "I'd've called if I'd known.",
     "full_text": "I would have called if I had known.",
     "focus_chunks": ["I'd've"]},
    {"id": "dve-02", "reduction_type": "d-ve",
     "reduced_text": "She could've finished it yesterday.",
     "full_text": "She could have finished it yesterday.",
     "focus_chunks": ["could've"]},
    {"id": "dve-03", "reduction_type": "d-ve",
     "reduced_text": "We should've left earlier.",
     "full_text": "We should have left earlier.",
     "focus_chunks": ["should've"]},
]


# ---------------------------------------------------------------------------
# Sampler
# ---------------------------------------------------------------------------

def all_reduction_types() -> list[str]:
    """Return the set of distinct reduction types in the seed list."""
    seen: list[str] = []
    for item in SEED_ITEMS:
        rt = item["reduction_type"]
        if rt not in seen:
            seen.append(rt)
    return seen


def sample_round(
    weakness: dict[str, float] | None = None,
    n: int = 5,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """Pick `n` unique seed items, prioritizing the user's weakest reduction type.

    `weakness` maps reduction_type -> accuracy (0-100). Lower = weaker. Types
    not present in the map are treated as the weakest (priority 0).
    """
    rng = rng or random.Random()
    weakness = weakness or {}

    # Group items by type
    by_type: dict[str, list[dict[str, Any]]] = {}
    for item in SEED_ITEMS:
        by_type.setdefault(item["reduction_type"], []).append(item)

    # Sort types by ascending accuracy (weakest first); unknown -> 0.
    type_order = sorted(by_type.keys(), key=lambda t: weakness.get(t, 0.0))

    chosen: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    # Round-robin from weakest first to ensure variety.
    while len(chosen) < n and any(by_type[t] for t in type_order):
        for t in type_order:
            if len(chosen) >= n:
                break
            pool = [it for it in by_type[t] if it["id"] not in used_ids]
            if not pool:
                continue
            pick = rng.choice(pool)
            chosen.append(pick)
            used_ids.add(pick["id"])
            by_type[t] = [it for it in by_type[t] if it["id"] != pick["id"]]

    return chosen


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def record_attempt(
    db: aiosqlite.Connection,
    *,
    item_id: str,
    reduction_type: str,
    reduced_text: str,
    full_text: str,
    user_expand: str,
    expand_correct: bool,
    shadow_accuracy: float,
) -> int:
    cur = await db.execute(
        """INSERT INTO reduced_form_attempts
               (item_id, reduction_type, reduced_text, full_text,
                user_expand, expand_correct, shadow_accuracy)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            item_id,
            reduction_type,
            reduced_text,
            full_text,
            user_expand or "",
            1 if expand_correct else 0,
            float(shadow_accuracy),
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


async def get_weakness_stats(db: aiosqlite.Connection) -> dict[str, float]:
    """Return a {reduction_type: avg_combined_score} map across all attempts.

    combined = (expand_correct * 100 + shadow_accuracy) / 2
    """
    rows = await db.execute_fetchall(
        """SELECT reduction_type,
                  AVG((expand_correct * 100.0 + shadow_accuracy) / 2.0) AS avg_score
             FROM reduced_form_attempts
            GROUP BY reduction_type"""
    )
    return {r["reduction_type"]: float(r["avg_score"] or 0.0) for r in rows}


async def count_attempts(db: aiosqlite.Connection) -> int:
    rows = await db.execute_fetchall("SELECT COUNT(*) AS n FROM reduced_form_attempts")
    return int(rows[0]["n"]) if rows else 0
