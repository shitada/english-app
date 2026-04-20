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


def STRESS_SPOTLIGHT_PROMPT() -> str:
    """System prompt for the Sentence Stress Spotlight drill."""
    return (
        "You generate sentence-stress practice items for English learners.\n\n"
        "Return STRICT JSON in this exact shape:\n"
        '{ "sentence": "...", "words": ["...", "..."],'
        ' "stressed_indices": [0, 3, 5],'
        ' "rationale": "Content words (nouns, main verbs, adjectives, adverbs) carry primary stress." }\n\n'
        "Rules:\n"
        "- sentence: ONE natural English sentence between 8 and 16 words.\n"
        "- words: the sentence split on whitespace (tokens may include trailing "
        "punctuation such as commas/periods); preserve the original order.\n"
        "- stressed_indices: 0-based positions of words that should receive "
        "primary sentence stress when spoken at a natural conversational pace. "
        "Provide 2-5 indices, all unique, each strictly between 0 and "
        "len(words)-1 inclusive. Stress falls on content words (main nouns, "
        "main verbs, adjectives, adverbs, negatives, wh-words, demonstratives) "
        "and NOT on function words (articles, auxiliaries, pronouns, "
        "prepositions, conjunctions) unless contrast/emphasis demands it.\n"
        "- rationale: ONE short coaching note (max ~20 words) explaining why "
        "the chosen words are stressed.\n"
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


def SENTENCE_ECHO_PROMPT() -> str:
    """System prompt for the Sentence Echo (memory-span) listening drill."""
    return (
        "You generate one short, natural English sentence for a listening "
        "memory-span drill. The learner will hear the sentence via TTS and "
        "must type back exactly what they heard.\n\n"
        "Return STRICT JSON of this exact shape:\n"
        '{ "sentence": "...", "ipa_hint": "..." }\n\n'
        "Rules:\n"
        "- The sentence MUST contain EXACTLY the requested number of words "
        "(the user message specifies the target word count).\n"
        "- Use clear, common everyday vocabulary appropriate for the given "
        "CEFR level (beginner=A2, intermediate=B1, advanced=B2/C1).\n"
        "- Prefer concrete subjects, simple tenses for shorter spans, and "
        "one or two clauses for longer spans.\n"
        "- No proper nouns that are hard to spell, no numbers expressed as "
        "digits — spell numbers as words if needed.\n"
        "- End the sentence with normal punctuation (. ! or ?).\n"
        "- ipa_hint is OPTIONAL: if the sentence contains a tricky-to-hear "
        "word, give a short pronunciation hint (e.g. 'thorough = /ˈθʌrə/'). "
        "Otherwise return an empty string.\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )


def LISTEN_SUMMARIZE_PASSAGE_PROMPT() -> str:
    """System prompt for generating a Listen & Summarize short passage.

    Produces a 40–70 word short passage plus 3–5 key points the learner is
    expected to include in their summary.
    """
    return (
        "You generate short English audio passages for a 'Listen & "
        "Summarize' gist-comprehension drill. The learner will hear the "
        "passage via TTS twice and then write a 1–2 sentence summary. The "
        "summary will be graded on coverage of the listed key points.\n\n"
        "Return STRICT JSON of this exact shape:\n"
        '{ "text": "...", "key_points": ["...", "...", "..."],'
        ' "target_min_words": 15, "target_max_words": 35,'
        ' "genre": "news|story|how-to|opinion|description|dialogue" }\n\n'
        "Rules:\n"
        "- text MUST be a coherent English passage between 40 and 70 words. "
        "Use natural everyday vocabulary and one or two short paragraphs of "
        "plain prose (no bullet points, no headings, no quotes around the "
        "passage).\n"
        "- key_points: 3 to 5 short factual gist statements (max ~12 words "
        "each) covering the main ideas the listener should retain. Each key "
        "point must be a self-contained claim grounded in the passage.\n"
        "- target_min_words / target_max_words: integer word range for the "
        "expected learner summary, with target_min_words >= 10 and "
        "target_max_words <= 50 and target_min_words < target_max_words.\n"
        "- genre is one of news, story, how-to, opinion, description, "
        "dialogue, matching the user-requested genre when given.\n"
        "- The passage MUST be appropriate for the requested CEFR level "
        "(beginner=A2, intermediate=B1, advanced=B2/C1) and must avoid "
        "obscure proper nouns or hard-to-spell names.\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )


def build_tag_question_prompt(
    difficulty: str = "beginner", count: int = 8
) -> tuple[str, str]:
    """Return (system_prompt, user_message) for the Tag Question Drill.

    The model must produce a JSON object of the shape::

        {"items": [
            {"statement": "...,", "expected_tag": "...",
             "expected_intonation": "rising"|"falling",
             "context_hint": "...", "explanation": "..."}
        ]}
    """
    system = (
        "You generate English TAG QUESTION practice items for learners.\n\n"
        "Return STRICT JSON of this exact shape:\n"
        '{ "items": [ { "statement": "...,", "expected_tag": "...",'
        ' "expected_intonation": "rising"|"falling",'
        ' "context_hint": "...", "explanation": "..." } ] }\n\n'
        "Rules:\n"
        "- Generate EXACTLY the requested number of items.\n"
        "- 'statement' is a natural English declarative clause that ENDS with "
        "a comma (the learner will append the tag). Examples: 'You're coming "
        "to the party,' or 'She doesn't like coffee,'.\n"
        "- 'expected_tag' is the canonical tag (e.g. \"aren't you\", "
        "\"doesn't she\", \"do they\"). Use standard contractions with "
        "apostrophes. Do NOT include leading commas or trailing '?'.\n"
        "- A positive statement takes a NEGATIVE tag; a negative statement "
        "(including near-negatives like nobody / hardly / rarely) takes a "
        "POSITIVE tag.\n"
        "- 'expected_intonation' is exactly 'rising' or 'falling'. Use "
        "FALLING when the speaker expects agreement / is confirming / is "
        "making small talk. Use RISING when the speaker is genuinely unsure "
        "or asking a real question / polite request.\n"
        "- 'context_hint' is ONE short situational hint (max ~15 words) "
        "that tells the learner why this intonation fits.\n"
        "- 'explanation' is ONE short grammar/intonation note (max ~22 "
        "words) explaining both the tag choice and the intonation.\n"
        "- Match the requested CEFR difficulty: beginner=A2 simple present/"
        "past; intermediate=B1 perfect/modals/let's/imperatives; advanced="
        "B2+ 'used to', deductive modals, near-negatives, 'there is', "
        "'I am' → 'aren't I', etc.\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )
    user = (
        f"Generate EXACTLY {int(count)} {difficulty}-level tag question items now."
    )
    return system, user


def LISTEN_SUMMARIZE_GRADE_PROMPT() -> str:
    """System prompt for grading a learner's Listen & Summarize response.

    Returns per-key-point coverage with evidence, plus conciseness, accuracy,
    overall score, and a short coaching feedback string.
    """
    return (
        "You are an English listening-comprehension coach. You will be given "
        "(1) the original short passage, (2) a list of key_points the "
        "learner was expected to cover, (3) the learner's 1–2 sentence "
        "summary, and (4) the target word range (min, max). Grade the "
        "summary on key-point COVERAGE (fuzzy — accept paraphrases), "
        "CONCISENESS (within target range), and ACCURACY (no facts that "
        "contradict the passage).\n\n"
        "Return STRICT JSON of this exact shape:\n"
        "{\n"
        '  "coverage": [\n'
        '    {"point": "<copy of key_point>", "covered": true,'
        ' "evidence": "<short snippet from learner summary or empty>"}\n'
        "  ],\n"
        '  "conciseness_score": 0.0,\n'
        '  "accuracy_score": 0.0,\n'
        '  "overall": 0.0,\n'
        '  "feedback": "<one short coaching sentence (max ~25 words)>"\n'
        "}\n\n"
        "Rules:\n"
        "- coverage MUST contain exactly one entry per key_point in the same "
        "order, with the original key_point text echoed in 'point'. 'covered' "
        "is true when the learner's summary clearly conveys that idea (a "
        "close paraphrase counts).\n"
        "- conciseness_score is in [0,1]: 1.0 when the summary word count "
        "is within [target_min_words, target_max_words]; decrease linearly "
        "outside the range, with a minimum of 0.\n"
        "- accuracy_score is in [0,1]: 1.0 if no fabricated or contradictory "
        "facts; reduce sharply for hallucinated content not supported by the "
        "passage.\n"
        "- overall is in [0,1] and is a weighted blend roughly: "
        "0.6*coverage_ratio + 0.2*conciseness_score + 0.2*accuracy_score, "
        "where coverage_ratio = (#covered / #key_points).\n"
        "- feedback is ONE short, encouraging coaching sentence pointing to "
        "the most useful next-step (e.g. a missed key point or wordiness).\n"
        "- Output JSON ONLY, no markdown fences, no commentary."
    )
