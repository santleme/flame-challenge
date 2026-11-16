# Dataset schema — `data/bundle/investigations.json`

The merged dataset lives in a single JSON file (`data/bundle/investigations.json`).

```jsonc
{
  "schemaVersion": 1,
  "generated": "curated-starter | psi-ntrs-pipeline",
  "note": "provenance note",
  "investigations": [ /* Investigation[] */ ]
}
```

## Investigation record

| Field | Type | Notes |
|---|---|---|
| `id` | string | slug, unique (e.g. `sofie-gel`) |
| `name` | string | short name shown in UI |
| `title` | string | full investigation title |
| `agencies` | string[] | e.g. `["NASA"]`, `["JAXA","NASA"]` |
| `platform` | string | ISS, Cygnus, Kibo… |
| `facility` | string\|null | CIR, MSG, Glovebox… |
| `years` | string | e.g. `"2009–2014"` |
| `status` | `completed`\|`ongoing` | |
| `category` | enum | `solid-flame-spread`, `droplet`, `gaseous-diffusion`, `large-scale-fire`, `smoke-aerosol`, `confined`, `partial-gravity` |
| `gravity` | enum | `microgravity`, `partial-gravity`, `mixed` |
| `fuels` | string[] | material names |
| `conditions.oxygenPct` | `[min,max]`\|null | tested O₂ range |
| `conditions.flowCms` | `[min,max]`\|null | forced-flow range |
| `conditions.pressureKpa` | number\|null | ambient pressure |
| `conditions.explorationRelevant` | boolean | relevant to Moon/Mars missions |
| `metrics.limitingOxygenPct` | number\|null | LOC — lower = more hazardous |
| `metrics.flameSpreadRateCms` | `{min,max}`\|null | |
| `metrics.coolFlameObserved` | boolean | FLEX-type hidden combustion |
| `metrics.smolderObserved` | boolean | |
| `keyFindings` | string[] | 2–4 bullets, plain language |
| `safetyImplications` | string[] | actionable fire-safety takeaways |
| `objectives` | string[] | experiment goals (dashboard attribute) |
| `apparatus` | string | rig/hardware, incl. fuel form & size context |
| `sensors` | string[] | measurement types used (dashboard attribute) |
| `testVariables.held` / `.varied` | string[] | intra-experiment variation: controls vs swept parameters (dashboard attribute) |
| `themes` | enum[] | `detection`, `suppression`, `duct-flow`, `partial-gravity`, `large-scale`, `spread`, `flammability` — the filter chips |
| `conditions.suppressants` | string[] | optional — diluents tested (FLEX: N₂, CO₂, He) |
| `hazards` | enum[] | `cool-flames`, `smolder-risk`, `detection-gap`, `exploration-atmosphere`, `large-scale-spread`, `low-oxygen-persistence`, `partial-gravity`, `toxic-aerosol` — `string[]` in `site/src/lib/api.ts` |
| `data.availability` | `full`\|`partial`\|`metadata-only` | |
| `data.psiUrl` | string\|null | PSI record link |
| `publications` | number | rough count of related papers |
| `verified` | boolean | `false` = starter value pending PSI verification |

## Pipeline-emitted provenance fields

`data/pipelines/normalize_experiments.py` emits partial records under
`data/raw/structured/psi_experiments.json` for investigations whose PSI
test files were parsed. `build_dataset.py` deep-merges them (nested
`metrics`/`conditions`/`data` merge key-wise) and sets `verified: true`.

| Field | Type | Notes |
|---|---|---|
| `psiRuns` | number | parsed test runs for this investigation |
| `psiAccessions` | string[] | PSI accession ids the runs came from |
| `psiFuels` | string[] | fuels observed in the parsed files |
| `psiO2RangePct` | `[min,max]` | O₂ envelope across parsed runs — drives the experiment dial bounds |
| `psiFlowRangeCms` | `[min,max]` | forced-flow envelope across parsed runs (emitted only when runs record `flow_cms`) |
| `psiExtinctionLimitPct` | `{min,max}` | measured extinction envelope (not LOC) |
| `metrics.coolFlameObserved` | boolean | set only when ≥5% of runs show cool flames |

## Pipeline

```bash
./.venv/bin/python data/pipelines/psi_search.py --all       # PSI catalog -> data/raw/
./.venv/bin/python data/pipelines/psi_files.py --all        # per-test files -> data/raw/files/
./.venv/bin/python data/pipelines/ntrs_search.py --all --fulltext 3
./.venv/bin/python data/pipelines/normalize_experiments.py  # -> processed/experiments.csv
                                                            # + raw/structured/psi_experiments.json
./.venv/bin/python data/pipelines/build_index.py            # -> processed/search_index.json
./.venv/bin/python data/pipelines/fit_risk_model.py         # -> shared/calibrated-data/risk_model.json
./.venv/bin/python data/pipelines/build_dataset.py          # merges structured records
./.venv/bin/python data/pipelines/build_dataset.py --sample # restore starter dataset
./.venv/bin/python data/pipelines/calibrate_constants.py    # dataset -> calibration.json
./.venv/bin/python data/pipelines/build_master_sheet.py        # auditable master CSV + bundle/master_sheet.json
./.venv/bin/python data/pipelines/build_investigation_diffs.py # -> bundle/investigation_diffs.json
./.venv/bin/python data/pipelines/build_site_snapshot.py       # -> site/src/data/psi_snapshot.json
```

Normalized per-run schema (`data/processed/experiments.csv`) is documented
in `docs/DATA_PIPELINE.md`.

## Diff cards — `data/bundle/investigation_diffs.json`

`data/pipelines/build_investigation_diffs.py` diffs curated pairs of real
runs (same investigation, one variable isolated) into `cards[]`:
`runA`/`runB` snapshots, `changed[{field,label,a,b}]`,
`held[{field,label,value}]`, plus a human `insight`. Served live by
`GET /api/diffs`; arbitrary pairs by `GET /api/diff?a=<runId>&b=<runId>`.

## Conformal uncertainty — `shared/calibrated-data/risk_model.json`

`data/pipelines/fit_uncertainty.py` (optional deps:
`data/pipelines/requirements-sci.txt`) wraps the analytical risk model
in an sklearn adapter and runs MAPIE split-conformal calibration over the
labeled PSI runs. It appends an `uncertainty` block to the canonical
artifact — consumed identically by the backend and the site's offline
mirror, never recomputed at request time:

```jsonc
{
  "uncertainty": {
    "levels": [0.8, 0.9, 0.95],
    "defaultLevel": 0.9,
    "global": { "0.8": 0.473, "0.9": 0.717, "0.95": 0.827 },  // halfwidths
    "scopes": { "material:heptane": { /* same shape + n */ } },
    "empiricalCoverage": { "0.9": 0.9101 },
    "envelope": {                              // labeled-run feature hull
      "o2Margin": [min, max],
      "flowCms": [min, max],
      "gravityFactor": [min, max]
    },
    "labeledRuns": 378
  }
}
```

`GET /api/risk` then answers with a runtime `uncertainty` object:
`{lower, upper, halfwidth, effectiveHalfwidth, scaled, regime,
extrapolationScore, scope, calibrationN, empiricalCoverage}`. Inputs
inside `envelope` → `regime:"interpolation"`; outside →
`regime:"extrapolation"` with the halfwidth widened by the score
(conformal coverage is only guaranteed in-envelope — flagged, not
hidden). `/api/risk/curve` points carry `lower`/`upper` band bounds.

## Exact Shapley explanation — `explanation` block on `/api/risk`

`risk = P·F·H·G` is multilinear, so the interventional Shapley values of
the deviation from a fixed benign baseline `(0.04, 1.0, 1.0, 1.0)` have a
closed form (`backend/services/explain.py`; the TypeScript mirror in
`site/src/lib/risk.ts` computes the same numbers offline). The validator
re-derives every value with `shap.ExactExplainer` — agreement ~2e-16.

```jsonc
{
  "explanation": {
    "method": "exact-shapley-multiplicative",
    "baselineRisk": 0.04,
    "deviation": 0.245,          // Σ phi — additive efficiency holds
    "contributions": [           // sorted by |share| desc
      {"factor": "o2Margin", "label": "o₂ margin vs loc",
       "value": 0.209, "baseline": 0.04, "phi": 0.200, "share": 0.74}
    ]
  }
}
```

## Scientific bounds — `data/processed/scientific_bounds_report.json`

`data/pipelines/validate_scientific_bounds.py` certifies the model
against Cantera GRI-Mech 3.0 equilibrium: `tadAtLocK` per calibrated fuel
inside the flame-limit window, the O₂ where T_ad crosses 1500 K vs the
fitted `locPct`, and the CO₂>N₂>He diluent-suppression ordering (He
evaluated via Ar — identical molar heat capacity). C10+ fuels are
reported as outside the mechanism scope. Also ships the SHAP audit and
the conformal coverage summary.
