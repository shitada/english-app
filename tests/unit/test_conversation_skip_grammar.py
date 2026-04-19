"""Unit tests for _should_skip_grammar_check helper."""

import pytest

from app.routers.conversation import _should_skip_grammar_check


@pytest.mark.unit
def test_skip_empty_string():
    assert _should_skip_grammar_check("") is True


@pytest.mark.unit
def test_skip_whitespace_only():
    assert _should_skip_grammar_check("   ") is True


@pytest.mark.unit
def test_skip_yes():
    assert _should_skip_grammar_check("yes") is True


@pytest.mark.unit
def test_skip_yes_with_punctuation_and_caps():
    assert _should_skip_grammar_check("Yes!") is True


@pytest.mark.unit
def test_skip_ok_with_period():
    assert _should_skip_grammar_check("ok.") is True


@pytest.mark.unit
def test_skip_thank_you_multiword_ack():
    assert _should_skip_grammar_check("thank you") is True


@pytest.mark.unit
def test_skip_three_word_message_by_length_rule():
    # 3 words → fewer than 4 → skipped via length rule
    assert _should_skip_grammar_check("hi there friend") is True


@pytest.mark.unit
def test_no_skip_four_word_message():
    assert _should_skip_grammar_check("I am hungry today") is False


@pytest.mark.unit
def test_no_skip_long_sentence():
    assert (
        _should_skip_grammar_check("I went to the store yesterday and bought apples")
        is False
    )
