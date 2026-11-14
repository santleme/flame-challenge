# Flame in Freefall — SI-Powered Fire Safety Insights

> **NASA Space Apps Challenge 2026** — "Flame in Freefall: SI-Powered Fire Safety
> Insights from Microgravity Combustion Data" (Intermediate / Advanced · Space
> Exploration)

An interactive dashboard that **summarizes, ranks and interprets** decades of
NASA microgravity combustion research — turning the PSI data archive into
actionable fire-safety insights for human exploration of the Moon and Mars.

## What it does

- **Ranking** — every investigation gets a transparent safety-risk score
  (flammability, hidden hazard, exploration relevance, data richness).
- **Summaries** — each record produces a plain-language "SI summary" plus
  key findings and fire-safety implications.
- **Insights** — a rule-based SI engine derives cross-cutting insights
  (cool flames, low-O₂ flame spread, smoke-detector gaps, partial-gravity
  needs, exploration atmospheres) and links them to source investigations.
- **Charts** — limiting-oxygen comparison and score decomposition (Recharts).
- **Data pipeline** — Python scripts ingest NASA PSI searches and NTRS papers
  and normalize them into the app dataset.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production build
npm run lint       # oxlint
npm run preview    # serve the build
```

Data pipeline (Python 3.12+, stdlib only — `psi_normalize.py` also needs
`openpyxl`, see `scripts/requirements.txt`):

```bash
python scripts/psi_search.py --all      # PSI repository searches -> data/raw/
python scripts/ntrs_search.py "microgravity flame spread"   # papers -> data/raw/
python scripts/build_dataset.py         # merge structured records -> src/data/
python scripts/build_dataset.py --sample  # restore starter dataset
```

Bulk PSI datasets (fetch → normalize → catalogue into `data/psi/`):

```bash
python scripts/psi/psi_fetch.py       # resumable download of 13 investigations
python scripts/psi/psi_catalog.py     # investigation metadata -> catalog/
python scripts/psi/psi_normalize.py   # cleaned tables -> processed/ (openpyxl)
```

See `docs/data-schema.md` for the record format and `data/psi/README.md` for
the PSI dataset layout.

## Architecture

```
NASA PSI / NTRS ──► scripts/*.py ──► data/raw/ ──► src/data/investigations.json
                                                          │
                                            src/lib/insights.ts (SI engine)
                                                          │
                                          React dashboard (Vite + Tailwind)
```

The insights engine is deliberately **deterministic and offline** so the demo
never depends on network or API keys. An LLM provider can be plugged in later
behind the same interface for richer narrative summaries.

## Data honesty

The bundled dataset covers 8 real investigations (SoFIE-GEL, BASS-II, FLEX,
ACME, Saffire I–VI, SAME, Confined Combustion, FLARE). Quantitative metrics
are representative values from public literature and are flagged
`verified: false` until replaced by PSI file data via the pipeline.

## Links

- Challenge: https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/
- PSI repository: https://psi.nasa.gov/physci/repo
- Brief & data schema: `docs/challenge-brief.md`, `docs/data-schema.md`

---

## Guia rápido (PT-BR)

**Para que serve:** dashboard interativo para o desafio da NASA Space Apps
2026 que resume, ranqueia e interpreta dados de combustão em microgravidade
(arquivo PSI da NASA) e gera insights de segurança contra incêndio para
missões à Lua e a Marte.

**Stack:** Vite + React 19 + TypeScript + Tailwind v4 + Recharts (frontend),
Python 3 (pipeline de dados), motor de insights determinístico local.

**Rodar:** `npm install && npm run dev` → http://localhost:5173

**Dados:** 8 investigações reais catalogadas (SoFIE-GEL, BASS-II, FLEX, ACME,
Saffire, SAME, Confined Combustion, FLARE). Métricas são valores
representativos da literatura pública, marcados `verified: false` até serem
substituídos por dados reais do PSI via `scripts/`.
