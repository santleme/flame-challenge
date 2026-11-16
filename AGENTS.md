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
  extinction regimes), `material_risk` (ACME flammability matrix +
  `riskIndex`/`riskBreakdown` — the native composite inference head),
  `chamber.hpp` aggregate API. `bindings/python.cpp` → pybind11 module;
  `bindings/wasm.cpp` → Emscripten-ready embind.
- `data/` — Python ETL (`pipelines/`): `psi_search.py` (PSI catalog via
  `geode-py/ws`), `psi_files.py` (per-test data files), `ntrs_search.py`
  (citations + fulltext), `normalize_experiments.py` (unified CSV),
  `build_index.py` (retrieval corpus), `fit_risk_model.py` (risk surface),
  `fit_uncertainty.py` (MAPIE conformal → `uncertainty` block),
  `validate_scientific_bounds.py` (Cantera GRI-Mech + `shap`
  cross-check → `scientific_bounds_report.json`; both optional, see
  `pipelines/requirements-sci.txt`),
  `build_dataset.py`, `calibrate_constants.py` → `data/processed/` +
  `shared/calibrated-data/*.json` (canonical) + `data/bundle/` (merged
  dataset + generated JSON artifacts). `data/psi/` is a committed,
  pre-normalized PSI corpus (catalog + processed CSVs, own README) that
  `normalize_experiments.py` folds in via `parse_legacy_*` for
  accessions the raw-file parsers never reached (BASS, SAFFIRE I–III,
  FLEX test points, extra ACME).
- `shared/` — contracts: `schemas/` JSON schemas + `calibrated-data/`
  (`calibration.json`, `risk_profiles.json` — the single source of truth
  for the C++ core)
- `backend/` — `api/` FastAPI routes + `services/` (`engine_bridge.py`
  pybind, `engine_fallback.py` pure-Python mirror, `rag.py`
  retrieval/SQL-RAG, `risk.py` cabin simulator + conformal intervals,
  `explain.py` exact closed-form Shapley attribution, `investigations.py`
  scored leaderboard + detail + insights, `diff.py` run-pair differ,
  `neighbors.py` k-NN over PSI runs, `tactics.py` decision cards,
  `si_copilot.py` conversational/voice SI):
  `/health`, `/api/chamber/preview`,
  `/api/materials`, `WS /ws/chamber` (30 Hz), `/api/search`, `/api/ask`,
  `/api/risk`, `/api/risk/curve`, `/api/risk/rank`, `/api/rag/stats`,
  `/api/investigations` (leaderboard), `/api/investigations/{id}`,
  `/api/investigations/matrix` (dashboard attribute feed),
  `/api/insights`, `/api/runs`, `/api/diff`, `/api/diffs`,
  `/api/decision-cards`, `/api/neighbors`,
  `/api/mission-reports/templates` (canonical demo reports),
  `POST /api/si/chat`,
  `POST /api/si/voice` (multipart `audio` + `state`),
  `POST /api/si/voice-command` (flat voice-first envelope:
  `transcript` + `briefing` + `navigation.scroll_to_section`/
  `active_filter_tag` + `simulation_commands.load_preset`/
  `set_o2_percent`/`set_airflow_cm_s`/`set_gravity_g`/
  `trigger_containment`; preset aliases FLEX/SAFFIRE/SAME_R/
  ACME_EFIELD resolve to real investigationIds)
- SI copilot: every answer first builds a factual packet (risk model +
  engine ignition pressure + `neighbors` 3 nearest PSI runs + `tactics`
  cards), then asks the local 9Router gateway (OpenAI-compatible, strict
  JSON schema → `briefing` / `recommended_action` / `ui_command`).
  STT is any OpenAI-compatible `/audio/transcriptions` endpoint —
  local whisper.cpp in dev, Groq `whisper-large-v3-turbo` in deploy.
  Either service down → deterministic offline fallback. Env via
  `backend/.env` (see `.env.example`): `NINE_ROUTER_BASE_URL`,
  `NINE_ROUTER_API_KEY`, `NINE_ROUTER_MODEL`, `STT_BASE_URL` (alias
  `WHISPER_CPP_URL`), `STT_API_KEY`, `STT_MODEL`.
- `site/` — IGNIS front end (Vite + React 19 + Tailwind 4 + GSAP):
  editorial landing (Hero/Challenge/Crew/Shipyard) plus three overlay
  views — `PsiDataset` (PSI corpus explorer), `SimDeck` (simulation
  deck: investigation presets + generated mission reports from
  `/api/mission-reports/templates`) and `Dashboard` (summarize ·
  rank · interpret pillars + `MissionReportsPanel`). `SimConsole`
  is the agent console: chat + push-to-talk voice via MediaRecorder
  → `/api/si/chat` / `/api/si/voice-command`, `Composer` owns the recorder
  and `lib/voice.ts` transcodes to WAV PCM16 16kHz in-browser; every
  response becomes an `AgentTurn` whose `simulation_commands` fan out
  through `emitSimulationCommands` → `ignis:ui-command`. Event bus in
  `lib/simBus.ts` — CustomEvents `ignis:ui-command`, `ignis:sim-frame`,
  `ignis:route`, `ignis:view`, `ignis:chamber-command-error`,
  `ignis:chamber-complete`, `ignis:chamber-offline`,
  `ignis:dashboard-generated`, `ignis:scroll-inner`.
  Offline fallback mirrors
  the same fitted model via `src/lib/risk.ts` + `src/lib/dashboard.ts`
  + baked `src/data/psi_snapshot.json`;
  live mode proxies `/api` to :8000 (see `vite.config.ts`),
  `VITE_API_URL` for split deploys.
- `game-visual/` — standalone vanilla HTML/CSS/JS shipyard visual
  prototype (hub + hangar scenes); separate review gate — see
  `game-visual/STARTUP.md` + `AGENTS.md`/`REVIEW.md` in that dir.
- `scripts/` — `si_up.sh` (local SI sidecar bring-up),
  `start_prod.sh` (container entrypoint), `route_test.mjs` (CDP smoke
  test for the sim-console routes).
- `docs/` — challenge brief, ARCHITECTURE.md, DATA_PIPELINE.md,
  DEPLOY.md, SI_SETUP.md, NASA_PSI_REFERENCES.md, data-schema.md,
  `superpowers/` plans+specs.
- `assets/` — readme artwork (`readme/`); game media sources pending.
- `frontend/`, `src/` — untracked leftovers from an earlier React
  scaffold (dist/node_modules only, no sources); not part of the build.

## Commands (WSL: `/home/gusta/NASA/flame-challenge`)

- `cd core && cmake -S . -B build -DPython3_EXECUTABLE=/usr/bin/python3
  && cmake --build build -j && ./build/test_physics`
- `./.venv/bin/python data/pipelines/calibrate_constants.py`
- `./.venv/bin/uvicorn backend.api.main:app --port 8000`
- `./.venv/bin/pip install ...` — PEP 668 managed env; always use `.venv`
- `cd site && npm run build` (tsc + vite) / `npm run dev` / `npx oxlint`
  / `npm test` (vitest)
- `./.venv/bin/python -m pytest backend/tests` — API + services tests
- `./.venv/bin/python -m pytest data/pipelines/test_pipelines.py` — ETL
  regression suite
- ETL (in order): `psi_search.py --all` → `psi_files.py --all` →
  `ntrs_search.py --all --fulltext 3` → `normalize_experiments.py` →
  `build_index.py` → `build_dataset.py` → `calibrate_constants.py` →
  `fit_risk_model.py` → `build_master_sheet.py` (auditable
  `data/processed/nasa_combustion_master.csv` + `data/bundle/master_sheet.json`)
  → `build_investigation_diffs.py` (`data/bundle/investigation_diffs.json`)
  → `build_site_snapshot.py` (`site/src/data/psi_snapshot.json` — baked
  leaderboard/details/insights for the site's offline fallback)
- Scientific layer (optional —
  `./.venv/bin/pip install -r data/pipelines/requirements-sci.txt`):
  `./.venv/bin/python data/pipelines/fit_uncertainty.py` → writes
  `uncertainty` into `shared/calibrated-data/risk_model.json`;
  `./.venv/bin/python data/pipelines/validate_scientific_bounds.py` →
  `data/processed/scientific_bounds_report.json` (Cantera T_ad/LOC +
  diluent ordering + SHAP audit — exits non-zero on FAIL)
- Validate physics changes: `./.venv/bin/python data/pipelines/validate_engine.py`
  → `data/processed/validation_report.json` (current: 67.3% over 612
  scored runs — acme 66.4%, flex-2 67.9%; fitted coflow criterion:
  ignition gates + fuel-ramp strain + oxidizer-depletion extinction,
  per fuel into calibration.json["coflow"])

## Conventions

- All user-facing copy in English (NASA judges). Docs may be bilingual.
- Provenance: starter dataset records carry `verified: false`; only
  pipeline-ingested records set `verified: true`.
- Determinism matters: the C++ engine uses a seeded xorshift. Keep it
  reproducible.
