# Dataset schema — `frontend/src/data/investigations.json`

The app consumes a single JSON file typed as `Dataset` in `frontend/src/types.ts`.

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
| `hazards` | enum[] | see `HazardTag` in `src/types.ts` |
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
```

Normalized per-run schema (`data/processed/experiments.csv`) is documented
in `docs/DATA_PIPELINE.md`.
