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
| `normalize_experiments.py` | parse test sheets/CSVs → `processed/experiments.csv|json` |
| `build_index.py` | merge all corpora → `processed/search_index.json`, `citations.json` |
| `fit_risk_model.py` | empirical LOC + risk surface → `shared/calibrated-data/risk_model.json` |
| `build_dataset.py` | merge curated/structured records → `data/bundle/investigations.json` |
| `calibrate_constants.py` | dataset → `shared/calibrated-data/calibration.json` + `risk_profiles.json` |

## Normalized experiment schema (`experiments.csv`)

One row per PSI test run. Key columns: `run_id`, `accession`,
`investigation_id`, `fuel`, `material_id`, `o2_pct`, `n2_pct`, `co2_pct`,
`he_pct`, `pressure_kpa`, `temp_k`, `flow_cms`, `droplet_d0_mm`,
`burn_rate_mm2_s`, `extinction_d_mm`, `outcome`
(burnout|extinction|no-ignition|disruption|unknown), `extinction_type`,
`cool_flame`, `fiber_support`, `source_file`, `verified`.

Rows parsed from real PSI files carry `verified=true` and keep their
`source_file` for citation-level provenance.

## Risk simulator (`/api/risk`, `/api/risk/curve`)

```
margin = o2_pct - locPct(material)
P_ign  = 0  (margin ≤ -3) | 0.04 (-3 < margin ≤ 0, µg low-O2 persistence)
       | min(1, 0.04 + 0.055·margin^1.35)
F_flow = piecewise on flow anchors (radiative window ~0 cm/s → O2-supply
         peak ~18 cm/s → blow-off quench >80 cm/s)
H      = 1 + 0.25·coolFlame + 0.15·smolder + 0.10·sootIndex
G      = gravity factor (µg 1.0, lunar 0.92, martian 0.95, earth 0.85)
risk   = clamp01(P_ign · F_flow · H · G)
```

`locSource = psi-data` means the LOC was re-estimated from parsed test
sheets; `calibration` means literature-seeded.

## SI/RAG endpoints (`backend/api/main.py`)

- `GET /api/search?q=&k=` — BM25-lite over all documents
- `POST /api/ask {q,k}` — answer + citations; aggregating questions route
  to DuckDB SQL over `experiments.csv` (`mode: sql-rag`), others to
  retrieval (`mode: retrieval`)
- `GET /api/risk?materialId=&o2Pct=&flowCms=&gravity=` — risk index + breakdown
- `GET /api/risk/curve?materialId=&flowCms=` — O₂ sweep for charts
- `GET /api/risk/materials` — material table (LOC, hidden factors, provenance)
- `GET /api/rag/stats` — corpus statistics
