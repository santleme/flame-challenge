# Data pipeline & SI layer — Flame in Freefall

End-to-end flow from NASA archives to the dashboard/game:

```
NASA PSI  (geode-py/ws API) ─┐
                             ├─► data/raw/ ─► data/pipelines/normalize_experiments.py
NASA NTRS (citations API) ───┘        │                  │
                                      ▼                  ▼
                          data/processed/experiments.csv|json
                          data/processed/search_index.json
                          data/processed/citations.json
                          shared/calibrated-data/risk_model.json
                                      │
              ┌───────────────────────┼─────────────────────┐
              ▼                       ▼                     ▼
   backend/services/rag.py   backend/services/risk.py   calibrate_constants.py
   (BM25-lite + DuckDB        (cabin risk_index)        (engine material table)
    SQL-RAG endpoints)                                     │
              └───────────────► backend/api/main.py ◄──────┘
                     /api/search /api/ask /api/risk /api/risk/curve
```

## PSI API recipe (reverse-engineered, public)

| Step | Call | Notes |
|---|---|---|
| Search | `GET /geode-py/ws/repo/search?term=&size=&from=` | ES-backed; `_source` carries full metadata (Objectives, Approach, Hypothesis, PI, dates) |
| Study list | `GET /geode-py/ws/studies` | all public accession ids (PSI-1 … PSI-191) |
| File tree | `POST /geode-py/ws/files/v2` `{fileType:"study", studyId, version:"1"}` | leaves carry `id`, `key` (real path), `bytes_size` |
| Presign | `GET /geode-py/ws/studies/{acc}/download?redirect=false` **with JSON body** `{file, version}` | returns presigned S3 URL as plain text |
| Download | `GET <presigned>` | must send **no extra headers** (signature covers them) |

Study *detail* endpoints (`/studies/{id}`) are 403 — controlled access —
but search metadata + file trees + per-file downloads are public.

## Scripts (`data/pipelines/`)

| Script | Role |
|---|---|
| `psi_search.py --all` | PSI investigation catalog → `raw/psi_investigations.json` |
| `psi_files.py --all` | file trees + selective small-file download → `raw/files/<ACC>/` + `_manifest.json` |
| `ntrs_search.py --all --fulltext N` | NTRS citations + fulltext dumps → `raw/ntrs_citations.json`, `raw/ntrs_txt/` |
| `normalize_experiments.py` | parse test sheets/CSVs → `processed/experiments.csv|json`; also folds the committed `data/psi/processed/` legacy corpus in via `parse_legacy_runs`/`parse_legacy_flex` for accessions the raw parsers never reached (BASS, SAFFIRE I–III, FLEX test points, extra ACME) |
| `build_index.py` | merge all corpora → `processed/search_index.json`, `citations.json` |
| `fit_risk_model.py` | empirical LOC + risk surface + engine constants (K(o2) fits, extinction diameters) → `shared/calibrated-data/risk_model.json`, patches `calibration.json` |
| `fit_uncertainty.py` *(optional)* | MAPIE split-conformal → `risk_model.json["uncertainty"]` (needs `requirements-sci.txt`) |
| `validate_scientific_bounds.py` *(optional)* | Cantera GRI-Mech T_ad/LOC + diluent ordering + SHAP audit → `processed/scientific_bounds_report.json` |
| `build_dataset.py` | merge curated/structured records → `data/bundle/investigations.json` |
| `calibrate_constants.py` | dataset → `shared/calibrated-data/calibration.json` + `risk_profiles.json` |
| `validate_engine.py` | replays scored runs through the engine → `processed/validation_report.json` (confusion matrix + burn-rate error; the gate for physics changes) |
| `build_master_sheet.py` | auditable per-run master sheet → `processed/nasa_combustion_master.csv` + `bundle/master_sheet.json` |
| `build_investigation_diffs.py` | curated run-pair diff cards → `bundle/investigation_diffs.json` |
| `build_site_snapshot.py` | bakes `/api/investigations` + `/api/insights` output → `site/src/data/psi_snapshot.json` (offline fallback for the dashboard section) |
| `test_pipelines.py` | pytest regression suite — outcome classification, cool-flame negation, NTRS extraction, catalog merges, starter restore (`pytest data/pipelines/test_pipelines.py`) |

## Normalized experiment schema (`experiments.csv`)

One row per PSI test run. Key columns: `run_id`, `accession`,
`investigation_id`, `fuel`, `material_id`, `o2_pct`, `o2_end_pct`,
`n2_pct`, `co2_pct`, `he_pct`, `pressure_kpa`, `temp_k`, `flow_cms`,
`mass_flow_lo_mgs`, `mass_flow_hi_mgs`, `zst`, `droplet_d0_mm`,
`burn_rate_mm2_s`, `burn_time_s`, `extinction_d_mm`, `outcome`
(burnout|extinction|no-ignition|disruption|unknown), `extinction_type`,
`cool_flame`, `fiber_support`, `comments`, `source_file`, `source_url`,
`verified`.

Rows parsed from real PSI files carry `verified=true` and keep their
`source_file` for citation-level provenance.

## Risk simulator (`/api/risk`, `/api/risk/curve`)

```
margin = o2_pct - locPct(material)
P_ign  = 0  (margin ≤ -3, hard dead band)
       | sigmoid(A + B·margin)        (PSI logistic fit, when fitted)
       | 0.04 (-3 < margin ≤ 0)       (unfitted fallback)
       | min(1, 0.04 + 0.055·margin^1.35)
F_flow = piecewise on flow anchors (radiative window ~0 cm/s → O2-supply
         peak ~18 cm/s → blow-off quench >80 cm/s)
H      = 1 + 0.25·coolFlame + 0.15·smolder + 0.10·sootIndex
G      = gravity factor (µg 1.0, lunar 0.92, martian 0.95, earth 0.85)
risk   = clamp01(P_ign · F_flow · H · G)
```

`P_ign` is fitted by logistic regression on outcome-labeled PSI runs
(y=1 for burnout/disruption). `ignitionFitScope` labels the evidence:
`material` (per-material fit, n≥25 with both classes), `material-null`
(≥15 labeled runs, all extinct — an explicit near-zero curve), or
`family:<droplet-fuels|gaseous-fuels|solid-materials>` (pooled fit for
sparse members). Unfitted materials keep the hand-set curve.

`locSource = psi-data` means the LOC was re-estimated from parsed test
sheets; `calibration` means literature-seeded.

## API endpoints (`backend/api/main.py`)

SI/RAG + risk:

- `GET /api/search?q=&k=` — BM25-lite over all documents
- `POST /api/ask {q,k}` — answer + citations; aggregating questions route
  to DuckDB SQL over `experiments.csv` (`mode: sql-rag`), others to
  retrieval (`mode: retrieval`)
- `GET /api/risk?materialId=&o2Pct=&flowCms=&gravity=` — risk index + breakdown
- `POST /api/risk` — same, JSON body
- `GET /api/risk/curve?materialId=&flowCms=` — O₂ sweep for charts
- `GET /api/risk/materials` — material table (LOC, hidden factors, provenance)
- `GET /api/risk/rank?o2Pct=&flowCms=&gravity=&top=` — every calibrated
  material sorted by risk index at the operating point, worst first
- `GET /api/rag/stats` — corpus statistics

Corpus → insight:

- `GET /api/investigations` — ranked investigation cards: composite score
  (0.35·flammability + 0.25·hiddenHazard + 0.25·explorationRelevance +
  0.15·dataRichness) with per-component breakdown, run stats and
  per-investigation engine-replay fidelity — `services/investigations.py`
- `GET /api/investigations/{id}` — detail card: summary, material fit
  provenance, sample real runs
- `GET /api/investigations/matrix` — dashboard attribute feed (objectives,
  fuels, conditions, variation, sensors)
- `GET /api/insights` — interpreted corpus findings, each citing its run
  counts and source investigations
- `GET /api/runs?investigation=&accession=&limit=` — normalized PSI runs
  for diff/neighbor pickers
- `GET /api/diff?a=&b=` — arbitrary run-pair diff
- `GET /api/diffs` — curated diff cards (`bundle/investigation_diffs.json`)
- `GET /api/neighbors?materialId=&o2Pct=&flowCms=&k=` — k nearest real PSI
  test runs to the requested operating point
- `GET /api/decision-cards?materialId=&o2Pct=&flowCms=&gravity=` — live
  countermeasure scores (fitted risk + KNN evidence + engine ignition
  pressure for provenance)
- `GET /api/mission-reports/templates` — canonical mission reports for the
  Golden Path demo (Artemis airlock, FLEX-2 cool flame, SAFFIRE-IV burn)

Engine surface:

- `GET /api/materials` + `POST /api/chamber/preview` — material table +
  chamber ignition preview through the C++ core
- `WS /ws/chamber` — 30 Hz live chamber telemetry

SI copilot:

- `POST /api/si/chat {message, current_chamber_state}` — text turn
- `POST /api/si/voice` — multipart `audio` + `state`; STT → same pipeline
- `POST /api/si/voice-command` — flat voice-first envelope (`transcript`,
  `briefing`, `navigation`, `simulation_commands`)
