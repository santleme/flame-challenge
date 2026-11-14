# AGENTS.md — flame-challenge

NASA Space Apps Challenge 2026: **"Flame in Freefall"** → **Freefall Foundry**,
the physics + data + API core of an orbital shipyard sim where crew build
modules, run microgravity combustion experiments and fabricate a ship.
Experiment risk, fire spread and hidden-flame incidents are driven by real
NASA PSI data and a compiled C++ physics core. The repo is engine, ETL and
backend only — no client. See `docs/`.

## Layout (monorepo)

- `core/` — C++20 physics: `combustion_solver` (FLEX droplet d²-law +
  cool-flame regime), `airflow_propagator` (SAFFIRE-type spread with two
  extinction regimes), `material_risk` (ACME flammability matrix),
  `chamber.hpp` aggregate API. `src/bindings.cpp` → pybind11 module;
  `src/bindings_wasm.cpp` → Emscripten-ready embind.
- `data/` — Python ETL (`pipelines/`): `psi_search.py` (PSI catalog via
  `geode-py/ws`), `psi_files.py` (per-test data files), `ntrs_search.py`
  (citations + fulltext), `normalize_experiments.py` (unified CSV),
  `build_index.py` (retrieval corpus), `fit_risk_model.py` (risk surface),
  `build_dataset.py`, `calibrate_constants.py` → `data/processed/` +
  `shared/calibrated-data/*.json` (canonical) + `data/bundle/` (merged
  dataset + generated JSON artifacts)
- `shared/` — contracts: `schemas/` JSON schemas + `calibrated-data/`
  (`calibration.json`, `risk_profiles.json` — the single source of truth
  for the C++ core)
- `backend/` — `api/` FastAPI routes + `services/` (`engine_bridge.py`
  pybind, `rag.py` retrieval/SQL-RAG, `risk.py` cabin simulator):
  `/health`, `/api/chamber/preview`, `/api/materials`, `WS /ws/chamber`
  (30 Hz), `/api/search`, `/api/ask`, `/api/risk`, `/api/risk/curve`,
  `/api/rag/stats`
- `docs/` — challenge brief, ARCHITECTURE.md, NASA_PSI_REFERENCES.md,
  data-schema.md
- `assets/` — media sources (tilesets, crew sprites, audio); empty

## Commands (WSL: `/home/lucas_coimbra/flame-challenge`)

- `cd core && cmake -S . -B build -DPython3_EXECUTABLE=/usr/bin/python3
  && cmake --build build -j && ./build/test_physics`
- `./.venv/bin/python data/pipelines/calibrate_constants.py`
- `./.venv/bin/uvicorn backend.api.main:app --port 8000`
- `./.venv/bin/pip install ...` — PEP 668 managed env; always use `.venv`
- ETL (in order): `psi_search.py --all` → `psi_files.py --all` →
  `ntrs_search.py --all --fulltext 3` → `normalize_experiments.py` →
  `build_index.py` → `build_dataset.py` → `calibrate_constants.py` →
  `fit_risk_model.py` → `build_master_sheet.py` (auditable
  `data/processed/nasa_combustion_master.csv` + `data/bundle/master_sheet.json`)

## Conventions

- All user-facing copy in English (NASA judges). Docs may be bilingual.
- Provenance: starter dataset records carry `verified: false`; only
  pipeline-ingested records set `verified: true`.
- Determinism matters: the C++ engine uses a seeded xorshift. Keep it
  reproducible.
