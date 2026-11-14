# Freefall Foundry — Flame in Freefall

**NASA Space Apps Challenge 2026.** An orbital shipyard management sim
(Prison-Architect-style, 2.5D isometric) where scientists and engineers
build modules, run microgravity combustion experiments, and fabricate a
spacecraft — while every ignition risk, fire spread and hidden-flame
incident is computed from **real NASA Physical Sciences Informatics
records** and a compiled **C++20 physics core**.

## Play it

```bash
# 1) frontend (required)
cd frontend && npm install && npm run dev        # → http://localhost:5173

# 2) C++ physics backend (optional — the game falls back to a local model)
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd core && cmake -S . -B build -DPython3_EXECUTABLE=/usr/bin/python3 \
  && cmake --build build -j && cd ..
.venv/bin/python data/pipelines/calibrate_constants.py
.venv/bin/uvicorn backend.api.main:app --port 8000
# the "C++" badge in the top bar turns green
```

## Loop

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

## Layout

```
core/      C++20 physics: droplet d²-law (FLEX), SAFFIRE spread,
                  ACME material risk + pybind11 + (Emscripten-ready)
data/    NASA PSI/NTRS ETL + calibrate_constants.py
backend/      FastAPI bridge: /api/chamber/preview, /api/risk/rank,
              /api/tactical/advise, WS /ws/chamber
frontend/     React + TypeScript + PixiJS game client
docs/             ARCHITECTURE.md, NASA_PSI_REFERENCES.md, challenge brief
```

See `docs/ARCHITECTURE.md` for the data flow and
`docs/NASA_PSI_REFERENCES.md` for the mechanic→dataset mapping.

## 30-second demo script

| t | screen | narration |
|---|---|---|
| 0–5 s | isometric shipyard, crew working | "Freefall Foundry — an orbital shipyard where every fire follows real NASA microgravity data." |
| 5–10 s | Presets → **FLEX — Heptane Droplet** starts in the chamber | "Run the actual FLEX-2 record: heptane, 21% O₂, the C++ engine solving d²-law at 30 Hz." |
| 10–15 s | O₂/flow dials; ignition dial climbs | "Push past the limiting oxygen concentration and the NASA-calibrated risk model pushes back." |
| 15–20 s | fire breaks out — streamlines turn **orange** | "Ventilation was feeding it — opposed-flow spread, straight out of SAFFIRE." |
| 20–25 s | click module → tactical panel; *Cut Ventilation −78%* | "The playbook tells you the physics before you commit — every number from the engine." |
| 25–30 s | Presets → **Mir 1997**: vent cuts fail, cooling applied | "And when the fire carries its own oxidizer — Mir '97 — only the historically correct countermeasure works. Real incidents, playable." |

## API quick reference

| Endpoint | Purpose |
|---|---|
| `GET /health` | C++ engine handshake |
| `POST /api/chamber/preview` | ignition pressure for the UI dial |
| `POST /api/risk/rank` | rank active modules by 4-axis risk vector + dominant factor + PSI citation |
| `POST /api/tactical/advise` | strict-JSON copilot: `diagnostico_fisico`, `acao_imediata_1/2`, `erro_a_evitar`, `citacao_nasa_id` |
| `WS /ws/chamber` | 30 Hz telemetry incl. `o2Source` regime + risk vector |

Smoke test: `PYTHONPATH=core/build:. pytest backend/tests/test_e2e_smoke.py`
