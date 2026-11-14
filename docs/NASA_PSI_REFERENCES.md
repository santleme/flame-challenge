# NASA PSI data references — how each mechanic is anchored

Every experiment card in the game is a real record from the merged
dataset (`frontend/src/data/investigations.json`, sourced from the
NASA Physical Sciences Informatics repository — psi.nasa.gov/physci/repo).

| Game element | Dataset field(s) | Record(s) |
|---|---|---|
| Ignition-risk dial (O₂%) | `conditions.oxygenPct`, `metrics.limitingOxygenPct` | SoFIE-GEL (LOC 15%), BASS-II (LOC 17%) |
| Fire spread speed on deck | `metrics.flameSpreadRateCms` | SoFIE-GEL 0.3–3.5 cm/s, BASS-II 0.2–4.0, SAFFIRE 0.5–18 |
| Invisible fire (blue shimmer, no alarm) | `metrics.coolFlameObserved`, `hazards: cool-flames`, `detection-gap` | FLEX-2 |
| Post-extinguish re-ignition | `metrics.smolderObserved`, `hazards: smolder-risk` | BASS-II, SAFFIRE |
| Extra risk / yield weight | `hazards`, `data.availability`, `publications` | all |
| Event-log citations | `keyFindings`, `safetyImplications`, `name` | all |
| Material table (C++ core) | aggregated per-fuel metrics → `calibration.json` | all |

## Dataset → engine mapping

`data/pipelines/calibrate_constants.py` aggregates fuels across
records into engine materials and maps each investigation to a physics
model:

- `droplet` → `DropletFlame` (FLEX-2, ACME)
- `solid-flame-spread | large-scale-fire | confined | smoke-aerosol | partial-gravity`
  → `SolidSpread` (SoFIE-GEL, BASS-II, SAFFIRE, SAMe, Confined Combustion, FLARE)

## Equation → code → PSI traceability

| Physics in code | File / symbol | Anchored to | Canonical NASA PSI ref |
|---|---|---|---|
| Ignition pressure `0.04 + 0.055·(O₂−LOC)^1.35` | `core/src/material_risk.cpp` `ignitionPressure` | LOC ladder: SoFIE-GEL 15%, BASS-II 17% | PSI SoFIE-GEL, PSI BASS-II |
| d²-law droplet burn `D² = D₀² − K·t` | `core/src/combustion_solver.cpp` `DropletFlame` | n-heptane D₀≈1 mm, hot→cool regime | PSI FLEX / FLEX-2 |
| Opposed-flow spread `v = v₀ + Δv·(margin/25)^0.8 · (1+flow/20)` | `core/src/airflow_propagator.cpp` `nominalRate` | forced-flow enhancement 0–25 cm/s | PSI SAFFIRE (I–VI) |
| Quiescent extinction `flow<1 cm/s ∧ O₂<LOC+3` | `oxygenLimitExtinct` / `quiescentExtinct` | radiative-loss regime | PSI SoFIE-GEL |
| 4-axis risk vector (ignition/propagation/stealth/toxicity) | `material_risk.cpp` `riskVector` | per-fuel LOC + soot + cool-flame fields | ACME material flammability |
| Cool-flame stealth axis | `riskVector` detection term | blue, near-invisible cool flames | PSI FLEX-2 |
| Apollo-1 enriched regime ×2.5 spread | `nominalRate` `o2Source==1` | 100% O₂ pad fire flashover | AS-204 investigation report |
| Mir-1997 self-oxidizing regime | `oxygenLimitExtinct` `o2Source==2` | Vika perchlorate candle fire | Mir 1997 incident report |
| Spin-off modifiers (detector/tanks/attire) | `TechModifiers` | NASA Spinoff fire-safety tech | tech_spinoffs.json sources |

Historical-scenario game effects live in
`shared/calibrated-data/historical_scenarios.json` (`effects` block):
seed fraction, initial intensity, spread multiplier, self-oxidizing
flag, safety hit, crew burn multiplier — applied by
`frontend/src/game/scenarios.ts::applyScenario`.

## Provenance

Starter records carry `verified: false`; pipeline-ingested records set
`verified: true`. The UI surfaces the flag on each experiment card.
Regenerate the base with:

    python data/pipelines/build_nasa_knowledge_base.py
