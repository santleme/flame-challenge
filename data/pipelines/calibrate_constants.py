#!/usr/bin/env python3
"""Calibrate the C++ engine material table from the investigations dataset.

Reads the merged dataset (frontend/src/data/investigations.json),
aggregates per-fuel metrics into engine Materials, maps each
investigation to a physics model, and writes
shared/calibrated-data/calibration.json.

Usage: python data/pipelines/calibrate_constants.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "frontend" / "src" / "data" / "investigations.json"
OUT = ROOT / "shared" / "calibrated-data" / "calibration.json"
RISK_OUT = ROOT / "shared" / "calibrated-data" / "risk_profiles.json"
FRONTEND_DATA = ROOT / "frontend" / "src" / "data"

# fuel name (dataset) -> material id (engine)
FUEL_TO_MATERIAL = {
    "PMMA (acrylic)": "pmma",
    "PMMA": "pmma",
    "PMMA spheres": "pmma-sphere",
    "cotton fabric": "cotton",
    "SIBAL cloth (cotton/fiberglass)": "cotton",
    "Nomex": "nomex",
    "polycarbonate": "polycarbonate",
    "n-heptane": "heptane",
    "methanol": "methanol",
    "iso-octane": "iso-octane",
    "decanol blends": "decanol",
    "ethylene": "ethylene",
    "methane": "methane",
    "propane": "propane",
    "JP-8 surrogates (BRE)": "jp8",
    "Teflon": "teflon",
    "Kapton": "kapton",
    "Pyrell foam": "pyrell",
    "silicone rubber": "silicone",
    "cellulose": "cellulose",
    "thin paper/PP sheets": "thin-sheet",
    "thin combustible sheets": "thin-sheet",
    "structured material panels": "panels",
}

# investigation category -> physics model in core/
CATEGORY_MODEL = {
    "droplet": "droplet",
    "solid-flame-spread": "spread",
    "large-scale-fire": "spread",
    "confined": "spread",
    "smoke-aerosol": "spread",
    # ACME coflow gas burners are diffusion flames, not liquid droplets —
    # the SAFFIRE-type spread model is the closest engine regime and matches
    # the TS dispatch in frontend/src/sim-bridge/physics.ts
    "gaseous-diffusion": "spread",
    "partial-gravity": "spread",
}

# rough sooting index by fuel family (ACME burner rankings)
SOOT = {
    "heptane": 0.55, "methanol": 0.10, "iso-octane": 0.6, "decanol": 0.5,
    "ethylene": 0.9, "methane": 0.2, "propane": 0.5, "jp8": 0.85,
    "teflon": 0.05, "kapton": 0.4, "pyrell": 0.7, "silicone": 0.2,
    "cellulose": 0.25, "thin-sheet": 0.3, "panels": 0.45,
}

# seed values where the dataset lacks a field — representative of the
# literature; overridden whenever a real metric exists in the records.
DEFAULTS = {
    "heptane": {"locPct": 12.0, "coolFlameCapable": True},
    "methanol": {"locPct": 12.5, "coolFlameCapable": True},
    "iso-octane": {"locPct": 12.0, "coolFlameCapable": True},
    "decanol": {"locPct": 12.5, "coolFlameCapable": True},
    "ethylene": {"locPct": 11.0},
    "methane": {"locPct": 12.0},
    "propane": {"locPct": 11.5},
    "jp8": {"locPct": 11.5, "coolFlameCapable": True},
    "pmma": {"locPct": 15.0},
    "pmma-sphere": {"locPct": 17.0},
    "cotton": {"locPct": 17.0, "smoldering": True},
    "nomex": {"locPct": 21.0, "smoldering": True},
    "polycarbonate": {"locPct": 19.0},
    "thin-sheet": {"locPct": 16.0, "smoldering": True},
    "cellulose": {"locPct": 16.5, "smoldering": True},
    "panels": {"locPct": 18.0},
    "teflon": {"locPct": 30.0},
    "kapton": {"locPct": 24.0},
    "pyrell": {"locPct": 15.0},
    "silicone": {"locPct": 22.0},
}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> int:
    ds = json.loads(DATASET.read_text())
    materials: dict[str, dict] = {}
    inv_map: dict[str, dict] = {}

    for inv in ds["investigations"]:
        m = inv["metrics"]
        c = inv["conditions"]
        loc = m.get("limitingOxygenPct")
        spread = m.get("flameSpreadRateCms")

        for fuel in inv["fuels"]:
            mid = FUEL_TO_MATERIAL.get(fuel, slug(fuel))
            dflt = DEFAULTS.get(mid, {})
            mat = materials.setdefault(mid, {
                "id": mid,
                "name": fuel,
                "locPct": dflt.get("locPct", 17.0),
                "spreadMinCms": 0.2,
                "spreadMaxCms": 4.0,
                "sootIndex": SOOT.get(mid, 0.3),
                "coolFlameCapable": dflt.get("coolFlameCapable", False),
                "smoldering": dflt.get("smoldering", False),
                "sourceInvestigations": [],
            })
            mat["sourceInvestigations"].append(inv["id"])
            if loc is not None:
                mat["locPct"] = loc if len(mat["sourceInvestigations"]) == 1 \
                    else min(mat["locPct"], loc)
            if spread:
                mat["spreadMinCms"] = min(mat["spreadMinCms"], spread["min"]) \
                    if len(mat["sourceInvestigations"]) > 1 else spread["min"]
                mat["spreadMaxCms"] = max(mat["spreadMaxCms"], spread["max"])
            mat["coolFlameCapable"] |= bool(m.get("coolFlameObserved"))
            mat["smoldering"] |= bool(m.get("smolderObserved"))

        # map the investigation to a chamber model + primary material
        primary = FUEL_TO_MATERIAL.get(inv["fuels"][0], slug(inv["fuels"][0]))
        inv_map[inv["id"]] = {
            "model": CATEGORY_MODEL.get(inv["category"], "spread"),
            "materialId": primary,
            "o2Range": c.get("oxygenPct") or [18, 24],
            "flowRangeCms": c.get("flowCms") or [0, 10],
            "pressureKpa": c.get("pressureKpa") or 101,
            "partialGravity": inv["gravity"] == "partial-gravity",
            "loc": loc,
            # canonical LOC the engines actually burn with: the dataset's
            # measured limit when present, else the primary material's —
            # fit_risk_model.py may later patch this to a psi-data value.
            # TS mirror must read THIS, not o2Range[0], for engine parity.
            "effectiveLoc": loc if loc is not None
            else materials[primary]["locPct"],
            "hazards": inv["hazards"],
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": "calibrate_constants.py",
        "materials": sorted(materials.values(), key=lambda m: m["id"]),
        "investigations": inv_map,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    # risk profile weights — consumed identically by the C++ bridge and
    # the TS fallback, so both engines score risk the same way.
    risk_profiles = {
        "generated": "calibrate_constants.py",
        "baseRisk": 5,
        "pressureWeight": 44,
        # flat additions per dataset hazard tag
        "hazardAdds": {
            "cool-flames": 4,
            "smolder-risk": 3,
            "large-scale-spread": 6,
            "low-oxygen-persistence": 4,
            "toxic-aerosol": 2,
            "detection-gap": 5,
            "exploration-atmosphere": 0,
            "partial-gravity": 2,
        },
        # per-factor normalization for the UI decomposition (0..100)
        "factors": {
            "propagationNormCms": 18.0,
            "flowBoostPerCms": 0.05,
            "detectionCoolFlame": 60,
            "detectionGapAdd": 25,
            "persistenceSmolder": 55,
            "persistenceLowO2": 20,
        },
    }
    RISK_OUT.write_text(json.dumps(risk_profiles, indent=2,
                                     ensure_ascii=False) + "\n")

    # psi_experiments.json — flat quantitative records for the UI and the
    # C++ bridge (curves straight from the PSI-derived dataset).
    psi_experiments = {
        "generated": "calibrate_constants.py",
        "experiments": [
            {
                "psi_id": inv["id"],
                "name": inv["name"],
                "fuel_or_material": inv["fuels"][0],
                "o2_percent": inv["conditions"].get("oxygenPct"),
                "airflow_cm_s": inv["conditions"].get("flowCms"),
                "gravity_g": (
                    0.0 if inv["gravity"] == "microgravity"
                    else 0.38 if inv["gravity"] == "partial-gravity"
                    else 1.0
                ),
                "spread_rate_mm_s": (
                    None
                    if not inv["metrics"].get("flameSpreadRateCms")
                    else round(
                        (inv["metrics"]["flameSpreadRateCms"]["min"]
                         + inv["metrics"]["flameSpreadRateCms"]["max"]) * 5, 2
                    )  # cm/s midpoint -> mm/s
                ),
                "extinction_diameter_mm": None,
                "cool_flame_capable": bool(inv["metrics"].get("coolFlameObserved")),
                "smolder_capable": bool(inv["metrics"].get("smolderObserved")),
                "limiting_o2_pct": inv["metrics"].get("limitingOxygenPct"),
                "psi_url": inv["data"].get("psiUrl"),
            }
            for inv in ds["investigations"]
        ],
    }
    PSI_OUT = ROOT / "shared" / "calibrated-data" / "psi_experiments.json"
    PSI_OUT.write_text(json.dumps(psi_experiments, indent=2,
                                  ensure_ascii=False) + "\n")

    # bundle copies for the frontend (shared/ stays canonical)
    (FRONTEND_DATA / "calibration.json").write_text(
        json.dumps(payload, ensure_ascii=False) + "\n")
    (FRONTEND_DATA / "risk_profiles.json").write_text(
        json.dumps(risk_profiles, ensure_ascii=False) + "\n")
    (FRONTEND_DATA / "psi_experiments.json").write_text(
        json.dumps(psi_experiments, ensure_ascii=False) + "\n")
    # authored scenario/tech contracts: shared/ is the edit target, the
    # pipeline mirrors them into the bundle.
    for authored in ("historical_scenarios.json", "tech_spinoffs.json"):
        src = ROOT / "shared" / "calibrated-data" / authored
        if not src.exists():
            raise FileNotFoundError(
                f"authored contract missing: {src} — create it under "
                "shared/calibrated-data/ (see docs/NASA_PSI_REFERENCES.md)"
            )
        (FRONTEND_DATA / authored).write_text(src.read_text())
    print(f"wrote calibration + risk_profiles + psi_experiments — "
          f"{len(materials)} materials, {len(inv_map)} investigations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
