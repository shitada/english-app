"""System prompts — loaded from config.yaml."""

from app.config import get_prompt


def CONVERSATION_PARTNER() -> str:
    return get_prompt("conversation_partner")


def GRAMMAR_CHECKER() -> str:
    return get_prompt("grammar_checker")


def PRONUNCIATION_CHECKER() -> str:
    return get_prompt("pronunciation_checker")


def VOCABULARY_QUIZ_GENERATOR() -> str:
    return get_prompt("vocabulary_quiz_generator")


def CONVERSATION_SUMMARY() -> str:
    return get_prompt("conversation_summary")


def CONVERSATION_QUIZ() -> str:
    return get_prompt("conversation_quiz")


def NUMBERS_DRILL_PROMPT() -> str:
    """System prompt for the Quick Numbers & Dates listening drill."""
    return (
        "You generate listening dictation items focused on numbers and dates "
        "for English learners.\n\n"
        "Return STRICT JSON in this exact shape:\n"
        '{ "items": [ { "id": 1, "kind": "price|year|phone|time|date|quantity",'
        ' "spoken_text": "...", "expected_answer": "...",'
        ' "accept_variants": ["..."], "hint": "short hint" }, ... ] }\n\n'
        "Rules:\n"
        "- Generate EXACTLY 5 items.\n"
        "- Mix kinds across price, year, phone, time, date, quantity.\n"
        "- spoken_text MUST be a natural full English sentence containing the "
        "target number/date that a TTS engine can speak (no symbols like $, "
        "use words: 'twenty dollars', 'three thirty PM', 'July fourth twenty "
        "twenty-five').\n"
        "- expected_answer is the canonical written form a learner should type "
        "(e.g. '$20', '3:30 PM', 'July 4, 2025', '555-123-4567', '1,250', "
        "'2025').\n"
        "- accept_variants lists other valid normalized written forms a "
        "learner might reasonably type (e.g. ['20 dollars', 'twenty dollars']).\n"
        "- hint is a 1-line clue (e.g. 'a price under $50').\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )

