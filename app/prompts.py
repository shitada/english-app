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

