<div align="center">

<img src="assets/readme/shipyard.png" alt="IGNIS — Freefall Foundry orbital shipyard" width="95%" />

<img src="assets/readme/nasa-meatball.png" width="72" alt="NASA" />

### NASA Space Apps Challenge 2026 · *Flame in Freefall*

# Freefall Foundry

**An orbital shipyard management sim** — Prison-Architect-style 2.5D isometric —
where scientists and engineers build modules, run microgravity combustion
experiments and fabricate a spacecraft. Every ignition risk, fire spread and
hidden-flame incident is computed from **real NASA Physical Sciences
Informatics (PSI) records** and a compiled **C++20 physics core**.

<img src="https://img.shields.io/badge/C%2B%2B-20-00599C?logo=cplusplus&logoColor=white" alt="C++20" />
<img src="https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
<img src="https://img.shields.io/badge/data-NASA%20PSI%20records-0B3D91" alt="NASA PSI data" />

</div>

---

## Run it

```bash
# C++ physics backend
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd core && cmake -S . -B build -DPython3_EXECUTABLE=/usr/bin/python3 \
  && cmake --build build -j && cd ..
.venv/bin/python data/pipelines/calibrate_constants.py
.venv/bin/python data/pipelines/fit_risk_model.py   # restores the fitted
                                                    # engine constants
.venv/bin/uvicorn backend.api.main:app --port 8000
# → http://localhost:8000/docs for the interactive API

# IGNIS site (dashboard + sim console)
cd site && npm install && npm run dev
# → http://localhost:5173 (proxies /api → :8000)
```

## The loop

- **Build** modules adjacent to the dock (deck, quarters, lab, combustion
  chamber, fabrication bay). Engineers construct and repair.
- **Experiment**: click a Combustion Chamber → pick a real PSI
  investigation (SoFIE-GEL, BASS-II, FLEX-2, SAFFIRE…) → dial O₂ inside
  its tested range. Higher above the limiting oxygen concentration → more
  science, more ignition risk.
- **Incidents**: failures ignite fires that spread at the record's real
  flame-spread rate. Cool flames burn near-invisibly; smolder reignites.
  Crew flee, engineers extinguish. Casualties cost safety.
- **Win**: 100% hull completion. **Lose**: safety hits 0% or crew dies.

> Playable build is still a visual prototype (`game-visual/`). The
> shipped pieces today: the C++ engine, the PSI ETL, the FastAPI layer
> and the IGNIS site — dashboard, PSI explorer and the voice-enabled
> sim console.

## Repository layout

```
core/        C++20 physics: droplet d²-law (FLEX), SAFFIRE spread,
             ACME material risk + pybind11 (Emscripten-ready)
data/        NASA PSI/NTRS ETL → experiments.csv, search index, risk model
             (+ data/bundle/: merged dataset & generated JSON artifacts,
             + data/psi/: committed pre-normalized PSI corpus)
backend/     FastAPI bridge: /api/chamber/preview, WS /ws/chamber,
             /api/search, /api/ask, /api/risk(+curve/materials/rank),
             /api/investigations(+/{id},/matrix), /api/insights,
             /api/runs, /api/diff, /api/diffs, /api/decision-cards,
             /api/neighbors, /api/materials, /api/rag/stats,
             /api/mission-reports/templates,
             /api/si/chat, /api/si/voice, /api/si/voice-command
site/        IGNIS front end (Vite/React): editorial landing +
             PsiDataset explorer + SimDeck/SimConsole (agent console,
             chat + voice) + summarize·rank·interpret dashboard
game-visual/ standalone vanilla-JS shipyard visual prototype
scripts/     si_up.sh (local SI sidecars), start_prod.sh (container CMD)
docs/        ARCHITECTURE.md, DATA_PIPELINE.md, DEPLOY.md, SI_SETUP.md,
             NASA_PSI_REFERENCES.md, challenge brief, data-schema.md
```

Scope: cabin, habitat and crewed-vehicle fire safety only — rocket-motor
and propellant combustion is out of scope per the challenge brief.

## Data layer — real NASA records

The ETL in `data/pipelines/` pulls public PSI files for **13 accessions
(20,000+ cataloged in `data/psi/catalog/files_manifest.csv`)** —
FLEX/CFI, ACME, BASS, Saffire, SAME… — plus 120 NTRS citations,
normalizes **1,150+ real test runs** into
`data/processed/experiments.csv`, and builds a deterministic
29k-document retrieval corpus — no external ML service.

```bash
./.venv/bin/python data/pipelines/psi_search.py --all
./.venv/bin/python data/pipelines/psi_files.py --all
./.venv/bin/python data/pipelines/ntrs_search.py --all --fulltext 3
./.venv/bin/python data/pipelines/normalize_experiments.py
./.venv/bin/python data/pipelines/build_index.py
./.venv/bin/python data/pipelines/fit_risk_model.py
./.venv/bin/python data/pipelines/build_master_sheet.py        # auditable CSV + JSON
./.venv/bin/python data/pipelines/build_investigation_diffs.py # diff cards
```

Then `uvicorn` exposes `/api/search`, `/api/ask` (BM25 + DuckDB SQL-RAG
with exact PSI/NTRS citations) and `/api/risk` (cabin fire-risk index:
O₂ × ventilation × material × gravity). Recipe: `docs/DATA_PIPELINE.md`.

## Documentation

| Doc | Contents |
| --- | -------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | End-to-end data flow: C++ core → FastAPI |
| [`docs/DATA_PIPELINE.md`](docs/DATA_PIPELINE.md) | ETL recipe, PSI/NTRS sources, calibration |
| [`docs/NASA_PSI_REFERENCES.md`](docs/NASA_PSI_REFERENCES.md) | Mechanic → dataset mapping (FLEX, ACME, SAFFIRE…) |
| [`docs/challenge-brief.md`](docs/challenge-brief.md) | NASA Space Apps 2026 challenge brief |
| [`docs/data-schema.md`](docs/data-schema.md) | Shared JSON schemas & calibrated data contracts |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Free-tier deploy — Vercel frontend + Render/Koyeb backend |
| [`docs/SI_SETUP.md`](docs/SI_SETUP.md) | Local, zero-cost SI stack — whisper.cpp STT + Ollama/9Router LLM |

---

<div align="center">
  <sub>Artwork: “IGNIS Orbital Shipyard” · Built for the NASA Space Apps Challenge 2026</sub>
</div>
