"""Unit tests for LatencyTracker."""

from __future__ import annotations

import pytest

from app.copilot_client import LatencyTracker


@pytest.mark.unit
def test_empty_snapshot():
    tracker = LatencyTracker()
    snap = tracker.snapshot()
    assert snap["labels"] == {}
    assert snap["all"]["count"] == 0
    assert snap["all"]["llm"]["count"] == 0
    assert snap["all"]["total"]["p50_s"] == 0.0
    assert snap["buffer_cap"] == 200


@pytest.mark.unit
def test_single_record():
    tracker = LatencyTracker()
    tracker.record("foo", session_s=0.5, llm_s=1.5, total_s=2.0)
    snap = tracker.snapshot()
    assert "foo" in snap["labels"]
    foo = snap["labels"]["foo"]
    assert foo["count"] == 1
    assert foo["llm"]["p50_s"] == pytest.approx(1.5)
    assert foo["total"]["last_s"] == pytest.approx(2.0)
    assert foo["total"]["max_s"] == pytest.approx(2.0)
    assert snap["all"]["count"] == 1


@pytest.mark.unit
def test_percentiles_on_1_to_100():
    tracker = LatencyTracker(cap=200)
    for i in range(1, 101):
        # session=0, llm=i, total=i
        tracker.record("x", 0.0, float(i), float(i))
    snap = tracker.snapshot()["labels"]["x"]
    assert snap["count"] == 100
    # nearest-rank percentiles on 1..100
    assert snap["llm"]["p50_s"] == pytest.approx(50.0)
    assert snap["llm"]["p95_s"] == pytest.approx(95.0)
    assert snap["llm"]["p99_s"] == pytest.approx(99.0)
    assert snap["total"]["mean_s"] == pytest.approx(50.5)
    assert snap["total"]["max_s"] == pytest.approx(100.0)


@pytest.mark.unit
def test_ring_buffer_cap():
    tracker = LatencyTracker(cap=200)
    for i in range(300):
        tracker.record("y", 0.0, float(i), float(i))
    snap = tracker.snapshot()["labels"]["y"]
    # buffer keeps only last 200
    assert snap["count"] == 200
    # but cumulative count is 300
    assert snap["cumulative_count"] == 300
    # last 200 records are values 100..299; min value present is 100
    assert snap["llm"]["max_s"] == pytest.approx(299.0)
    assert snap["llm"]["last_s"] == pytest.approx(299.0)


@pytest.mark.unit
def test_per_label_isolation():
    tracker = LatencyTracker()
    tracker.record("a", 0.0, 1.0, 1.0)
    tracker.record("a", 0.0, 3.0, 3.0)
    tracker.record("b", 0.0, 10.0, 10.0)
    snap = tracker.snapshot()
    assert snap["labels"]["a"]["count"] == 2
    assert snap["labels"]["b"]["count"] == 1
    assert snap["labels"]["a"]["llm"]["max_s"] == pytest.approx(3.0)
    assert snap["labels"]["b"]["llm"]["max_s"] == pytest.approx(10.0)
    # 'all' aggregates across labels
    assert snap["all"]["count"] == 3
    assert snap["all"]["llm"]["max_s"] == pytest.approx(10.0)


@pytest.mark.unit
def test_record_returns_cumulative_count():
    tracker = LatencyTracker()
    assert tracker.record("z", 0.0, 1.0, 1.0) == 1
    assert tracker.record("z", 0.0, 1.0, 1.0) == 2
    assert tracker.record("other", 0.0, 1.0, 1.0) == 1
