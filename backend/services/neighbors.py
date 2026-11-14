"""Physical nearest-neighbor lookup over the parsed PSI run table.

When the operator moves the O₂ / ventilation / material dials, this finds
the k real NASA test runs closest to that operating point — a weighted
Euclidean distance over (ΔO₂, Δflow, material/fuel affinity), computed
against every row of data/processed/experiments.csv (1,090 runs).

No embeddings, no training: the similarity score is a deterministic
function of physically meaningful deltas, so the "89% match" chip is
auditable end-to-end.

    d = sqrt( (Δo2 / O2_SCALE)² + (Δflow / FLOW_SCALE)² + affinity² )
    similarity = 100 / (1 + d)
"""
from __future__ import annotations

import csv
import math
import re
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPERIMENTS = ROOT / "data" / "processed" / "experiments.csv"

# physical scales: 5 pct O₂ ≈ 20 cm/s flow ≈ a full material mismatch
O2_SCALE = 5.0
FLOW_SCALE = 20.0
# contribution when a run has no o2_pct — a full-scale miss, bounded so
# those rows lose to any measured run but never disappear entirely
O2_MISSING_PENALTY = 1.0

# affinity penalties between the queried material and the run's material
AFFINITY_EXACT = 0.0
AFFINITY_ALIAS = 0.15    # fuel string names the same substance
AFFINITY_CLASS = 0.5     # same physical class (liquid / gas / solid)
# > O2_MISSING_PENALTY — an unclassifiable row (no fuel, no material_id)
# must not outrank a confirmed same-material run just because the latter
# lacks an O₂ reading; < AFFINITY_OTHER since it's neutral, not mismatch
AFFINITY_UNKNOWN = 1.05
# > O2_MISSING_PENALTY so a same-material run with unrecorded O₂ still
# beats a different-class run at the exact point — material class is the
# strongest physical signal for "closest real test"
AFFINITY_OTHER = 1.5

# material_id / fuel-string synonyms seen in the PSI tables
MATERIAL_ALIASES: dict[str, tuple[str, ...]] = {
    "cotton": ("sibal", "cotton", "fiberglass"),
    "pmma": ("pmma", "acrylic", "plexiglass"),
    "pmma-sphere": ("pmma", "sphere"),
    "nomex": ("nomex",),
    "kapton": ("kapton",),
    "teflon": ("teflon", "ptfe"),
    "pyrell": ("pyrell",),
    "silicone": ("silicone",),
    "cellulose": ("cellulose", "paper"),
    "polycarbonate": ("polycarbonate",),
    "heptane": ("heptane", "n-heptane"),
    "iso-octane": ("isooctane", "iso-octane", "iso octane"),
    "jp8": ("jp8", "jp-8"),
    "dodecane": ("dodecane",),
    "decanol": ("decanol", "decan-1-ol"),
    "methanol": ("methanol", "meoh"),
    "ethanol": ("ethanol",),
    "ethylene": ("ethylene", "c2h4"),
    "ethane": ("ethane", "c2h6"),
    "methane": ("methane", "ch4"),
    "propane": ("propane", "c3h8"),
    "butane": ("butane", "c4h10"),
}

SOLID = {
    "pmma", "pmma-sphere", "cotton", "nomex", "kapton", "polycarbonate",
    "cellulose", "pyrell", "teflon", "thin-sheet", "panels", "silicone",
    "2-cm-sphere", "1-cm-sphere",
}
GAS = {"ethylene", "ethane", "methane", "propane", "butane"}
LIQUID = {
    "heptane", "methanol", "ethanol", "decanol", "iso-octane", "jp8",
    "dodecane", "japan-wax-candle-wake",
}


def _num(v: str | None) -> float | None:
    if not v:
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def _class_of(material_key: str) -> set[str]:
    if material_key in SOLID:
        return SOLID
    if material_key in GAS:
        return GAS
    return LIQUID


TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")


def _norm(text: str) -> str:
    """space-padded canonical form: lowercase, every non-alnum run → one
    space. 'Iso-Octane', 'iso octane' and 'iso-octane' all collapse to
    ' iso octane ', so aliases match regardless of hyphenation while a
    padded contains() keeps 'ethane' out of 'methane'."""
    return " " + " ".join(t for t in TOKEN_SPLIT.split(text.lower()) if t) + " "


def _has_alias(text_norm: str, alias: str) -> bool:
    a = _norm(alias)
    return len(a) > 2 and a in text_norm


def _row_material_key(row: dict) -> str | None:
    """Canonical material key for a run: material_id, else resolved fuel."""
    mid = (row.get("material_id") or "").strip().lower()
    if mid:
        return mid
    fuel_norm = _norm(row.get("fuel") or "")
    for key, aliases in MATERIAL_ALIASES.items():
        # whole-phrase match — 'ethane' must not catch inside 'methane',
        # but 'iso-octane' must catch 'iso-octane'/'iso octane'
        if any(_has_alias(fuel_norm, a) for a in aliases):
            return key
    return None


def _affinity(query_mat: str, row_mat: str | None, fuel: str) -> float:
    if not query_mat:
        return AFFINITY_CLASS
    if row_mat is None:
        return AFFINITY_UNKNOWN
    q = query_mat.lower()
    if row_mat == q:
        return AFFINITY_EXACT
    aliases = MATERIAL_ALIASES.get(q, (q,))
    # alias = same substance under another name; whole-phrase matching keeps
    # distinct chemicals apart ('ethane' ≠ 'methane', 'ethanol' ≠ 'methanol')
    hay = _norm(f"{fuel} {row_mat}")
    if any(_has_alias(hay, a) for a in aliases):
        return AFFINITY_ALIAS
    if row_mat in _class_of(q):
        return AFFINITY_CLASS
    return AFFINITY_OTHER


_lock = threading.Lock()
_rows: list[dict] | None = None


def _load() -> list[dict]:
    """Parse the CSV once into dicts with precomputed numeric fields."""
    global _rows
    if _rows is not None:
        return _rows
    with _lock:
        if _rows is not None:
            return _rows
        rows: list[dict] = []
        if EXPERIMENTS.exists():
            with EXPERIMENTS.open(newline="", encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    rows.append({
                        "run_id": r.get("run_id", ""),
                        "accession": r.get("accession", ""),
                        "investigation_id": r.get("investigation_id", ""),
                        "fuel": r.get("fuel", ""),
                        "o2_pct": _num(r.get("o2_pct")),
                        "flow_cms": _num(r.get("flow_cms")),
                        "outcome": r.get("outcome", "unknown"),
                        "cool_flame": (r.get("cool_flame") or "").lower() == "true",
                        "source_url": r.get("source_url", ""),
                        "verified": (r.get("verified") or "").lower() == "true",
                        "material_key": _row_material_key(r),
                    })
        _rows = rows
        return _rows


def reload() -> None:
    global _rows
    _rows = None


def _distance(row: dict, o2_pct: float, flow_cms: float, material_id: str) -> float:
    if row["o2_pct"] is None:
        o2_term = O2_MISSING_PENALTY
    else:
        o2_term = (row["o2_pct"] - o2_pct) / O2_SCALE
    # quiescent default: missing flow means the run burned in still air
    row_flow = row["flow_cms"] if row["flow_cms"] is not None else 0.0
    flow_term = (row_flow - flow_cms) / FLOW_SCALE
    aff = _affinity(material_id, row["material_key"], row["fuel"])
    return math.sqrt(o2_term * o2_term + flow_term * flow_term + aff * aff)


def nearest(
    material_id: str,
    o2_pct: float,
    flow_cms: float = 0.0,
    k: int = 3,
) -> list[dict]:
    """Top-k real PSI runs closest to the requested operating point."""
    rows = _load()
    k = max(1, min(int(k), 10))
    scored = []
    for row in rows:
        d = _distance(row, float(o2_pct), float(flow_cms), material_id)
        scored.append((d, row))
    scored.sort(key=lambda x: x[0])
    out = []
    for d, row in scored[:k]:
        out.append({
            "runId": row["run_id"],
            "accession": row["accession"],
            "investigationId": row["investigation_id"],
            "fuel": row["fuel"],
            "materialKey": row["material_key"],
            "o2Pct": row["o2_pct"],
            "flowCms": row["flow_cms"],
            "outcome": row["outcome"],
            "coolFlame": row["cool_flame"],
            "similarity": round(100.0 / (1.0 + d), 1),
            "sourceUrl": row["source_url"],
            "verified": row["verified"],
        })
    return out
