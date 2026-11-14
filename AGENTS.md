# AGENTS.md — flame-challenge

NASA Space Apps Challenge 2026: **"Flame in Freefall"** → **Freefall Foundry**,
an orbital shipyard sim (Prison-Architect-style 2.5D isometric) where crew
build modules, run microgravity combustion experiments and fabricate a ship.
Experiment risk, fire spread and hidden-flame incidents are driven by real
NASA PSI data and a compiled C++ physics core. See `docs/`.

## Layout (monorepo)

- `core/` — C++20 physics: `combustion_solver` (FLEX droplet d²-law +
  cool-flame regime), `airflow_propagator` (SAFFIRE-type spread with two
  extinction regimes + `O2SourceType` historical regimes: ambient /
  enriched Apollo-1 / self-oxidizing Mir-97), `material_risk` (ACME
  flammability matrix + 4-axis `RiskVector` + `TechModifiers` spin-offs),
  `chamber.hpp` aggregate API. `src/bindings.cpp` → pybind11 module;
  `src/bindings_wasm.cpp` → Emscripten-ready embind.
- `data/` — Python ETL (`pipelines/`): `psi_search.py`, `ntrs_search.py`,
  `build_dataset.py`, `calibrate_constants.py` → `shared/calibrated-data/*.json`
  (canonical) + copies into `frontend/src/data/`
- `shared/` — contracts: `schemas/` JSON schemas + `calibrated-data/`
  (`calibration.json`, `risk_profiles.json` — the single source of truth for
  both the C++ core and the TS fallback)
- `backend/` — `api/` FastAPI routes + `services/engine_bridge.py` pybind
  bridge + `services/tactical.py` copilot: `/health`, `/api/chamber/preview`,
  `/api/materials`, `POST /api/risk/rank` (multifactor module ranking),
  `POST /api/tactical/advise` (strict-JSON citation-anchored advice),
  `WS /ws/chamber` (30 Hz telemetry incl. `o2Source` + risk vector)
- `frontend/` — React + TS + PixiJS client:
  - `src/game/` — pure TS sim: engine (state/tick/actions), crew AI + jobs,
    fire system, experiments (multifactor risk from `risk_profiles.json`),
    A* pathfinding
  - `src/renderer/` — Pixi stage, procedural iso textures, world sync, camera
  - `src/sim-bridge/physics.ts` — C++-backend client with local fallback
  - `src/ui/` — TopBar, BuildPalette, EventFeed, InspectPanel,
    ExperimentModal, Overlays
  - `src/state/store.ts` — Engine singleton + useSyncExternalStore bridge
- `docs/` — challenge brief, ARCHITECTURE.md, NASA_PSI_REFERENCES.md,
  data-schema.md
- `assets/` — media sources (tilesets, crew sprites, audio); empty — the
  renderer is fully procedural today

## Commands (WSL: `/home/lucas_coimbra/flame-challenge`)

- `cd frontend && npm run dev|build|lint`
- `cd core && cmake -S . -B build -DPython3_EXECUTABLE=/usr/bin/python3
  && cmake --build build -j && ./build/test_physics`
- `./.venv/bin/python data/pipelines/calibrate_constants.py`
- `./.venv/bin/uvicorn backend.api.main:app --port 8000`
- `./.venv/bin/pip install ...` — PEP 668 managed env; always use `.venv`

## Conventions

- TypeScript strict (`verbatimModuleSyntax`, `noUnusedLocals`) — `import type`.
- Tailwind v4 via `@tailwindcss/vite`; theme tokens in `src/index.css`
  (`void`, `panel`, `edge`, `flame`, `ember`, `ice`, `mist`).
- All UI copy in English (NASA judges). Docs may be bilingual.
- Provenance: starter dataset records carry `verified: false`; only
  pipeline-ingested records set `verified: true` — surfaced in the UI.
- Determinism matters: the C++ engine uses a seeded xorshift; the TS sim
  uses `mulberry32`. Keep both reproducible.
- The game must stay playable without the backend (static hosting) —
  every backend feature needs a local fallback.
