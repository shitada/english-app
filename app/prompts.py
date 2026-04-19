"""System prompts — loaded from config.yaml."""

from app.config import get_prompt

# Tiny dedicated system prompt for the per-message JP translation reveal in
# the Conversation page. Used by POST /api/conversation/translate.
TRANSLATE_TO_JP_SYSTEM = (
    "Translate the given English sentence to natural, concise Japanese. "
    "Output only the translation, no quotes or commentary."
)


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


def SHADOWING_PROMPT() -> str:
    """System prompt for the Quick Shadowing Drill (listen-and-repeat sentence)."""
    return (
        "You generate short native-paced English sentences for shadowing "
        "practice (listen-and-repeat to improve fluency and prosody).\n\n"
        "Return STRICT JSON in this exact shape:\n"
        '{ "sentence": "...", "focus_tip": "...", "target_seconds": 4.5 }\n\n'
        "Rules:\n"
        "- sentence MUST be a single natural English sentence between 8 and 18 "
        "words. Use everyday vocabulary and natural rhythm (avoid quotes, "
        "lists, or formal jargon).\n"
        "- focus_tip is ONE short coaching hint (max ~12 words) about a "
        "prosody feature to focus on (e.g. linking, sentence stress, "
        "intonation, reduced 'to', schwa, contractions).\n"
        "- target_seconds is the approximate time a native speaker would take "
        "to say the sentence at a natural pace, as a number between 2.5 and "
        "8.0.\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )


def VOCABULARY_COLLOCATION_MATCH() -> str:
    """System + user prompt body for the Vocabulary Collocation Match mini-mode.

    Produces multiple-choice items where the learner picks the most natural
    collocating word/phrase to fill a blank in a context sentence. Each item
    is anchored to a known vocabulary word (id passed in) so SRS updates can
    target the right row.
    """
    return (
        "You are an English vocabulary coach. The user has these target "
        "vocabulary words:\n{word_list}\n\n"
        "Generate EXACTLY {count} collocation match items, one per word, in "
        "the same order. For each word, write a natural English sentence that "
        "uses the target word together with a strong COLLOCATE (a partner "
        "word — a verb, adjective, preposition, or noun — that frequently "
        "co-occurs with the target word). Replace ONLY the collocate with "
        '\"____\" so the learner has to choose the most natural partner.\n\n'
        "Return STRICT JSON in this exact shape (and NOTHING else):\n"
        "{{\n"
        '  \"items\": [\n'
        "    {{\n"
        '      \"word_id\": <int — copy from the input>,\n'
        '      \"word\": \"<the target vocabulary word>\",\n'
        '      \"prompt_sentence\": \"<a natural English sentence containing the target word and exactly one ____ where the collocate goes>\",\n'
        '      \"options\": [\"<option1>\", \"<option2>\", \"<option3>\", \"<option4>\"],\n'
        '      \"correct_index\": <int 0-3 — index of the natural collocate>,\n'
        '      \"explanation\": \"<one short sentence (max ~20 words) explaining why the collocation is natural>\"\n'
        "    }}\n"
        "  ]\n"
        "}}\n\n"
        "Rules:\n"
        "- options MUST be exactly 4 short strings (1-3 words each).\n"
        "- Exactly ONE option (at correct_index) is the natural collocate; the "
        "other 3 are plausible-but-unnatural distractors of the SAME part of "
        "speech.\n"
        "- prompt_sentence MUST contain the literal substring \"____\" exactly "
        "once and MUST contain the target word.\n"
        "- correct_index is an integer between 0 and 3 inclusive.\n"
        "- word_id MUST exactly match the id provided for that word.\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )


def THOUGHT_GROUP_PROMPT() -> str:
    """System prompt for the Quick Thought-Group Phrasing drill."""
    return (
        "You generate English thought-group (sense-group / prosodic phrasing) "
        "drill items for English learners.\n\n"
        "Return STRICT JSON in this exact shape:\n"
        '{ "sentence": "...", "words": ["...", "..."],'
        ' "pause_indices": [3, 7],'
        ' "rules": ["after subject phrase", "before subordinate clause"] }\n\n'
        "Rules:\n"
        "- sentence: ONE natural English sentence between 15 and 25 words long.\n"
        "- words: the sentence split on whitespace (tokens may include trailing "
        "punctuation such as commas/periods); preserve the original order.\n"
        "- pause_indices: 1-based positions of words AFTER which a natural "
        "thought-group pause occurs. Provide 2-4 pause positions, all unique, "
        "each strictly between 1 and len(words)-1 (no pause at the very start "
        "or end). Pauses should fall at sense-group boundaries: after subject "
        "phrases, before/after subordinate clauses, between coordinated "
        "clauses, before relative clauses, around appositives, etc.\n"
        "- rules: one short label per pause (same length as pause_indices), "
        "describing the boundary type (e.g. 'after subject phrase', 'before "
        "subordinate clause', 'between coordinated clauses').\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )


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

