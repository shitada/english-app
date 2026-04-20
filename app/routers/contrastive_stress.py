"""Quick Contrastive Stress API.

Trains contrastive (emphatic) sentence stress: how shifting emphasis to
different words within the SAME sentence changes the implied meaning.

Example: "I didn't say he broke it"
  - Stress "I"      → someone else said it
  - Stress "say"    → I implied / suggested it, didn't explicitly say it
  - Stress "he"     → someone else broke it
  - Stress "broke"  → he did something else with it

Distinct from Sentence Stress Spotlight (which trains the natural stress
pattern of a single utterance).
"""

from __future__ import annotations

import logging
import random
import re
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.copilot_client import get_copilot_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quick", tags=["quick-contrastive-stress"])


VALID_DIFFICULTIES = {"beginner", "intermediate", "advanced"}


# ---------------------------------------------------------------------------
# Hand-curated fallback bank used when the LLM is unavailable / malformed.
# Each item: sentence + 3-4 (word_index, meaning) options + correct_index.
# correct_index is the option whose stressed word matches the spoken/model
# prompt. Endpoints rotate the "correct" option randomly per request.
# ---------------------------------------------------------------------------
_FALLBACK_ITEMS: list[dict[str, Any]] = [
    {
        "sentence": "I didn't say he broke it.",
        "options": [
            {"word_index": 0, "meaning": "Someone else said it, not me."},
            {"word_index": 2, "meaning": "I didn't explicitly say it (only implied)."},
            {"word_index": 3, "meaning": "Someone else broke it, not him."},
            {"word_index": 4, "meaning": "He did something else to it, not break it."},
        ],
    },
    {
        "sentence": "She gave him the red book yesterday.",
        "options": [
            {"word_index": 0, "meaning": "She gave it, not someone else."},
            {"word_index": 2, "meaning": "She gave it to him, not to another person."},
            {"word_index": 4, "meaning": "The red one, not a different color."},
            {"word_index": 6, "meaning": "It happened yesterday, not on another day."},
        ],
    },
    {
        "sentence": "We are flying to Paris on Monday.",
        "options": [
            {"word_index": 0, "meaning": "We are going, not someone else."},
            {"word_index": 2, "meaning": "Flying, not driving or taking the train."},
            {"word_index": 4, "meaning": "To Paris, not to another city."},
            {"word_index": 6, "meaning": "On Monday, not on another day."},
        ],
    },
    {
        "sentence": "John bought a new car last week.",
        "options": [
            {"word_index": 0, "meaning": "John bought it, not someone else."},
            {"word_index": 1, "meaning": "He bought it, not rented or borrowed it."},
            {"word_index": 3, "meaning": "A new one, not a used one."},
            {"word_index": 4, "meaning": "A car, not another type of vehicle."},
        ],
    },
    {
        "sentence": "I thought you liked coffee in the morning.",
        "options": [
            {"word_index": 0, "meaning": "I thought so — turns out I was wrong."},
            {"word_index": 2, "meaning": "I thought YOU liked it, not someone else."},
            {"word_index": 4, "meaning": "Coffee, not tea or another drink."},
            {"word_index": 6, "meaning": "In the morning, not at another time."},
        ],
    },
    {
        "sentence": "She didn't steal my wallet last night.",
        "options": [
            {"word_index": 0, "meaning": "Someone else did it, not her."},
            {"word_index": 2, "meaning": "She did something else with it, not steal."},
            {"word_index": 3, "meaning": "She took someone else's wallet, not mine."},
            {"word_index": 6, "meaning": "It happened on a different night."},
        ],
    },
    {
        "sentence": "He told her the truth this time.",
        "options": [
            {"word_index": 0, "meaning": "He told her, not someone else."},
            {"word_index": 2, "meaning": "He told HER, not anyone else."},
            {"word_index": 4, "meaning": "The truth, not a lie."},
            {"word_index": 5, "meaning": "This time — implying he didn't before."},
        ],
    },
    {
        "sentence": "We can finish the report by Friday.",
        "options": [
            {"word_index": 0, "meaning": "We can do it, not someone else."},
            {"word_index": 1, "meaning": "It is possible, contrary to doubt."},
            {"word_index": 3, "meaning": "The report, not another task."},
            {"word_index": 5, "meaning": "By Friday, not later."},
        ],
    },
    {
        "sentence": "I never said your idea was bad.",
        "options": [
            {"word_index": 0, "meaning": "Maybe others said it, but I didn't."},
            {"word_index": 1, "meaning": "I have not said that — ever."},
            {"word_index": 3, "meaning": "Your idea specifically, not another."},
            {"word_index": 5, "meaning": "Not bad — perhaps just not great."},
        ],
    },
    {
        "sentence": "They opened the store on Sunday morning.",
        "options": [
            {"word_index": 0, "meaning": "They opened it, not someone else."},
            {"word_index": 1, "meaning": "They opened it (didn't close it)."},
            {"word_index": 3, "meaning": "The store, not another place."},
            {"word_index": 5, "meaning": "On Sunday, not another day."},
        ],
    },
]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ContrastiveStressOption(BaseModel):
    word: str
    word_index: int
    meaning: str


class ContrastiveStressItem(BaseModel):
    sentence: str
    words: list[str]
    options: list[ContrastiveStressOption]
    correct_index: int  # index INTO `options` whose word is the modeled stress
    difficulty: str


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"\S+")


def split_words(sentence: str) -> list[str]:
    return _TOKEN_RE.findall((sentence or "").strip())


def coerce_payload(raw: Any) -> dict[str, Any] | None:
    """Validate an LLM response into a clean dict, or return None if malformed.

    Required shape::

        {
          "sentence": "...",
          "options": [
            {"word_index": 0, "meaning": "..."},
            {"word_index": 3, "meaning": "..."},
            ...
          ]
        }
    """
    if not isinstance(raw, dict):
        return None
    sentence = str(raw.get("sentence") or "").strip()
    if not sentence:
        return None

    words = split_words(sentence)
    n = len(words)
    if n < 5 or n > 12:
        return None

    raw_options = raw.get("options")
    if not isinstance(raw_options, list):
        return None

    options: list[dict[str, Any]] = []
    seen_indices: set[int] = set()
    for opt in raw_options:
        if not isinstance(opt, dict):
            continue
        try:
            wi = int(opt.get("word_index"))
        except (TypeError, ValueError):
            continue
        if wi < 0 or wi >= n or wi in seen_indices:
            continue
        meaning = str(opt.get("meaning") or "").strip()
        if not meaning:
            continue
        seen_indices.add(wi)
        options.append({
            "word_index": wi,
            "meaning": meaning,
            "word": words[wi],
        })
        if len(options) >= 4:
            break

    if len(options) < 3:
        return None

    return {
        "sentence": " ".join(words),
        "words": words,
        "options": options,
    }


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

def _CONTRASTIVE_STRESS_PROMPT() -> str:
    return (
        "You generate contrastive-stress practice items for English learners.\n\n"
        "Contrastive stress shifts emphasis to a different word in the SAME "
        "sentence to change the implied meaning (e.g. 'I didn't say HE broke it' "
        "vs 'I didn't say he BROKE it').\n\n"
        "Return STRICT JSON in this exact shape:\n"
        '{ "sentence": "...", "options": [ '
        '{"word_index": 0, "meaning": "..."}, '
        '{"word_index": 2, "meaning": "..."}, '
        '{"word_index": 4, "meaning": "..."} ] }\n\n'
        "Rules:\n"
        "- sentence: ONE natural English sentence, 5-9 words, where shifting "
        "stress to different words plausibly changes the implied meaning.\n"
        "- options: 3 to 4 distinct words from the sentence (by 0-based index) "
        "that, when stressed, each yield a clearly different implied meaning.\n"
        "- meaning: ONE short paraphrase of the implication when that word is "
        "stressed (max ~12 words). Make each implication clearly distinct.\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/contrastive-stress", response_model=ContrastiveStressItem)
async def get_contrastive_stress(
    difficulty: str = Query(default="intermediate"),
) -> ContrastiveStressItem:
    """Return one contrastive-stress item with options + a correct_index."""
    norm = (difficulty or "intermediate").strip().lower()
    if norm not in VALID_DIFFICULTIES:
        norm = "intermediate"

    coerced: dict[str, Any] | None = None
    try:
        service = get_copilot_service()
        raw = await service.ask_json(
            _CONTRASTIVE_STRESS_PROMPT(),
            f"Generate one {norm}-level contrastive-stress item now.",
        )
        coerced = coerce_payload(raw)
        if coerced is None:
            logger.info("contrastive-stress LLM payload invalid; falling back")
    except Exception as exc:  # noqa: BLE001
        logger.warning("contrastive-stress generation failed, using fallback: %s", exc)

    if coerced is None:
        item = random.choice(_FALLBACK_ITEMS)
        words = split_words(item["sentence"])
        opts = []
        for o in item["options"]:
            wi = int(o["word_index"])
            if 0 <= wi < len(words):
                opts.append({
                    "word_index": wi,
                    "meaning": o["meaning"],
                    "word": words[wi],
                })
        coerced = {
            "sentence": " ".join(words),
            "words": words,
            "options": opts,
        }

    options = [ContrastiveStressOption(**o) for o in coerced["options"]]
    correct_index = random.randrange(len(options))

    return ContrastiveStressItem(
        sentence=coerced["sentence"],
        words=coerced["words"],
        options=options,
        correct_index=correct_index,
        difficulty=norm,
    )
