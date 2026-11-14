#!/usr/bin/env python3
"""Consolidate the auditable NASA combustion master sheet.

Merges every data class the sim consumes into ONE flat table —
the artifact a judge can open in Excel/GitHub and trace row-by-row
back to a NASA PSI record:

  * investigation  — the 8 curated PSI investigations (dataset row)
  * material       — the 20-material flammability matrix (calibration.json,
                     enriched with fit stats from risk_model.json)
  * experiment_run — a curated subset of normalized per-test PSI rows
                     (data/processed/experiments.csv — real FLEX-2 runs)
  * incident       — the 3 documented historical cases (Apollo 1,
                     Apollo 13, Mir 1997)

Outputs:
  data/processed/nasa_combustion_master.csv   (auditable table)
  data/bundle/master_sheet.json               (same rows, JSON form)

Usage: python data/pipelines/build_master_sheet.py [--runs-per-material N]
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "shared" / "calibrated-data"
PROCESSED = ROOT / "data" / "processed"
BUNDLE = ROOT / "data" / "bundle"

OUT_CSV = PROCESSED / "nasa_combustion_master.csv"
OUT_JSON = BUNDLE / "master_sheet.json"

COLUMNS = [
    "record_type", "id", "name", "investigation_id", "material_id",
    "fuel_or_material", "o2_pct", "o2_min", "o2_max",
    "flow_cms", "flow_min", "flow_max", "pressure_kpa", "gravity_g",
    "loc_pct", "spread_mm_s", "droplet_d0_mm", "burn_rate_mm2_s",
    "extinction_d_mm", "extinction_type", "outcome",
    "cool_flame", "smolder", "soot_index", "hidden_factor",
    "psi_runs", "psi_cool_flame_runs",
    "verified", "source", "source_url", "notes",
]

PSI_REPO = "https://psi.nasa.gov/physci/repo"


def _blank() -> dict:
    return {c: "" for c in COLUMNS}


def _clip(text: str | None, n: int = 220) -> str:
    t = (text or "").strip().replace("\n", " ")
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def load_inputs() -> dict:
    def j(path: Path):
        return json.loads(path.read_text())

    return {
        "dataset": j(BUNDLE / "investigations.json"),
        "calib": j(SHARED / "calibration.json"),
        "risk": j(SHARED / "risk_model.json"),
        "psi": j(SHARED / "psi_experiments.json"),
        "scenarios": j(SHARED / "historical_scenarios.json"),
    }


def investigation_rows(inp: dict) -> list[dict]:
    psi_by_id = {p["psi_id"]: p for p in inp["psi"]["experiments"]}
    calib_inv = inp["calib"]["investigations"]
    rows = []
    for inv in inp["dataset"]["investigations"]:
        r = _blank()
        r["record_type"] = "investigation"
        r["id"] = inv["id"]
        r["name"] = inv["name"]
        r["investigation_id"] = inv["id"]
        r["fuel_or_material"] = ", ".join(inv["fuels"])
        o2 = inv["conditions"]["oxygenPct"]
        flow = inv["conditions"]["flowCms"]
        if o2:
            r["o2_min"], r["o2_max"] = o2[0], o2[1]
        if flow:
            r["flow_min"], r["flow_max"] = flow[0], flow[1]
        r["pressure_kpa"] = inv["conditions"]["pressureKpa"] or ""
        r["gravity_g"] = {"microgravity": 0.0, "partial-gravity": 0.38, "mixed": "0–1"}.get(
            inv["gravity"], inv["gravity"]
        )
        if inv["metrics"]["limitingOxygenPct"] is not None:
            r["loc_pct"] = inv["metrics"]["limitingOxygenPct"]
        if inv["metrics"]["flameSpreadRateCms"]:
            s = inv["metrics"]["flameSpreadRateCms"]
            r["spread_mm_s"] = f"{s['min'] * 10:g}–{s['max'] * 10:g}"
        r["cool_flame"] = str(inv["metrics"]["coolFlameObserved"]).lower()
        r["smolder"] = str(inv["metrics"]["smolderObserved"]).lower()
        r["material_id"] = calib_inv.get(inv["id"], {}).get("materialId", "")
        psi = psi_by_id.get(inv["id"])
        r["verified"] = str(bool(inv.get("verified"))).lower()
        r["source"] = "NASA PSI" if psi else inv["agencies"][0]
        r["source_url"] = (psi or {}).get("psi_url") or inv["data"].get("psiUrl") or PSI_REPO
        r["notes"] = _clip(inv["keyFindings"][0] if inv["keyFindings"] else inv["title"])
        rows.append(r)
    return rows


def material_rows(inp: dict) -> list[dict]:
    stats = inp["risk"].get("materials", {})
    rows = []
    for m in inp["calib"]["materials"]:
        r = _blank()
        r["record_type"] = "material"
        r["id"] = m["id"]
        r["name"] = m["name"]
        r["material_id"] = m["id"]
        r["fuel_or_material"] = m["name"]
        src_invs = [s for s in m.get("sourceInvestigations", []) if s != "same"]
        r["investigation_id"] = src_invs[0] if src_invs else ""
        # LOC and its provenance come from the same source — the fitted
        # risk-model entry when present, else the calibrated default —
        # so verified=true never labels an unfitted value
        st = stats.get(m["id"], {})
        loc_pct = st["locPct"] if st.get("locPct") is not None else m["locPct"]
        r["loc_pct"] = loc_pct
        r["spread_mm_s"] = f"{m['spreadMinCms'] * 10:g}–{m['spreadMaxCms'] * 10:g}"
        r["soot_index"] = m["sootIndex"]
        r["cool_flame"] = str(m["coolFlameCapable"]).lower()
        r["smolder"] = str(m["smoldering"]).lower()
        if st.get("hiddenFactor") is not None:
            r["hidden_factor"] = st["hiddenFactor"]
        if st.get("psiRuns") is not None:
            r["psi_runs"] = st["psiRuns"]
        if st.get("psiCoolFlameRuns") is not None:
            r["psi_cool_flame_runs"] = st["psiCoolFlameRuns"]
        # LOC refit from real PSI runs counts as pipeline-verified
        r["verified"] = str(st.get("locSource") == "psi-data").lower()
        r["source"] = "ACME/BASS-II flammability matrix"
        r["source_url"] = PSI_REPO
        r["notes"] = _clip(
            f"LOC {loc_pct}% O₂; soot index {m['sootIndex']}; "
            + ("cool-flame capable (FLEX regime); " if m["coolFlameCapable"] else "")
            + ("smoldering; " if m["smoldering"] else "")
            + f"refs: {', '.join(m.get('sourceInvestigations', []))}"
        )
        rows.append(r)
    return rows


def incident_rows(inp: dict) -> list[dict]:
    rows = []
    for s in inp["scenarios"]["scenarios"]:
        r = _blank()
        r["record_type"] = "incident"
        r["id"] = s["id"]
        r["name"] = f"{s['name']} ({s['year']})"
        ic = s.get("initialConditions", {})
        r["o2_pct"] = ic.get("o2Percent", "")
        r["pressure_kpa"] = ic.get("pressureKpa", "")
        r["gravity_g"] = "0–1"
        r["outcome"] = "documented incident"
        r["verified"] = "true"
        r["source"] = "NASA historical record"
        r["source_url"] = ""
        r["notes"] = _clip(f"{s['description']} — Lesson: {s['lesson']} [{s['citation']}]")
        rows.append(r)
    return rows


def run_rows(inp: dict, per_material: int) -> list[dict]:
    src = PROCESSED / "experiments.csv"
    if not src.exists():
        return []
    all_runs = list(csv.DictReader(src.open(encoding="utf-8")))
    by_material: dict[str, list[dict]] = {}
    for r in all_runs:
        by_material.setdefault(r["material_id"] or "unknown", []).append(r)

    picked: list[dict] = []
    for mat, runs in sorted(by_material.items()):
        runs.sort(key=lambda r: r["run_id"])
        step = max(1, math.ceil(len(runs) / per_material))
        for i, raw in enumerate(runs):
            if i % step != 0:
                continue
            r = _blank()
            r["record_type"] = "experiment_run"
            r["id"] = raw["run_id"]
            r["name"] = f"{raw['fuel']} droplet — {raw['run_id']}"
            r["investigation_id"] = raw["investigation_id"]
            r["material_id"] = raw["material_id"]
            r["fuel_or_material"] = raw["fuel"]
            r["o2_pct"] = raw["o2_pct"]
            r["flow_cms"] = raw["flow_cms"]
            r["pressure_kpa"] = raw["pressure_kpa"]
            r["gravity_g"] = 0.0
            r["droplet_d0_mm"] = raw["droplet_d0_mm"]
            r["burn_rate_mm2_s"] = raw["burn_rate_mm2_s"]
            r["extinction_d_mm"] = raw["extinction_d_mm"]
            r["extinction_type"] = raw["extinction_type"]
            r["outcome"] = raw["outcome"]
            r["cool_flame"] = raw["cool_flame"].lower()
            r["verified"] = raw["verified"].lower()
            r["source"] = f"NASA PSI {raw['accession']}"
            r["source_url"] = raw["source_url"]
            r["notes"] = _clip(raw.get("comments"), 200)
            picked.append(r)
    return picked


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs-per-material", type=int, default=12)
    args = ap.parse_args()

    inp = load_inputs()
    rows = (
        investigation_rows(inp)
        + material_rows(inp)
        + incident_rows(inp)
        + run_rows(inp, args.runs_per_material)
    )

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "generated": "build_master_sheet.py",
                "source": "data/processed/nasa_combustion_master.csv",
                "rows": rows,
            },
            indent=1,
        ),
        encoding="utf-8",
    )

    counts = {}
    for r in rows:
        counts[r["record_type"]] = counts.get(r["record_type"], 0) + 1
    print(f"wrote {OUT_CSV.relative_to(ROOT)} — {len(rows)} rows {counts}")
    print(f"wrote {OUT_JSON.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
