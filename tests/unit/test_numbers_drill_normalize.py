"""Unit tests for the numbers-drill normalize/compare helpers."""

from __future__ import annotations

import pytest

from app.routers.listening import compare_answers, normalize_answer


@pytest.mark.unit
class TestNormalizeAnswer:

    def test_strips_whitespace_and_currency(self):
        assert normalize_answer("$24.99") == "2499"
        assert normalize_answer(" 24.99 ") == "2499"
        assert normalize_answer("24.99 dollars") == "2499dollars"

    def test_strips_thousands_commas(self):
        assert normalize_answer("1,250") == "1250"
        assert normalize_answer("1250") == "1250"

    def test_strips_phone_dashes(self):
        assert normalize_answer("555-123-4567") == "5551234567"
        assert normalize_answer("(555) 123-4567") == "(555)1234567"

    def test_strips_time_separators(self):
        assert normalize_answer("3:30 PM") == "330pm"
        assert normalize_answer("3:30PM") == "330pm"

    def test_lowercases(self):
        assert normalize_answer("July 4, 2025") == "july42025"

    def test_handles_empty_and_none(self):
        assert normalize_answer("") == ""
        assert normalize_answer(None) == ""  # type: ignore[arg-type]


@pytest.mark.unit
class TestCompareAnswers:

    def test_exact_match(self):
        assert compare_answers("$24.99", [], "$24.99") is True

    def test_normalized_match(self):
        assert compare_answers("$24.99", [], "24.99") is True
        assert compare_answers("1,250", [], "1250") is True

    def test_variant_match(self):
        assert compare_answers("3:30 PM", ["15:30"], "15:30") is True

    def test_phone_variants(self):
        assert compare_answers(
            "555-123-4567", ["5551234567", "(555) 123-4567"], "555 123 4567"
        ) is True

    def test_mismatch(self):
        assert compare_answers("$24.99", [], "$25.00") is False

    def test_empty_user_answer(self):
        assert compare_answers("$24.99", [], "") is False
        assert compare_answers("$24.99", ["24.99"], "   ") is False
