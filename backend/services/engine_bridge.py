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


def ignition_pressure(material_id: str, o2_pct: float) -> float:
    """Direct C++ MaterialRisk::ignitionPressure — pure, no chamber state."""
    return max(0.0, _risks.ignition_pressure(material_id, float(o2_pct)))


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


def make_chamber(
    investigation_id: str,
    o2_pct: float,
    flow_cms: float | None = None,
    seed: int = 1,
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
    ch = fe.Chamber(_risks)
    ch.configure(cfg)
    return ch
