# NASA PSI data references — how each mechanic is anchored

Every experiment card in the game is a real record from the merged
dataset (`data/bundle/investigations.json`, sourced from the
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

## Provenance

Starter records carry `verified: false`; pipeline-ingested records set
`verified: true`. The UI surfaces the flag on each experiment card.
