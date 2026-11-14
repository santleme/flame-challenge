"""Fit the cabin fire-risk model from normalized PSI experiment data.

Model (deterministic, interpretable — anchored on FLEX/CFI droplet data,
SoFIE/BASS-II spread limits and ACME sooting indices):

    margin(o2, loc)   = o2_pct - loc_pct
    P_ign(margin)     = 0                                margin <= -3
                        0.04                             -3 < margin <= 0   (µg low-O2 persistence, SoFIE)
                        min(1, 0.04 + 0.055*margin^1.35) margin > 0        (ignition-pressure curve)
    F_flow(flow)      = piecewise ventilation factor (radiative-extinction
                        window at very low flow, O2-supply enhancement in
                        the mid range, blow-off quench at high flow)
    H(material)       = 1 + 0.25*coolFlame + 0.15*smolder + 0.10*sootIndex
    risk_index        = clamp01( P_ign * F_flow * H )

LOC per material is re-estimated from parsed runs when enough burn/extinct
points exist; otherwise the calibrated default is kept. All sources are
recorded so the UI can distinguish PSI-fitted vs literature-seeded values.

Inputs:
    data/processed/experiments.csv          (normalize_experiments.py)
    shared/calibrated-data/calibration.json (calibrate_constants.py)

Outputs:
    shared/calibrated-data/risk_model.json
    frontend/src/data/risk_model.json       (bundle copy for offline TS mirror)

Usage:
    python data/pipelines/fit_risk_model.py
"""

from __future__ import annotations

import csv
import json
import math
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # data/
REPO = ROOT.parent
EXP_CSV = ROOT / "processed" / "experiments.csv"
CALIBRATION = REPO / "shared" / "calibrated-data" / "calibration.json"
OUT = REPO / "shared" / "calibrated-data" / "risk_model.json"
FRONTEND_OUT = REPO / "frontend" / "src" / "data" / "risk_model.json"

BURNED = {"burnout", "disruption"}
EXTINCT = {"extinction", "no-ignition"}

# extinction regimes that actually bound flammability — 'radiative' and
# 'cool-flame' extinctions happen at ANY O2 (they are not limit evidence)
LIMIT_EXTINCT = {"oxygen-limit", "suppressant", "quiescent", "blow-off"}
# no-ignition is direct LOC evidence, but only below a plausible ceiling —
# ACME burner rows record no-ignition at 21-85% O2 for mechanical reasons
NOIGN_MAX_O2 = 25.0
# LOC fitting is restricted to droplet-family fuels (FLEX): for coflow
# gaseous flames "extinction" is a strain/blowoff limit, not an oxygen
# flammability limit — a boundary fit there produces meaningless LOCs
DROPLET_INVESTIGATIONS = {"flex-2"}
# sanity window for a fitted LOC (rejects degenerate envelopes; the
# literature range for condensable/gaseous fuels is ~10.5-16.5%)
LOC_FIT_MIN, LOC_FIT_MAX = 10.0, 17.0

# ventilation factor anchor points (cm/s -> multiplier); linear between
# anchors: quiescent radiative window, mid-flow O2 supply, high-flow blow-off
FLOW_ANCHORS = [
    [0.0, 0.80],   # quiescent: radiative extinction regime (SoFIE-GEL)
    [2.0, 0.90],
    [8.0, 1.05],
    [18.0, 1.15],  # worst-case opposed flow (BASS-II envelope)
    [40.0, 1.00],
    [80.0, 0.70],  # stretch/blow-off dominated
    [150.0, 0.45],
]


def flow_factor(flow_cms: float, anchors: list[list[float]] = FLOW_ANCHORS) -> float:
    f = max(0.0, float(flow_cms))
    if f <= anchors[0][0]:
        return anchors[0][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if f <= x1:
            return y0 + (y1 - y0) * (f - x0) / (x1 - x0)
    return anchors[-1][1]


def ignition_pressure(margin: float) -> float:
    """Keep parity with MaterialRisk::ignitionPressure (C++) / physics.ts."""
    if margin <= 0:
        return 0.04 if margin > -3.0 else 0.0
    return min(1.0, 0.04 + 0.055 * margin ** 1.35)


def empirical_loc(burned: list[float], extinct: list[float]) -> float | None:
    """LOC estimate = midpoint of the burn/extinct boundary region."""
    if not burned or not extinct:
        return None
    lo_burn, hi_ext = min(burned), max(extinct)
    if hi_ext < lo_burn:                       # clean separation
        return round((hi_ext + lo_burn) / 2.0, 1)
    # overlap: mean of boundary points (top quartile extinct, bottom quartile burned)
    ext_q = statistics.quantiles(extinct, n=4)[-1] if len(extinct) >= 4 else statistics.mean(extinct)
    burn_q = statistics.quantiles(burned, n=4)[0] if len(burned) >= 4 else statistics.mean(burned)
    return round((ext_q + burn_q) / 2.0, 1)


def main() -> int:
    rows: list[dict] = []
    if EXP_CSV.exists():
        with EXP_CSV.open(newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
    if not CALIBRATION.exists():
        print(f"[FAIL] calibration input missing: {CALIBRATION}\n"
              "       run data/pipelines/build_dataset.py then "
              "data/pipelines/calibrate_constants.py first — fitting "
              "without calibrated materials would write an empty risk model",
              file=sys.stderr)
        return 1
    cal = json.loads(CALIBRATION.read_text())
    # preserve the literature LOC in its own field — once a psi-data fit
    # is written back, locPct alone can no longer tell fit from baseline
    for m in cal.get("materials", []):
        m.setdefault("locBaseline", m.get("locPct"))

    stats: dict[str, dict] = {}
    for r in rows:
        mid = r.get("material_id")
        if not mid:
            continue
        s = stats.setdefault(mid, {"burned": [], "extinct": [], "cool": 0,
                                   "n": 0, "kavg": [], "dext": [],
                                   "ext_limit": [], "droplet": False})
        s["n"] += 1
        if r.get("investigation_id") in DROPLET_INVESTIGATIONS:
            s["droplet"] = True
        try:
            o2 = float(r["o2_pct"]) if r.get("o2_pct") else None
        except ValueError:
            o2 = None
        if o2 is not None:
            if r.get("outcome") in BURNED:
                s["burned"].append(o2)
            elif r.get("outcome") in EXTINCT:
                s["extinct"].append(o2)
                if (r.get("extinction_type") in LIMIT_EXTINCT
                        or (r.get("outcome") == "no-ignition"
                            and o2 <= NOIGN_MAX_O2)):
                    s["ext_limit"].append(o2)
        try:
            d = float(r["extinction_d_mm"]) if r.get("extinction_d_mm") else None
            if d:
                s["dext"].append(d)
        except ValueError:
            pass
        if r.get("cool_flame") in ("True", "true", True):
            s["cool"] += 1
        try:
            k = float(r["burn_rate_mm2_s"]) if r.get("burn_rate_mm2_s") else None
            if k:
                s["kavg"].append(k)
        except ValueError:
            pass

    materials: dict[str, dict] = {}
    fitted = 0
    for m in cal.get("materials", []):
        mid = m["id"]
        s = stats.get(mid)
        loc, loc_src = m.get("locBaseline", m.get("locPct", 17.0)), "calibration"
        entry: dict = {
            "id": mid, "name": m.get("name", mid),
            "locPct": loc, "locSource": loc_src,
            "spreadMinCms": m.get("spreadMinCms"),
            "spreadMaxCms": m.get("spreadMaxCms"),
            "sootIndex": m.get("sootIndex", 0.3),
            "coolFlameCapable": bool(m.get("coolFlameCapable")),
            "smoldering": bool(m.get("smoldering")),
            "hiddenFactor": 1.0,
        }
        if s:
            entry["psiRuns"] = s["n"]
            entry["psiBurned"] = len(s["burned"])
            entry["psiExtinguished"] = len(s["extinct"])
            entry["psiCoolFlameRuns"] = s["cool"]
            if s["extinct"]:
                # measured extinction-limit envelope (NOT classical LOC —
                # radiative extinctions at high O2 are part of the envelope)
                entry["extinctionLimitMinPct"] = round(min(s["extinct"]), 1)
                entry["extinctionLimitMaxPct"] = round(max(s["extinct"]), 1)
            if s["dext"]:
                entry["extinctionDiameterMedianMm"] = round(
                    statistics.median(s["dext"]), 2)
            if s["kavg"]:
                entry["burnRateMedianMm2s"] = round(statistics.median(s["kavg"]), 3)
            # LOC refit — two estimators, both labelled in locMethod:
            #  1. boundary-midpoint: clean burn/extinct separation (rare —
            #     radiative extinctions at high O2 usually overlap)
            #  2. extinction-floor: droplet fuels only; the median of the
            #     three lowest limit-type extinctions approximates the
            #     empirical flammability floor — the O2 at which the flame
            #     demonstrably still dies. Robust to a single outlier row;
            #     radiative/cool-flame extinctions excluded via ext_limit.
            loc_fit = empirical_loc(s["burned"], s["extinct"])
            if (loc_fit is not None and s["burned"] and s["extinct"]
                    and max(s["extinct"]) < min(s["burned"])
                    and len(s["burned"]) + len(s["extinct"]) >= 6):
                entry["locPct"] = loc_fit
                entry["locSource"] = "psi-data"
                entry["locMethod"] = "boundary-midpoint"
                fitted += 1
            elif s["droplet"] and len(s["ext_limit"]) >= 10:
                floor = statistics.median(sorted(s["ext_limit"])[:3])
                if LOC_FIT_MIN <= floor <= LOC_FIT_MAX:
                    entry["locPct"] = round(floor, 1)
                    entry["locSource"] = "psi-data"
                    entry["locMethod"] = "extinction-floor"
                    fitted += 1
        entry["hiddenFactor"] = round(
            1.0 + 0.25 * entry["coolFlameCapable"]
            + 0.15 * entry["smoldering"]
            + 0.10 * float(entry["sootIndex"]), 3)
        materials[mid] = entry

    # propagate the canonical LOC back into calibration.json — the C++
    # chamber (materials[].locPct), the backend bridge and the TS fallback
    # must all burn with ONE value; investigations[].effectiveLoc follows
    # the same loc ?? material rule calibrate_constants.py emits. This
    # runs every time, not only when something fitted: a material whose
    # evidence dropped below the fitting bar reverts to locBaseline
    # instead of silently keeping a stale psi-data number.
    for m in cal.get("materials", []):
        fitted_mat = materials.get(m["id"])
        if fitted_mat and fitted_mat.get("locSource") == "psi-data":
            m["locPct"] = fitted_mat["locPct"]
            m["locSource"] = "psi-data"
            if fitted_mat.get("locMethod"):
                m["locMethod"] = fitted_mat["locMethod"]
        elif m.get("locSource") == "psi-data":
            m["locPct"] = m.get("locBaseline", m["locPct"])
            m["locSource"] = "calibration"
            m.pop("locMethod", None)
    mat_loc = {m["id"]: m.get("locPct") for m in cal.get("materials", [])}
    for spec in cal.get("investigations", {}).values():
        spec["effectiveLoc"] = spec.get("loc") \
            if spec.get("loc") is not None \
            else mat_loc.get(spec.get("materialId"))
    CALIBRATION.write_text(json.dumps(cal, indent=2))
    fe_cal = REPO / "frontend" / "src" / "data" / "calibration.json"
    if fe_cal.exists():
        fe_cal.write_text(json.dumps(cal))

    model = {
        "generated": "fit_risk_model.py",
        "formula": {
            "description": "risk = clamp01(P_ign(o2-loc) * F_flow(flow) * H(material))",
            "ignitionBase": 0.04, "ignitionK": 0.055, "ignitionExp": 1.35,
            "residualBand": 3.0,
            "coolFlameAdd": 0.25, "smolderAdd": 0.15, "sootAdd": 0.10,
        },
        "flowAnchors": FLOW_ANCHORS,
        "materials": materials,
        "provenance": {
            "psiRunsParsed": len(rows),
            "materialsFittedFromPsi": fitted,
            "note": "locSource=psi-data -> LOC re-estimated from parsed PSI "
                    "test sheets: locMethod=boundary-midpoint for clean "
                    "burn/extinct separation, extinction-floor for "
                    "droplet fuels (median of 3 lowest limit-type "
                    "radiative/cool-flame extinctions excluded). "
                    "locSource=calibration -> literature-seeded. "
                    "extinctionLimitMin/MaxPct = measured extinction "
                    "envelope (includes radiative extinctions — not a "
                    "flammability limit).",
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(model, indent=2))
    FRONTEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_OUT.write_text(json.dumps(model))

    print(f"[DONE] risk model -> {OUT.relative_to(REPO)}")
    print(f"       {len(materials)} materials, {fitted} LOC values fitted "
          f"from {len(rows)} parsed runs")
    for mid, s in sorted(stats.items(), key=lambda kv: -kv[1]['n'])[:8]:
        print(f"       {mid:14s} n={s['n']:4d} burned={len(s['burned']):4d} "
              f"extinct={len(s['extinct']):4d} cool={s['cool']:3d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
