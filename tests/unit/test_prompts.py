"""Unit tests for prompts module."""

from app.prompts import (
    CONVERSATION_PARTNER,
    GRAMMAR_CHECKER,
    PRONUNCIATION_CHECKER,
    VOCABULARY_QUIZ_GENERATOR,
    CONVERSATION_SUMMARY,
)


class TestPrompts:
    def test_conversation_partner_format(self):
        prompt = CONVERSATION_PARTNER()
        assert "{scenario}" in prompt
        assert "{role}" in prompt
        assert "{goal}" in prompt
        formatted = prompt.format(scenario="Hotel check-in", role="Front desk clerk", goal="Complete check-in")
        assert "Hotel check-in" in formatted
        assert "{scenario}" not in formatted

    def test_grammar_checker_format(self):
        prompt = GRAMMAR_CHECKER()
        assert "{user_message}" in prompt
        formatted = prompt.format(user_message="I go to office yesterday.")
        assert "I go to office yesterday." in formatted

    def test_pronunciation_checker_format(self):
        prompt = PRONUNCIATION_CHECKER()
        assert "{reference_text}" in prompt
        assert "{user_transcription}" in prompt
        formatted = prompt.format(
            reference_text="Hello world",
            user_transcription="Hello word",
        )
        assert "Hello world" in formatted
        assert "Hello word" in formatted

    def test_vocabulary_quiz_generator_format(self):
        prompt = VOCABULARY_QUIZ_GENERATOR()
        assert "{count}" in prompt
        assert "{topic}" in prompt
        formatted = prompt.format(count=5, topic="Travel")
        assert "5" in formatted
        assert "Travel" in formatted

    def test_conversation_summary_format(self):
        prompt = CONVERSATION_SUMMARY()
        assert "{conversation}" in prompt
        formatted = prompt.format(conversation="user: Hi\nassistant: Hello!")
        assert "user: Hi" in formatted
