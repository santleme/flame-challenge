# Architecture — Freefall Foundry

```
┌──────────────────────────────────────────────────────────────────┐
│ data/ (Python pipelines)                                         │
│   psi_search.py → raw PSI JSON    calibrate_constants.py         │
│   ntrs_search.py → raw NTRS JSON  ──────────────┐                │
│   build_dataset.py → data/bundle/*.json         ▼                │
│                  shared/calibrated-data/*.json                   │
└──────────────┬───────────────────────────────────────────────────┘
               │ materials + inv→model map
               ▼
┌──────────────────────────┐
│ core/ (C++20)            │
│  combustion_solver  —    │
│    FLEX droplet d²-law   │
│  airflow_propagator —    │
│    SAFFIRE solid spread  │
│  material_risk — ACME    │
│    flammability matrix   │
│  chamber.hpp — aggregate │
│    API                   │
└──────────┬───────────────┘
           │ pybind11
           ▼
┌──────────────────────────┐
│ backend/ (FastAPI)       │  services/engine_bridge.py
│  api/ + services/        │  loads freefall_engine .so +
│  /health                 │  calibration.json
│  /api/chamber/preview    │
│  /api/materials          │  → HTTP /api/*, WS /ws/*
│  /ws/chamber (30 Hz)     │    for API consumers
└──────────────────────────┘
```

## Data flow — a run experiment

1. A client picks an `Investigation` (real PSI record) + O₂ level.
2. `POST /api/chamber/preview` → the C++ `MaterialRisk`
   returns `ignitionPressure` for that material/atmosphere.
3. `specFor()` maps pressure → ignition risk % and decomposes it into
   `RiskFactors` (ignition / propagation / detection / persistence) using
   weights from `risk_profiles.json`; dataset fields also feed
   hidden-fire / smolder flags.
4. The C++ solver gates *whether and how* ignition happens.
5. For live chamber telemetry, `WS /ws/chamber` streams `stateJson()`
   at 30 Hz — flame radius, spread front, regime transitions — ready for
   a dedicated chamber view.

## Physics models (reduced order, calibrated to PSI records)

| Model | Investigation anchor | Implementation |
|---|---|---|
| `DropletFlame` | FLEX / ACME | d²-law burn-down, spherical diffusion standoff `r_f/r_d ∝ O₂−LOC`, two-stage cool-flame regime for capable fuels |
| `SolidSpread` | SoFIE / BASS-II / SAFFIRE | spread rate interpolated within measured `[min,max]` by O₂ margin; **two extinction regimes** — oxygen-limit at high flow, radiative at quiescent flow; partial-g correction |
| `MaterialRisk` | ACME / all | per-material LOC, spread range, soot index, cool-flame & smolder flags |

## Build matrix

| Target | Toolchain | Output | Consumer |
|---|---|---|---|
| `ffengine` (static) | g++ ≥11, CMake | `libffengine.a` | tests, both bindings |
| `freefall_engine` | + pybind11 | `.cpython-*.so` | `backend`, calibration tests |
| `ffengine_wasm` | Emscripten (`-DEMSCRIPTEN=ON`) | `freefall_engine.js/.wasm` | future in-browser physics |
| `test_physics` | g++ | ctest binary | CI accuracy gate |

## Determinism

The solver seeds its own xorshift32 per chamber; identical `(config, seed)`
replays produce identical trajectories — required both for the demo's
reproducibility story and for the accuracy tests.
