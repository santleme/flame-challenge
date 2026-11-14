"""Tactical synthesis engine — deterministic, offline, zero latency.

Takes the same fitted risk numbers the C++ core / /api/risk expose plus
the k nearest real PSI runs (services.neighbors) and synthesizes:

  - efficacy scores (0-100) for each countermeasure, computed by
    re-evaluating the risk model under the counterfactual condition
    (cut flow, drop O₂, suppress) — the bars on the decision cards;
  - a regime-keyed briefing assembled from templates over the physics
    flags (below-LOC, cool-flame, smoldering, forced-flow regime).

Everything here is a pure function of risk_model.json + experiments.csv.
"""
from __future__ import annotations

from backend.services import neighbors, risk

# suppression efficacy model — deterministic priors per material flags,
# normalized by the fitted hidden-hazard factor (>= 1). Values chosen so
# a generic polymer sits near crew-manual efficacy (~70%) and hidden /
# self-sustaining regimes degrade it.
INERT_GAS_BASE = 0.80
MIST_BASE = 0.85

DISPLAY_NAME = {
    "saffire": "SAFFIRE",
    "flex-2": "FLEX-2",
    "acme": "ACME",
    "bass-ii": "BASS-II",
    "sofie-gel": "SoFIE-GEL",
    "same": "SAME",
    "confined-combustion": "Confined Combustion",
    "flare": "FLARE",
}


def _pct(x: float) -> int:
    return max(0, min(100, round(x)))


def _safe_index(mat: str, o2: float, flow: float, g: str) -> float:
    return risk.risk_index(mat, o2, flow, g)["riskIndex"]


def _regime_clause(r: dict, flow_cms: float) -> str:
    """One physics sentence keyed on the dominant regime flags."""
    f = r["flags"]
    if f["belowLoc"]:
        return ("Cabin sits below the material's limiting-oxygen index — "
                "quiescent regime; ventilation is free to clear smoke.")
    if f["coolFlameCapable"]:
        return ("FLEX-class fuel: cool flames persist below detector "
                "thresholds after the hot flame dies — 'out' is a "
                "monitoring window, not safety.")
    if flow_cms >= 8:
        return ("Forced flow is in the SAFFIRE propagation regime — "
                "cutting ventilation is the strongest single lever.")
    if f["smoldering"]:
        return ("Smolder-capable polymer — knock-down can leave "
                "re-igniting pockets; water-mist beats gas-only "
                "suppression.")
    return "Ignition-pressure limited regime — O₂ margin is the lever."


def _briefing(r: dict, gravity: str, nb: list[dict]) -> str:
    mat = r["materialName"]
    head = (f"{mat} at {r['o2Pct']}% O₂ / {r['flowCms']} cm/s ({gravity}): "
            f"risk index {round(r['riskIndex'] * 100)}% ({r['level']}) — "
            f"margin {r['margin']} pt vs LOC {r['locPct']}%. ")
    clause = _regime_clause(r, r["flowCms"])
    if nb:
        top = nb[0]
        evid = (f" Nearest real test: {top['accession']} run "
                f"{top['runId']} ({top['fuel'] or top['materialKey']}, "
                f"{top['similarity']}% match, outcome {top['outcome']}).")
    else:
        evid = ""
    return head + clause + evid


def _suppression_scores(r: dict, cool: bool, smolder: bool, hidden: float) -> tuple[int, int, int]:
    inert = _pct((INERT_GAS_BASE - 0.25 * smolder - 0.10 * cool) / hidden * 100)
    mist = _pct((MIST_BASE - 0.05 * smolder) / hidden * 100)
    # monitor-only is scored on DETECTION adequacy, not knock-down: hidden
    # hazards eat it, high ambient risk degrades it — it can never beat a
    # real countermeasure on a dangerous regime
    detect = max(0.0, 1 - 0.5 * hidden - 0.30 * cool - 0.25 * smolder)
    monitor = _pct(detect * (1 - 0.5 * r["riskIndex"]) * 100)
    return inert, mist, monitor


def decision_cards(
    material_id: str,
    o2_pct: float,
    flow_cms: float = 0.0,
    gravity: str = "microgravity",
    k: int = 3,
) -> dict:
    """Assemble the three live decision cards + briefing + KNN evidence."""
    r = risk.risk_index(material_id, o2_pct, flow_cms, gravity)
    mat = r["materialId"]
    loc = r["locPct"]
    o2, flow = float(o2_pct), float(flow_cms)
    cool = r["flags"]["coolFlameCapable"]
    smolder = r["flags"]["smoldering"]
    hidden = r["breakdown"]["hiddenFactor"]

    nb = neighbors.nearest(mat, o2, flow, k)
    sources = []
    for n in nb:
        name = DISPLAY_NAME.get(n["investigationId"], n["accession"])
        if name not in sources:
            sources.append(name)

    def opt(label: str, why: str, o2m: float, flowm: float,
            action: str, score: float | None = None) -> dict:
        # no explicit score → efficacy = 1 - risk at the counterfactual point
        s = score if score is not None else (
            1 - _safe_index(mat, o2m, flowm, gravity)) * 100
        return {
            "label": label,
            "why": why,
            "score": _pct(s),
            "action": action,
            "model": {"materialId": mat, "o2Pct": round(o2m, 2),
                      "flowCms": round(flowm, 2), "gravity": gravity},
        }

    inert, mist, monitor = _suppression_scores(r, cool, smolder, hidden)

    cards = [
        {
            "id": "containment",
            "context": "CONTAINMENT · CABIN AIRFLOW",
            "question": f"Fire signature in {r['materialName']} — how should the "
                        "ventilation loop be operated right now?",
            "preset": "saffire",
            "metric": "containment efficacy",
            "options": [
                opt("Cut ventilation to 0 cm/s",
                    "starves oxidizer diffusion — SAFFIRE forced-flow regime collapses"
                    if flow >= 8 else
                    "drops the flame to its quiescent rate",
                    o2, 0, "cut-vent"),
                opt(f"Halve the flow ({round(flow / 2)} cm/s)",
                    "slow-propagation regime — smoke clearing retained",
                    o2, flow / 2, "halve-flow"),
                opt(f"Keep forced flow ({round(flow)} cm/s)",
                    "duct-propagation speed — highest spread risk"
                    if flow >= 8 else
                    "current operating point",
                    o2, flow, "keep-flow"),
            ],
            "sources": sources,
            "neighbors": nb,
        },
        {
            "id": "atmosphere",
            "context": "ATMOSPHERE · O₂ MARGIN",
            "question": f"Where should cabin O₂ be set against the {loc}% LOC?",
            "preset": "apollo-1",
            "metric": "safe margin",
            "options": [
                opt(f"Hold {o2}% O₂",
                    "current margin — no action",
                    o2, flow, "hold-o2"),
                opt(f"Reduce toward LOC ({round(loc + 1, 1)}% O₂)",
                    "exploration-atmosphere target — margin shrinks to ~1 pt",
                    loc + 1, flow, "reduce-o2"),
                opt(f"Drop below LOC ({round(loc - 0.5, 1)}% O₂)",
                    "ignition pressure collapses — the Apollo-1 lesson in reverse",
                    loc - 0.5, flow, "below-loc"),
            ],
            "sources": sources,
            "neighbors": nb,
        },
        {
            "id": "suppression",
            "context": "SUPPRESSION & DETECTION",
            "question": "Which response actually ends the event — and which only hides it?",
            "preset": "mir",
            "metric": "knock-down efficacy",
            "options": [
                opt("Inert-gas flood (N₂/CO₂)",
                    ("smolder-capable material — knock-down risks re-ignition"
                     if smolder else "displaces oxidizer at the seat"),
                    o2, flow, "inert-gas", inert),
                opt("Water-mist cool",
                    ("penetrates the polymer — best against smolder pockets"
                     if smolder else "cools below re-ignition temperature"),
                    o2, flow, "water-mist", mist),
                opt("Monitor-only protocol",
                    ("cool-flame fuels defeat optical clear — documented FLEX hazard"
                     if cool else "accept the burn and watch it"),
                    o2, flow, "monitor", monitor),
            ],
            "sources": sources,
            "neighbors": nb,
        },
    ]

    return {
        "material": r,
        "briefing": _briefing(r, gravity, nb),
        "neighbors": nb,
        "cards": cards,
    }
