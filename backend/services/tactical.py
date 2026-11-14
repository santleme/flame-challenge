"""Tactical copilot — ranks live shipyard modules by multifactor risk
and produces citation-anchored advice.

Ranking queries the C++ engine's 4-axis risk vector per module
(ignition / propagation / detection / toxicity) and sorts by the
max axis. Advice is generated deterministically from the module state
plus the matching psi_experiments.json record — no LLM required, so
the output is reproducible and every claim carries a PSI citation.
"""
from __future__ import annotations

import json
from pathlib import Path

from backend.services import engine_bridge as eb

ROOT = Path(__file__).resolve().parents[2]
EXPERIMENTS = ROOT / "shared" / "calibrated-data" / "psi_experiments.json"

_AXIS_LABEL = {
    "ignition": "ignição",
    "propagation": "propagação",
    "stealth": "detecção",
    "toxicity": "persistência/toxicidade",
}

_exp_cache: list[dict] | None = None


def _experiments() -> list[dict]:
    global _exp_cache
    if _exp_cache is None:
        if EXPERIMENTS.exists():
            _exp_cache = json.loads(EXPERIMENTS.read_text()).get("experiments", [])
        else:
            _exp_cache = []
    return _exp_cache


def reload() -> None:
    global _exp_cache
    _exp_cache = None


def _best_citation(material_name: str, o2: float, flow: float) -> dict:
    """Pick the PSI record whose atmosphere envelope best matches."""
    best, best_score = None, -1.0
    for e in _experiments():
        o2r = e.get("o2_percent") or [0, 0]
        fr = e.get("airflow_cm_s") or [0, 0]
        if not (o2r[0] <= o2 <= o2r[1]):
            continue
        score = 1.0
        if fr[0] <= flow <= fr[1]:
            score += 1.0
        if material_name and material_name.lower() in e.get(
                "fuel_or_material", "").lower():
            score += 2.0
        if score > best_score:
            best, best_score = e, score
    if best is None and _experiments():
        best = _experiments()[0]
    return best or {}


def _axes(rv, flow: float) -> dict:
    """Recompose engine risk vector into the 4 UI axes."""
    propagation = min(1.0, rv.spread_velocity_mm_s / 50.0)
    # airflow >15 cm/s feeding the flame dominates propagation
    if flow >= 15 and rv.spread_velocity_mm_s > 10:
        propagation = min(1.0, propagation * 1.3)
    return {
        "ignition": rv.ignition_risk,
        "propagation": propagation,
        "stealth": rv.cool_flame_stealth_index,
        "toxicity": rv.toxicity_buildup,
    }


def rank_modules(modules: list[dict]) -> dict:
    """Score every active module, return them sorted by criticality."""
    ranked = []
    mods = eb.tech_modifiers()
    for m in modules:
        mat = m.get("materialId", "pmma")
        o2 = float(m.get("o2Pct", 21.0))
        flow = float(m.get("flowCms", 0.0))
        rv = eb.risk_vector(mat, o2, flow, mods)
        axes = _axes(rv, flow)
        dominant = max(axes, key=axes.get)
        score = axes[dominant]
        cite = _best_citation(m.get("materialName", ""), o2, flow)
        ranked.append({
            "moduleId": m.get("moduleId", "?"),
            "score": round(score, 3),
            "dominantFactor": dominant,
            "dominantFactorLabel": _AXIS_LABEL[dominant],
            "axes": {k: round(v, 3) for k, v in axes.items()},
            "spreadVelocityMmS": round(rv.spread_velocity_mm_s, 2),
            "citation": {
                "psi_id": cite.get("psi_id"),
                "psi_url": cite.get("psi_url"),
                "fuel": cite.get("fuel_or_material"),
            } if cite else None,
        })
    ranked.sort(key=lambda r: r["score"], reverse=True)
    return {"ranked": ranked, "engine": "c++"}


def advise(module: dict) -> dict:
    """Strict-JSON tactical advice anchored to a PSI record.

    Returns the five keys the frontend HUD renders verbatim:
    diagnostico_fisico, acao_imediata_1, acao_imediata_2,
    erro_a_evitar, citacao_nasa_id.
    """
    mat = module.get("materialId", "pmma")
    o2 = float(module.get("o2Pct", 21.0))
    flow = float(module.get("flowCms", 0.0))
    o2_source = int(module.get("o2Source", 0))
    mods = eb.tech_modifiers()
    rv = eb.risk_vector(mat, o2, flow, mods)
    axes = _axes(rv, flow)
    dominant = max(axes, key=axes.get)
    cite = _best_citation(module.get("materialName", ""), o2, flow)
    cid = cite.get("psi_id", "PSI")

    if o2_source == 2:  # Mir chemical generator
        diag = ("Fogo auto-oxidante tipo gerador Vika (Mir 1997): o "
                "oxidante viaja dentro do próprio combustível — a chama "
                "sobrevive mesmo com O₂ de cabine abaixo do LOC.")
        a1 = ("Aplicar resfriamento contínuo no módulo — é a ÚNICA "
              "contramedida que interrompe a reação.")
        a2 = ("Isolar o setor e preparar a equipe: a cabine inteira está "
              "em risco de contaminação térmica.")
        err = ("ERRO: cortar ventilação/O₂ NÃO apaga este fogo — foi o "
               "primeiro reflexo da tripulação da Mir e falhou.")
    elif o2_source == 1:  # Apollo 1
        diag = ("Atmosfera enriquecida estilo Apollo 1: materiais marginais "
                "em 21% O₂ tornam-se agressivamente inflamáveis — ignição "
                "e flashover em segundos.")
        a1 = "Despressurizar imediatamente — reduzir pressão/O₂ parcial."
        a2 = "Evacuar o crew do módulo antes de qualquer tentativa de supressão."
        err = ("ERRO: confiar em materiais 'seguros em laboratório' — em "
               "O₂ enriquecido a margem LOC não vale.")
    elif dominant == "propagation" and flow >= 15:
        still = eb.risk_vector(mat, o2, 0.0, mods)
        mult = (rv.spread_velocity_mm_s /
                max(still.spread_velocity_mm_s, 1e-3))
        diag = (f"Fluxo de ar de {flow:.0f} cm/s está acelerando a "
                f"propagação em {mult:.1f}x segundo {cid}.")
        a1 = "Cortar a ventilação do módulo — remove o driver de propagação."
        a2 = f"Reduzir O₂ para <{15}% — abaixo do LOC do material."
        err = ("ERRO: deixar ventilação ligada 'para dispersar fumaça' — "
               "ar forçado alimenta a frente de chama em opposed-flow.")
    elif dominant == "stealth":
        diag = (f"Chama fria/invisível provável (stealth {axes['stealth']:.0%}) "
                f"— o olho nu não veria; {cid} documenta o regime.")
        a1 = "Varrer o módulo com sensores térmicos, não inspeção visual."
        a2 = "Manter distância do crew — cool flames reacendem em chama quente."
        err = "ERRO: declarar 'fogo extinto' só porque não há chama visível."
    elif dominant == "toxicity":
        diag = (f"Carga de CO/fuligem dominante ({axes['toxicity']:.0%}) — "
                f"o maior risco é ao crew, não à estrutura; {cid}.")
        a1 = "Retirar o crew e isolar a ventilação do módulo afetado."
        a2 = "Supressão localizada no foco antes que a carga tóxica cresça."
        err = "ERRO: enviar crew sem proteção térmica para apagar de perto."
    else:
        diag = (f"Risco de ignição dominante ({axes['ignition']:.0%} acima "
                f"do LOC) — prevenção ainda é a melhor ação; {cid}.")
        a1 = f"Reduzir O₂ de {o2:.0f}% para <15% no módulo."
        a2 = "Desligar fontes de ignição (fabricação, experimentos)."
        err = "ERRO: ignorar um módulo 'só porque não pegou fogo ainda'."

    return {
        "diagnostico_fisico": diag,
        "acao_imediata_1": a1,
        "acao_imediata_2": a2,
        "erro_a_evitar": err,
        "citacao_nasa_id": cid,
        "citation": {
            "psi_id": cid,
            "psi_url": cite.get("psi_url"),
            "fuel": cite.get("fuel_or_material"),
        },
        "dominantFactor": dominant,
        "axes": {k: round(v, 3) for k, v in axes.items()},
    }
