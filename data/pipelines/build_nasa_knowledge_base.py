"""Consolidate the NASA knowledge base used by the tactical copilot.

Reads the canonical calibrated contracts under
``shared/calibrated-data/`` (produced by ``calibrate_constants.py`` from
the PSI CSV exports + authored scenario/tech records) and validates that
the three artifacts the backend depends on are complete and internally
consistent:

  - psi_experiments.json     — FLEX, SAFFIRE, ACME, SoFIE-GEL, BASS-II
  - historical_scenarios.json — Apollo 1, Apollo 13, Mir 1997
  - tech_spinoffs.json        — NASA spin-off technologies

Writes a small ``knowledge_base_manifest.json`` summarizing coverage so
``/api/tactical/advise`` can cite PSI IDs without re-scanning.

Usage:
    python data/pipelines/build_nasa_knowledge_base.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAL = ROOT / "shared" / "calibrated-data"

REQUIRED_EXP_FIELDS = {
    "psi_id", "name", "fuel_or_material", "o2_percent", "airflow_cm_s",
    "gravity_g", "spread_rate_mm_s", "limiting_o2_pct", "psi_url",
}
REQUIRED_SOURCES = {"flex", "saffire", "acme", "sofie", "bass"}
REQUIRED_SCENARIOS = {"apollo-1", "apollo-13", "mir-1997"}


def _fail(msg: str) -> None:
    print(f"[knowledge-base] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load(name: str) -> dict:
    p = CAL / name
    if not p.exists():
        _fail(f"{name} missing — run data/pipelines/calibrate_constants.py first")
    return json.loads(p.read_text())


def validate_experiments(doc: dict) -> list[dict]:
    exps = doc.get("experiments", [])
    if not exps:
        _fail("psi_experiments.json contains no experiments")
    sources: set[str] = set()
    for i, e in enumerate(exps):
        missing = REQUIRED_EXP_FIELDS - e.keys()
        if missing:
            _fail(f"experiment[{i}] ({e.get('psi_id','?')}) missing {sorted(missing)}")
        o2 = e["o2_percent"]
        if not (isinstance(o2, list) and len(o2) == 2 and o2[0] <= o2[1]):
            _fail(f"{e['psi_id']}: o2_percent must be [lo, hi]")
        pid = e["psi_id"].lower()
        for src in REQUIRED_SOURCES:
            if src in pid:
                sources.add(src)
    missing_src = REQUIRED_SOURCES - sources
    if missing_src:
        print(f"[knowledge-base] WARN: no experiments for {sorted(missing_src)}")
    return exps


def validate_scenarios(doc: dict) -> list[dict]:
    scenarios = doc.get("scenarios", [])
    ids = {s.get("id") for s in scenarios}
    missing = REQUIRED_SCENARIOS - ids
    if missing:
        _fail(f"historical_scenarios.json missing {sorted(missing)}")
    for s in scenarios:
        for k in ("id", "name", "initialConditions", "effects", "lesson"):
            if k not in s:
                _fail(f"scenario {s.get('id')} missing '{k}'")
    return scenarios


def validate_tech(doc: dict) -> list[dict]:
    tech = doc.get("tech", [])
    if not tech:
        _fail("tech_spinoffs.json is empty")
    for t in tech:
        for k in ("id", "name", "source", "cost", "effects"):
            if k not in t:
                _fail(f"tech {t.get('id','?')} missing '{k}'")
    return tech


def main() -> None:
    exps = validate_experiments(load("psi_experiments.json"))
    scenarios = validate_scenarios(load("historical_scenarios.json"))
    tech = validate_tech(load("tech_spinoffs.json"))

    manifest = {
        "generated": "build_nasa_knowledge_base.py",
        "experimentCount": len(exps),
        "psiIds": [e["psi_id"] for e in exps],
        "scenarioIds": [s["id"] for s in scenarios],
        "techIds": [t["id"] for t in tech],
        "bySource": {},
    }
    for e in exps:
        src = e["psi_id"].split("-")[0].lower()
        manifest["bySource"][src] = manifest["bySource"].get(src, 0) + 1

    out = CAL / "knowledge_base_manifest.json"
    out.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"[knowledge-base] OK: {len(exps)} experiments, "
          f"{len(scenarios)} scenarios, {len(tech)} tech records → {out.name}")


if __name__ == "__main__":
    main()
