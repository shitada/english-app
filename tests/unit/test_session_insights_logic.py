"""Unit tests for Session Insights rendering logic.

These mirror the conditional rendering logic in ConversationSummary.tsx
to ensure the card visibility and data formatting rules are correct.
"""

import pytest


@pytest.mark.unit
class TestSessionInsightsVisibility:
    """Test the visibility conditions for the Session Insights card."""

    @staticmethod
    def should_show_insights(
        filler_count: int = 0,
        response_times: list[float] | None = None,
        correction_attempts: int = 0,
        hint_count: int = 0,
    ) -> bool:
        """Mirrors the JS logic: show card if at least one metric has data."""
        has_fillers = filler_count > 0
        has_response_times = len(response_times or []) > 0
        has_corrections = correction_attempts > 0
        has_hints = hint_count > 0
        return has_fillers or has_response_times or has_corrections or has_hints

    def test_hidden_when_all_zero(self):
        assert not self.should_show_insights(0, [], 0, 0)

    def test_hidden_when_all_none(self):
        assert not self.should_show_insights(0, None, 0, 0)

    def test_visible_with_fillers_only(self):
        assert self.should_show_insights(filler_count=3)

    def test_visible_with_response_times_only(self):
        assert self.should_show_insights(response_times=[5.2, 8.1])

    def test_visible_with_corrections_only(self):
        assert self.should_show_insights(correction_attempts=2)

    def test_visible_with_hints_only(self):
        assert self.should_show_insights(hint_count=1)

    def test_visible_with_all_metrics(self):
        assert self.should_show_insights(
            filler_count=5,
            response_times=[3.0, 7.0],
            correction_attempts=3,
            hint_count=2,
        )


@pytest.mark.unit
class TestAvgResponseTimeColor:
    """Test the color coding logic for average response time."""

    @staticmethod
    def response_time_color(avg: float) -> str:
        """Mirrors the JS ternary: green <10, yellow <20, red >=20."""
        if avg < 10:
            return "green"
        elif avg < 20:
            return "yellow"
        else:
            return "red"

    def test_fast_response_green(self):
        assert self.response_time_color(5.0) == "green"

    def test_boundary_10_is_yellow(self):
        assert self.response_time_color(10.0) == "yellow"

    def test_medium_response_yellow(self):
        assert self.response_time_color(15.5) == "yellow"

    def test_boundary_20_is_red(self):
        assert self.response_time_color(20.0) == "red"

    def test_slow_response_red(self):
        assert self.response_time_color(30.0) == "red"

    def test_zero_is_green(self):
        assert self.response_time_color(0.0) == "green"

    def test_just_under_10_is_green(self):
        assert self.response_time_color(9.99) == "green"

    def test_just_under_20_is_yellow(self):
        assert self.response_time_color(19.99) == "yellow"


@pytest.mark.unit
class TestFillerBreakdownFormatting:
    """Test the filler details formatting logic."""

    @staticmethod
    def format_filler_breakdown(details: dict[str, int] | None, limit: int = 5) -> str:
        """Mirrors the JS logic for formatting top filler words."""
        if not details:
            return ""
        sorted_entries = sorted(details.items(), key=lambda x: x[1], reverse=True)
        top = sorted_entries[:limit]
        return ", ".join(f"{word} ×{count}" for word, count in top)

    def test_empty_details(self):
        assert self.format_filler_breakdown({}) == ""

    def test_none_details(self):
        assert self.format_filler_breakdown(None) == ""

    def test_single_filler(self):
        assert self.format_filler_breakdown({"um": 3}) == "um ×3"

    def test_multiple_fillers_sorted_by_count(self):
        result = self.format_filler_breakdown({"like": 2, "um": 5, "uh": 1})
        assert result == "um ×5, like ×2, uh ×1"

    def test_top_5_limit(self):
        details = {f"word{i}": 10 - i for i in range(8)}
        result = self.format_filler_breakdown(details)
        # Should only have 5 entries
        assert result.count("×") == 5

    def test_equal_counts_stable(self):
        # When counts are equal, order may vary but all should be present
        result = self.format_filler_breakdown({"um": 2, "uh": 2})
        assert "×2" in result
        assert "um" in result
        assert "uh" in result


@pytest.mark.unit
class TestAvgResponseTimeComputation:
    """Test the average computation for response times."""

    @staticmethod
    def compute_avg(times: list[float]) -> float:
        if not times:
            return 0.0
        return sum(times) / len(times)

    def test_empty_list(self):
        assert self.compute_avg([]) == 0.0

    def test_single_value(self):
        assert self.compute_avg([5.0]) == 5.0

    def test_multiple_values(self):
        result = self.compute_avg([5.0, 10.0, 15.0])
        assert abs(result - 10.0) < 0.01

    def test_decimal_precision(self):
        result = self.compute_avg([3.3, 6.7])
        assert abs(result - 5.0) < 0.01
