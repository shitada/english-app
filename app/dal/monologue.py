"""DAL for the Situational Monologue Drill (Elevator Pitch practice).

Exposes a curated static scenario bank and DB access for `monologue_attempts`.
Also provides pure helpers (filler-word count, WPM, LLM scoring) that the
router composes. All LLM calls are wrapped with safe-default fallbacks so the
endpoint never 500s on an upstream hiccup.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import aiosqlite

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Curated scenario bank
# ---------------------------------------------------------------------------

SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "networking-intro",
        "title": "Introduce yourself at a networking event",
        "prompt": (
            "You are at a tech networking mixer. A friendly stranger has just "
            "asked, 'So — what do you do?' Give a concise, engaging intro."
        ),
        "target_seconds": 45,
        "content_beats": [
            "Your name",
            "Your role or field",
            "What you focus on right now",
            "A memorable fun fact",
            "A call-to-action (e.g. 'happy to chat about…')",
        ],
    },
    {
        "id": "explain-job-newcomer",
        "title": "Explain your job to a new colleague",
        "prompt": (
            "A new teammate joins the company today. Explain what you do in "
            "plain English, without jargon."
        ),
        "target_seconds": 30,
        "content_beats": [
            "Team or department",
            "Main responsibilities",
            "Who you work with most",
            "One recent example of your work",
        ],
    },
    {
        "id": "standup-recent-project",
        "title": "Describe a recent project in a stand-up",
        "prompt": (
            "Give a stand-up-style update on a recent project: what shipped, "
            "what's in progress, and what's next."
        ),
        "target_seconds": 60,
        "content_beats": [
            "Project name and goal",
            "What you finished this week",
            "What is in progress",
            "Any blockers",
            "What's next",
        ],
    },
    {
        "id": "weekend-hobby-pitch",
        "title": "Pitch a weekend hobby",
        "prompt": (
            "Persuade a friend to try a hobby you love. Make it sound fun "
            "and low-friction to start."
        ),
        "target_seconds": 45,
        "content_beats": [
            "The hobby",
            "Why you love it",
            "What a beginner needs to start",
            "A first step the listener can take this weekend",
        ],
    },
    {
        "id": "interview-strength",
        "title": "Tell an interviewer about a strength",
        "prompt": (
            "An interviewer asks, 'What's one of your biggest strengths?' "
            "Answer with a concrete story, not a buzzword."
        ),
        "target_seconds": 60,
        "content_beats": [
            "Name the strength clearly",
            "Situation where it showed up",
            "Action you took",
            "Result or outcome",
            "How it applies to this role",
        ],
    },
    {
        "id": "product-demo-opener",
        "title": "Open a product demo to a new customer",
        "prompt": (
            "You are kicking off a 30-minute demo for a prospective customer. "
            "Open with context and agenda before diving into features."
        ),
        "target_seconds": 45,
        "content_beats": [
            "Greeting and your role",
            "What the product is in one sentence",
            "The problem it solves",
            "Agenda for the call",
            "Invite questions",
        ],
    },
    {
        "id": "conference-lightning-talk",
        "title": "Open a 2-minute lightning talk",
        "prompt": (
            "You have 2 minutes on stage at a local meetup to share one idea. "
            "Practice the opening 45 seconds."
        ),
        "target_seconds": 45,
        "content_beats": [
            "A hook (a question or surprising fact)",
            "Who you are",
            "The one idea you want the audience to remember",
            "Why it matters to them",
        ],
    },
    {
        "id": "weekend-recap",
        "title": "Recap your weekend to a coworker",
        "prompt": (
            "It's Monday morning. A coworker asks, 'How was your weekend?' "
            "Give a natural, flowing 30-second recap."
        ),
        "target_seconds": 30,
        "content_beats": [
            "Set the scene (where/when)",
            "What you did",
            "A highlight or small detail",
            "A light closing line",
        ],
    },
]


def get_scenarios() -> list[dict[str, Any]]:
    """Return a defensive copy of the scenario bank."""
    return [dict(s, content_beats=list(s["content_beats"])) for s in SCENARIOS]


def get_scenario(scenario_id: str) -> dict[str, Any] | None:
    for s in SCENARIOS:
        if s["id"] == scenario_id:
            return dict(s, content_beats=list(s["content_beats"]))
    return None


# ---------------------------------------------------------------------------
# Transcript metrics
# ---------------------------------------------------------------------------

# Reuses the filler-word taxonomy used elsewhere in the app.
_FILLER_RE = re.compile(
    r"\b(?:um|uh|erm|er|ah|like|you know|basically|i mean|sort of|kind of|"
    r"actually|literally|right|okay so|well)\b",
    re.IGNORECASE,
)

_WORD_RE = re.compile(r"[A-Za-z']+")


def count_words(transcript: str) -> int:
    return len(_WORD_RE.findall(transcript or ""))


def count_filler_words(transcript: str) -> int:
    return len(_FILLER_RE.findall(transcript or ""))


def compute_wpm(word_count: int, duration_seconds: float) -> float:
    """Words-per-minute. Returns 0.0 for non-positive duration."""
    d = float(duration_seconds or 0.0)
    if d <= 0:
        return 0.0
    return round((int(word_count or 0) / d) * 60.0, 1)


def filler_ratio(word_count: int, filler_count: int) -> float:
    wc = int(word_count or 0)
    if wc <= 0:
        return 0.0
    return round(min(1.0, float(filler_count or 0) / wc), 4)


# ---------------------------------------------------------------------------
# LLM scoring
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are an English speaking coach grading a short structured monologue "
    "(an elevator pitch). Return STRICT JSON only — no prose, no markdown."
)


def _user_prompt(
    scenario: dict[str, Any],
    transcript: str,
    duration_seconds: float,
    wpm: float,
    filler_count: int,
    word_count: int,
) -> str:
    beats_list = "\n".join(f"- {b}" for b in scenario["content_beats"])
    return (
        "Scenario: " + scenario["title"] + "\n"
        "Prompt: " + scenario["prompt"] + "\n"
        f"Target duration: {scenario['target_seconds']}s\n"
        "Content beats checklist:\n" + beats_list + "\n\n"
        "Learner transcript:\n" + (transcript or "") + "\n\n"
        f"Stats: duration={duration_seconds}s, word_count={word_count}, "
        f"wpm={wpm}, filler_count={filler_count}\n\n"
        "Return JSON with these EXACT keys:\n"
        "{\n"
        '  "beats_covered": [<one of the exact beat strings above, only those '
        'actually addressed in the transcript>],\n'
        '  "fluency_score": <0-100 integer based on wpm (target ~130-160) and '
        'filler ratio>,\n'
        '  "structure_score": <0-100 integer: did it flow logically through '
        'the beats?>,\n'
        '  "overall_score": <0-100 integer weighted overall>,\n'
        '  "one_line_feedback": "<one short constructive sentence>",\n'
        '  "suggested_rewrite_opening": "<one natural alternative opening '
        'line, <=25 words>"\n'
        "}\n"
        "JSON only."
    )


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(0, min(100, n))


def _coerce_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    s = str(value).strip()
    return s or default


def _normalize_beats(raw: Any, allowed: list[str]) -> list[str]:
    """Return only the beats that are in the allowed list (case-insensitive)."""
    if not isinstance(raw, list):
        return []
    lower_map = {b.lower(): b for b in allowed}
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        canonical = lower_map.get(item.strip().lower())
        if canonical and canonical not in seen:
            out.append(canonical)
            seen.add(canonical)
    return out


def _safe_defaults(scenario: dict[str, Any]) -> dict[str, Any]:
    return {
        "beats_covered": [],
        "fluency_score": 0,
        "structure_score": 0,
        "overall_score": 0,
        "one_line_feedback": (
            "Could not score this attempt automatically. Please try again."
        ),
        "suggested_rewrite_opening": (
            f"Let me tell you about {scenario['title'].lower()}."
        ),
    }


def normalize_llm_response(
    raw: dict[str, Any] | None, scenario: dict[str, Any]
) -> dict[str, Any]:
    """Coerce LLM output to the strict schema; use safe defaults on garbage."""
    beats = scenario.get("content_beats", [])
    if not isinstance(raw, dict):
        return _safe_defaults(scenario)

    fluency = _coerce_int(raw.get("fluency_score"))
    structure = _coerce_int(raw.get("structure_score"))
    overall_raw = raw.get("overall_score")
    overall = (
        _coerce_int(overall_raw)
        if overall_raw is not None
        else round((fluency + structure) / 2)
    )

    feedback = _coerce_str(
        raw.get("one_line_feedback"),
        default="Nice effort — keep refining the structure.",
    )
    suggested = _coerce_str(
        raw.get("suggested_rewrite_opening"),
        default=f"Let me tell you about {scenario['title'].lower()}.",
    )

    return {
        "beats_covered": _normalize_beats(raw.get("beats_covered"), beats),
        "fluency_score": fluency,
        "structure_score": structure,
        "overall_score": overall,
        "one_line_feedback": feedback,
        "suggested_rewrite_opening": suggested,
    }


async def score_attempt(
    copilot: Any,
    *,
    scenario: dict[str, Any],
    transcript: str,
    duration_seconds: float,
    wpm: float,
    filler_count: int,
    word_count: int,
) -> dict[str, Any]:
    """Ask the LLM to grade a monologue attempt; safe defaults on any error."""
    try:
        raw = await copilot.ask_json(
            _SYSTEM_PROMPT,
            _user_prompt(
                scenario,
                transcript,
                duration_seconds,
                wpm,
                filler_count,
                word_count,
            ),
            label="monologue_score",
        )
    except Exception:  # noqa: BLE001
        logger.exception("Monologue scoring failed; returning safe defaults")
        return _safe_defaults(scenario)
    return normalize_llm_response(raw, scenario)


# ---------------------------------------------------------------------------
# DB access
# ---------------------------------------------------------------------------

async def record_attempt(
    db: aiosqlite.Connection,
    *,
    scenario_id: str,
    transcript: str,
    duration_seconds: float,
    word_count: int,
    filler_count: int,
    wpm: float,
    coverage_ratio: float,
    fluency_score: int,
    structure_score: int,
    overall_score: int,
    feedback: dict[str, Any],
) -> int:
    cur = await db.execute(
        """INSERT INTO monologue_attempts
               (scenario_id, transcript, duration_seconds, word_count,
                filler_count, wpm, coverage_ratio, fluency_score,
                structure_score, overall_score, feedback_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(scenario_id),
            str(transcript),
            float(duration_seconds),
            int(word_count),
            int(filler_count),
            float(wpm),
            float(coverage_ratio),
            int(fluency_score),
            int(structure_score),
            int(overall_score),
            json.dumps(feedback),
        ),
    )
    await db.commit()
    return cur.lastrowid or 0


def _row_to_attempt(row: aiosqlite.Row) -> dict[str, Any]:
    try:
        feedback = json.loads(row["feedback_json"] or "{}")
    except (json.JSONDecodeError, TypeError):
        feedback = {}
    return {
        "id": row["id"],
        "scenario_id": row["scenario_id"],
        "transcript": row["transcript"],
        "duration_seconds": row["duration_seconds"],
        "word_count": row["word_count"],
        "filler_count": row["filler_count"],
        "wpm": row["wpm"],
        "coverage_ratio": row["coverage_ratio"],
        "fluency_score": row["fluency_score"],
        "structure_score": row["structure_score"],
        "overall_score": row["overall_score"],
        "feedback": feedback,
        "created_at": row["created_at"],
    }


async def get_history(
    db: aiosqlite.Connection,
    *,
    scenario_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 20), 100))
    if scenario_id:
        rows = await db.execute_fetchall(
            """SELECT * FROM monologue_attempts
                WHERE scenario_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?""",
            (str(scenario_id), limit),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT * FROM monologue_attempts
                ORDER BY created_at DESC, id DESC
                LIMIT ?""",
            (limit,),
        )
    return [_row_to_attempt(r) for r in rows]


async def get_personal_best(
    db: aiosqlite.Connection, *, scenario_id: str
) -> dict[str, Any] | None:
    rows = await db.execute_fetchall(
        """SELECT * FROM monologue_attempts
            WHERE scenario_id = ?
            ORDER BY overall_score DESC, id DESC
            LIMIT 1""",
        (str(scenario_id),),
    )
    if not rows:
        return None
    return _row_to_attempt(rows[0])
