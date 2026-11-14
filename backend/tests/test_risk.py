"""Regression tests for backend.services.risk review findings."""
from __future__ import annotations

import math

from backend.services import risk


def test_curve_bounded_against_infinite_max():
    c = risk.curve("pmma", o2_min=8.0, o2_max=math.inf)
    assert c["o2Max"] == risk.O2_LIMITS[1]
    assert len(c["points"]) <= risk.MAX_CURVE_POINTS + 1


def test_curve_zero_step_terminates():
    c = risk.curve("pmma", o2_min=10.0, o2_max=20.0, step=0.0)
    assert len(c["points"]) > 0


def test_curve_swapped_range_is_normalized():
    c = risk.curve("pmma", o2_min=30.0, o2_max=10.0)
    assert c["points"][0]["o2Pct"] == 10.0
    assert c["points"][-1]["o2Pct"] <= 30.0 + 1e-9


def test_curve_dense_step_is_capped():
    c = risk.curve("pmma", o2_min=0.0, o2_max=100.0, step=0.001)
    assert len(c["points"]) <= risk.MAX_CURVE_POINTS + 1


def test_curve_nan_bounds_fall_back():
    c = risk.curve("pmma", o2_min=math.nan, o2_max=math.nan)
    # assert on the clamped bounds the function reports, not on the first
    # accumulated point (which depends on step arithmetic)
    assert c["o2Min"] == risk.O2_LIMITS[0]
    assert c["o2Max"] == risk.O2_LIMITS[1]
    assert c["points"]  # still produces a usable curve
