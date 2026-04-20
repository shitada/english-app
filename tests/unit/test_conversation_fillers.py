"""Unit tests for the conversation filler-word counter."""

import pytest

from app.routers.conversation import count_fillers


@pytest.mark.unit
def test_count_fillers_empty_string():
    res = count_fillers("")
    assert res == {"total": 0, "breakdown": {}}


@pytest.mark.unit
def test_count_fillers_none_safe():
    # None-ish empty handling
    res = count_fillers("   ")
    assert res["total"] == 0
    assert res["breakdown"] == {}


@pytest.mark.unit
def test_count_fillers_basic_mixture():
    text = "Um, I think, like, that's actually true"
    res = count_fillers(text)
    assert res["total"] == 3
    assert res["breakdown"] == {"um": 1, "like": 1, "actually": 1}


@pytest.mark.unit
def test_count_fillers_case_insensitive():
    res = count_fillers("UM, LIKE, BASICALLY yes")
    assert res["breakdown"] == {"um": 1, "like": 1, "basically": 1}
    assert res["total"] == 3


@pytest.mark.unit
def test_count_fillers_multiword_phrase_counted_once():
    # "you know" should count as a single filler, not two ("you" + "know")
    res = count_fillers("Well, you know, it's tricky")
    assert res["breakdown"] == {"you know": 1}
    assert res["total"] == 1


@pytest.mark.unit
def test_count_fillers_word_boundary_safety():
    # "likely" must NOT match "like"; "sometimes" must NOT match "so"/"time"
    res = count_fillers("It's likely that sometimes things change")
    assert res["total"] == 0
    assert res["breakdown"] == {}


@pytest.mark.unit
def test_count_fillers_repeated_um():
    res = count_fillers("Um um um, what was I saying?")
    assert res["breakdown"]["um"] == 3


@pytest.mark.unit
def test_count_fillers_phrase_and_words_together():
    res = count_fillers("So, I mean, basically you know it's kind of fine")
    # so:1, i mean:1, basically:1, you know:1, kind of:1
    assert res["total"] == 5
    assert res["breakdown"]["so"] == 1
    assert res["breakdown"]["i mean"] == 1
    assert res["breakdown"]["basically"] == 1
    assert res["breakdown"]["you know"] == 1
    assert res["breakdown"]["kind of"] == 1


@pytest.mark.unit
def test_count_fillers_omits_zero_entries():
    res = count_fillers("Hello there, friend.")
    assert res["total"] == 0
    assert res["breakdown"] == {}
