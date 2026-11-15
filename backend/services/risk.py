"""Cabin fire-risk simulator — deterministic model fitted from PSI data.

Implements the formula emitted by data/pipelines/fit_risk_model.py
(shared/calibrated-data/risk_model.json). Mirrors MaterialRisk's
ignition-pressure curve so the chamber preview and the cabin-risk dial
agree, then adds the ventilation factor and hidden-hazard modifiers:

    risk = clamp01( P_ign(o2 - loc) * F_flow(flow) * H(material) * G(gravity) )
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from backend.services import explain

ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "shared" / "calibrated-data" / "risk_model.json"

FALLBACK_FLOW = [[0.0, 0.80], [2.0, 0.90], [8.0, 1.05], [18.0, 1.15],
                 [40.0, 1.00], [80.0, 0.70], [150.0, 0.45]]
FALLBACK_MATERIAL = {
    "id": "pmma", "name": "PMMA (acrylic)", "locPct": 15.0,
    "locSource": "calibration", "sootIndex": 0.35,
    "coolFlameCapable": False, "smoldering": True, "hiddenFactor": 1.185,
}

# partial-g burns sit between µg and 1-g behaviour (FLARE intent):
# slightly less risk than worst-case µg, still above Earth baseline.
GRAVITY_FACTOR = {"microgravity": 1.0, "lunar": 0.92, "martian": 0.95,
                  "mars": 0.95,  # preset vocabulary — same regime as martian
                  "partial-gravity": 0.94, "earth": 0.85}

_model: dict | None = None


def _load() -> dict:
    global _model
    if _model is None:
        if MODEL_PATH.exists():
            _model = json.loads(MODEL_PATH.read_text())
        else:
            _model = {"formula": {"ignitionBase": 0.04, "ignitionK": 0.055,
                                  "ignitionExp": 1.35, "residualBand": 3.0},
                      "flowAnchors": FALLBACK_FLOW,
                      "materials": {FALLBACK_MATERIAL["id"]: FALLBACK_MATERIAL}}
    return _model


def reload() -> None:
    global _model
    _model = None


def materials() -> list[dict]:
    return sorted(_load()["materials"].values(), key=lambda m: m["id"])


def flow_factor(flow_cms: float) -> float:
    anchors = _load().get("flowAnchors", FALLBACK_FLOW)
    f = max(0.0, float(flow_cms))
    if f <= anchors[0][0]:
        return anchors[0][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if f <= x1:
            return y0 + (y1 - y0) * (f - x0) / (x1 - x0)
    return anchors[-1][1]


def ignition_pressure(margin: float, material: dict | None = None) -> float:
    """P_ign — PSI logistic fit when the material carries one
    (ignitionLogitA/B + ignitionFitN > 0), else the hand-set curve.
    Mirrors MaterialRisk::ignitionPressure (C++)."""
    # flames never sustain burn more than ~3pp below LOC — hard dead band
    if margin <= -3.0:
        return 0.0
    if material and float(material.get("ignitionFitN") or 0) > 0:
        z = (float(material["ignitionLogitA"])
             + float(material["ignitionLogitB"]) * margin)
        return 1.0 / (1.0 + math.exp(-min(30.0, max(-30.0, z))))
    p = _load()["formula"]
    if margin <= 0:
        return p["ignitionBase"]
    return min(1.0, p["ignitionBase"] + p["ignitionK"] * margin ** p["ignitionExp"])


def predict_risk(model: dict, material_id: str, o2_pct: float,
                 flow_cms: float = 0.0,
                 gravity: str = "microgravity") -> float:
    """Score the risk formula against an explicit model dict.

    Pipeline use — fit_uncertainty.py scores held-out calibration rows
    with the train-fold refit; scoring them with the shipped model would
    reuse in-sample parameters and void the conformal guarantee. The
    formula constants (formula/flowAnchors/hidden factor) are identical
    across model dicts, so reusing the helpers is exact.
    """
    mats = model.get("materials", {})
    m = mats.get(material_id) or mats.get("pmma") or FALLBACK_MATERIAL
    margin = float(o2_pct) - float(m.get("locPct", 17.0))
    p = ignition_pressure(margin, m)
    f = flow_factor(float(flow_cms))
    h = float(m.get("hiddenFactor") or
              (1.0 + 0.25 * m.get("coolFlameCapable", False)
               + 0.15 * m.get("smoldering", False)
               + 0.10 * float(m.get("sootIndex", 0.3))))
    g = GRAVITY_FACTOR.get(str(gravity).lower(), 1.0)
    return max(0.0, min(1.0, p * f * h * g))


def level(risk: float) -> str:
    for hi, name in ((0.05, "minimal"), (0.25, "low"), (0.5, "moderate"),
                     (0.75, "high"), (1.01, "critical")):
        if risk < hi:
            return name
    return "critical"


def uncertainty(material_id: str, margin: float, flow_cms: float,
                gravity: str, risk_val: float,
                level: float | None = None) -> dict | None:
    """Conformal prediction interval from risk_model.json["uncertainty"]
    (data/pipelines/fit_uncertainty.py — MAPIE split-conformal on the
    labeled PSI runs). Scope resolution: per-material quantile when the
    material had enough labeled runs, else its family, else the pooled
    global quantile.

    The conformal guarantee only holds inside the calibration envelope —
    beyond it (deep margin, unmeasured flow, partial gravity) the
    halfwidth is scaled and the regime is flagged "extrapolation" rather
    than pretending coverage still applies.
    """
    u = _load().get("uncertainty")
    if not u or not u.get("global"):
        return None
    lvl = float(level or u.get("defaultLevel", 0.90))
    key = f"{lvl:.2f}"
    entry, scope = None, None
    me = u.get("materials", {}).get(material_id)
    fam = u.get("materialFamily", {}).get(material_id)
    if me:
        entry, scope = me, f"material:{material_id}"
    elif fam and fam in u.get("families", {}):
        entry, scope = u["families"][fam], f"family:{fam}"
    else:
        entry, scope = u["global"], "global"
    qhat = entry.get("qhat", {})
    q = qhat.get(key) or qhat.get("0.90") or max(qhat.values())
    env = entry.get("envelope", {})
    # normalized distance outside the calibration envelope; the gravity
    # axis is categorical — every PSI run is µg, so partial-g is
    # out-of-distribution by definition
    mspan = max(env.get("marginMax", 0.0) - env.get("marginMin", 0.0), 1.0)
    fspan = max(env.get("flowMax", 0.0) - env.get("flowMin", 0.0), 20.0)
    d_margin = max(0.0, float(margin) - env.get("marginMax", 0.0),
                   env.get("marginMin", 0.0) - float(margin)) / mspan
    d_flow = max(0.0, float(flow_cms) - env.get("flowMax", 0.0),
                 env.get("flowMin", 0.0) - float(flow_cms)) / fspan
    d_grav = 0.5 if str(gravity).lower() != "microgravity" else 0.0
    score = max(d_margin, d_flow, d_grav)
    hw = q * (1.0 + 1.5 * score)      # heuristic widening, not guaranteed
    return {
        "level": lvl,
        "halfwidth": round(q, 4),
        "effectiveHalfwidth": round(hw, 4),
        "lower": round(max(0.0, risk_val - hw), 4),
        "upper": round(min(1.0, risk_val + hw), 4),
        "scaled": score > 0,
        "regime": "extrapolation" if score > 0 else "interpolation",
        "extrapolationScore": round(score, 3),
        "scope": scope,
        "calibrationN": entry.get("n"),
        "empiricalCoverage": entry.get("empiricalCoverage", {}).get(key),
    }


def risk_index(material_id: str, o2_pct: float, flow_cms: float = 0.0,
               gravity: str = "microgravity") -> dict:
    mats = _load()["materials"]
    m = mats.get(material_id) or mats.get("pmma") or FALLBACK_MATERIAL
    loc = float(m.get("locPct", 17.0))
    margin = float(o2_pct) - loc
    p = ignition_pressure(margin, m)
    f = flow_factor(float(flow_cms))
    h = float(m.get("hiddenFactor") or
              (1.0 + 0.25 * m.get("coolFlameCapable", False)
               + 0.15 * m.get("smoldering", False)
               + 0.10 * float(m.get("sootIndex", 0.3))))
    g = GRAVITY_FACTOR.get(str(gravity).lower(), 1.0)
    risk = max(0.0, min(1.0, p * f * h * g))
    breakdown = {"ignitionPressure": round(p, 4), "flowFactor": round(f, 4),
                 "hiddenFactor": round(h, 4), "gravityFactor": g}
    return {
        "materialId": m["id"],
        "materialName": m.get("name", m["id"]),
        "o2Pct": float(o2_pct),
        "flowCms": float(flow_cms),
        "gravity": gravity,
        "locPct": loc,
        "locSource": m.get("locSource", "calibration"),
        "ignitionFitScope": m.get("ignitionFitScope"),
        "margin": round(margin, 2),
        "riskIndex": round(risk, 4),
        "level": level(risk),
        "breakdown": breakdown,
        "uncertainty": uncertainty(m["id"], margin, float(flow_cms),
                                   gravity, risk),
        "explanation": explain.explain(breakdown, risk),
        "flags": {
            "coolFlameCapable": bool(m.get("coolFlameCapable")),
            "smoldering": bool(m.get("smoldering")),
            "belowLoc": margin <= 0,
        },
    }


# physical bounds for the O2 sweep; a request can't allocate beyond this
O2_LIMITS = (0.0, 100.0)
MAX_CURVE_POINTS = 400


def curve(material_id: str, flow_cms: float = 0.0,
          gravity: str = "microgravity",
          o2_min: float = 8.0, o2_max: float = 40.0, step: float = 0.5) -> dict:
    """O2 sweep for charts — risk vs oxygen at fixed ventilation.

    Range/step are clamped so a pathological query (o2Max=inf, step=0)
    can't hang the server or exhaust memory.
    """
    lo = float(o2_min) if math.isfinite(float(o2_min)) else O2_LIMITS[0]
    hi = float(o2_max) if math.isfinite(float(o2_max)) else O2_LIMITS[1]
    lo, hi = max(O2_LIMITS[0], lo), min(O2_LIMITS[1], hi)
    if lo > hi:
        lo, hi = hi, lo
    st = abs(float(step))
    if not math.isfinite(st) or st <= 0:
        st = 0.5
    # widen step so the sweep stays bounded even for dense requests
    span = hi - lo
    if span / st > MAX_CURVE_POINTS:
        st = span / MAX_CURVE_POINTS
    pts = []
    o2 = lo
    while o2 <= hi + 1e-9:
        r = risk_index(material_id, o2, flow_cms, gravity)
        pt = {"o2Pct": round(o2, 2), "riskIndex": r["riskIndex"],
              "level": r["level"]}
        if r.get("uncertainty"):
            pt["lower"] = r["uncertainty"]["lower"]
            pt["upper"] = r["uncertainty"]["upper"]
        pts.append(pt)
        o2 += st
    return {"materialId": material_id, "flowCms": flow_cms,
            "gravity": gravity, "o2Min": lo, "o2Max": hi, "step": st,
            "points": pts}
