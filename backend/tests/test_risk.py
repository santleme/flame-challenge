"""Regression tests for backend.services.risk review findings."""
from __future__ import annotations

import math

import pytest

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


# ---- conformal uncertainty (MAPIE calibration artifact) ----

def test_risk_index_carries_valid_interval():
    r = risk.risk_index("heptane", 14.0, 0.0, "microgravity")
    u = r["uncertainty"]
    assert u["regime"] in ("interpolation", "extrapolation")
    assert 0.0 <= u["lower"] <= r["riskIndex"] <= u["upper"] <= 1.0
    assert u["calibrationN"] > 0
    assert 0.0 < u["empiricalCoverage"] <= 1.0


def test_in_envelope_is_interpolation_not_extrapolation():
    # calibration envelope is flow~0 — a quiescent PSI-like run
    r = risk.risk_index("heptane", 14.0, 0.0, "microgravity")
    u = r["uncertainty"]
    assert u["regime"] == "interpolation"
    assert u["extrapolationScore"] == 0.0
    assert u["scaled"] is False


def test_out_of_envelope_widens_interval():
    # flow>0 sits outside the labeled envelope — conformal coverage
    # cannot be promised there, so the interval must widen on purpose
    r = risk.risk_index("heptane", 14.0, 20.0, "lunar")
    u = r["uncertainty"]
    assert u["regime"] == "extrapolation"
    assert u["extrapolationScore"] > 0.0
    assert u["effectiveHalfwidth"] > u["halfwidth"]
    assert u["scaled"] is True


def test_unlabeled_material_falls_back_to_global_scope():
    r = risk.risk_index("pmma", 6.0, 0.0, "microgravity")
    assert r["uncertainty"]["scope"] == "global"


# ---- exact Shapley explanation ----

def test_explanation_is_additive_and_sorted():
    r = risk.risk_index("heptane", 16.0, 20.0, "lunar")
    e = r["explanation"]
    assert e["method"] == "exact-shapley-multiplicative"
    assert len(e["contributions"]) == 4
    phi_sum = sum(c["phi"] for c in e["contributions"])
    assert phi_sum == pytest.approx(e["deviation"], abs=2e-3)
    shares = [abs(c["share"]) for c in e["contributions"]]
    assert shares == sorted(shares, reverse=True)


def test_explanation_values_match_breakdown():
    r = risk.risk_index("heptane", 16.0, 20.0, "lunar")
    b, e = r["breakdown"], r["explanation"]
    by_factor = {c["factor"]: c["value"] for c in e["contributions"]}
    assert by_factor["o2Margin"] == pytest.approx(b["ignitionPressure"])
    assert by_factor["airflow"] == pytest.approx(b["flowFactor"])
    assert by_factor["materialHazard"] == pytest.approx(b["hiddenFactor"])
    assert by_factor["gravity"] == pytest.approx(b["gravityFactor"])


def test_curve_points_carry_band():
    c = risk.curve("pmma", 10.0, 20.0, step=5.0)
    for p in c["points"]:
        assert 0.0 <= p["lower"] <= p["riskIndex"] <= p["upper"] <= 1.0


# ---- gravity vocabulary ----

def test_mars_alias_matches_martian():
    """site presets spell the regime "mars"; every engine mirror must
    resolve it to the same factor as "martian" or online/offline risk
    scores diverge silently."""
    for material, o2, flow in (("pmma", 25.0, 5.0), ("heptane", 16.0, 0.0)):
        mars = risk.risk_index(material, o2, flow, "mars")
        martian = risk.risk_index(material, o2, flow, "martian")
        assert mars["breakdown"]["gravityFactor"] == 0.95
        assert mars["riskIndex"] == martian["riskIndex"]
        assert risk.predict_risk(
            risk._load(), material, o2, flow, "mars"
        ) == risk.predict_risk(risk._load(), material, o2, flow, "martian")
