"""Bridge to the compiled C++ engine (core/build/freefall_engine.*.so)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD_DIR = ROOT / "core" / "build"
if str(BUILD_DIR) not in sys.path:
    sys.path.insert(0, str(BUILD_DIR))

import freefall_engine as fe  # noqa: E402

CALIBRATION = ROOT / "shared" / "calibrated-data" / "calibration.json"

_risks = fe.MaterialRisk()
_cal: dict = {"materials": [], "investigations": {}}
if CALIBRATION.exists():
    _cal = json.loads(CALIBRATION.read_text())
    _risks.load_json(json.dumps({"materials": _cal["materials"]}))


def materials() -> list[dict]:
    return _cal.get("materials", [])


def investigation_map() -> dict:
    return _cal.get("investigations", {})


def preview(investigation_id: str, o2_pct: float, flow_cms: float | None = None) -> dict:
    """Physics-computed ignition pressure + model metadata for the UI dial."""
    spec = _cal["investigations"].get(investigation_id, {})
    material_id = spec.get("materialId", "pmma")
    pressure = _risks.ignition_pressure(material_id, float(o2_pct))
    return {
        "investigationId": investigation_id,
        "o2Pct": o2_pct,
        "ignitionPressure": max(0.0, pressure),
        "model": spec.get("model", "spread"),
        "materialId": material_id,
        "loc": spec.get("loc"),
        "o2Range": spec.get("o2Range", [18, 24]),
        "flowRangeCms": spec.get("flowRangeCms", [0, 10]),
        "engine": "c++",
    }


def risk_vector(material_id: str, o2_pct: float, flow_cms: float,
                mods: "fe.TechModifiers") -> "fe.RiskVector":
    return _risks.risk_vector(material_id, float(o2_pct), float(flow_cms), mods)


_SPINOFF_MAP = {  # tech id → TechModifiers field
    "fire-detector": ("detection_latency_mult", "hiddenRevealMult"),
    "firemans-air-tanks": ("extinguish_rate_mult", "extinguishRateMult"),
    "fire-attire": ("crew_thermal_mult", "crewBurnMult"),
}


def tech_modifiers(researched: list[str] | None = None) -> "fe.TechModifiers":
    """Translate researched spin-off ids into C++ physics modifiers.

    `researched=None` → apply ALL fielded spin-offs (backend default for
    ranking/advice, matching a shipyard that researched everything).
    """
    mods = fe.TechModifiers()
    if researched is None:
        researched = list(_SPINOFF_MAP)
    doc_path = ROOT / "shared" / "calibrated-data" / "tech_spinoffs.json"
    effects: dict[str, dict] = {}
    if doc_path.exists():
        for t in json.loads(doc_path.read_text()).get("tech", []):
            if t.get("id") in _SPINOFF_MAP:
                effects[t["id"]] = t.get("effects", {})
    for tid in researched:
        field, effect_key = _SPINOFF_MAP.get(tid, (None, None))
        if field and effect_key in effects.get(tid, {}):
            setattr(mods, field, float(effects[tid][effect_key]))
    return mods


def make_chamber(
    investigation_id: str,
    o2_pct: float,
    flow_cms: float | None = None,
    seed: int = 1,
    o2_source: int = 0,
    mods: "fe.TechModifiers | None" = None,
) -> fe.Chamber:
    spec = _cal["investigations"].get(investigation_id, {})
    cfg = fe.ChamberConfig()
    cfg.investigationId = investigation_id
    cfg.materialId = spec.get("materialId", "pmma")
    cfg.model = spec.get("model", "spread")
    cfg.o2Pct = float(o2_pct)
    fr = spec.get("flowRangeCms", [0, 10])
    cfg.flowCms = float(flow_cms if flow_cms is not None else fr[1] * 0.5)
    cfg.pressureKpa = float(spec.get("pressureKpa", 101))
    cfg.partialGravity = bool(spec.get("partialGravity", False))
    cfg.seed = seed
    cfg.o2Source = {
        0: fe.O2SourceType.AMBIENT_CABIN,
        1: fe.O2SourceType.ENRICHED_PRESSURE,
        2: fe.O2SourceType.CHEMICAL_GENERATOR,
    }[int(o2_source)]
    ch = fe.Chamber(_risks)
    ch.configure(cfg)
    if mods is not None:
        ch.set_modifiers(mods)
    return ch
