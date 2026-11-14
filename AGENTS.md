# AGENTS.md — flame-challenge

NASA Space Apps Challenge 2026: **"Flame in Freefall"** — an interactive,
AI/SI-powered dashboard that summarizes, ranks and interprets NASA
microgravity combustion data for fire-safety insights in human space
exploration (Moon/Mars). See `docs/challenge-brief.md`.

## Layout

- `src/App.tsx` — dashboard shell (filters + ranking + detail + charts + insights)
- `src/types.ts` — domain types (`Investigation`, `Insight`, scores)
- `src/lib/insights.ts` — deterministic insights engine: scoring, ranking,
  summarization, rule-based insight generation
- `src/lib/data.ts` — dataset loader
- `src/data/investigations.json` — generated dataset (do not hand-edit blindly)
- `src/components/` — Header, StatCards, FilterBar, RankingTable, DetailPanel,
  ChartsPanel (recharts), InsightFeed
- `scripts/` — Python data pipeline (PSI/NTRS → JSON)
- `scripts/psi/` — bulk PSI download/normalize pipeline → `data/psi/`
- `docs/` — challenge brief + dataset schema

## Commands (run inside WSL: `/home/lucas_coimbra/flame-challenge`)

- `npm run dev` — Vite dev server (default :5173)
- `npm run build` — `tsc -b && vite build` (typecheck + bundle)
- `npm run lint` — oxlint
- `npm run preview` — serve the production build
- `python scripts/psi_search.py --all` — fetch PSI search results → `data/raw/`
- `python scripts/ntrs_search.py "<query>"` — fetch NTRS citations → `data/raw/`
- `python scripts/build_dataset.py` — merge structured raw records into dataset
- `python scripts/build_dataset.py --sample` — restore starter dataset
- `python scripts/psi/psi_fetch.py` — bulk-download PSI files → `data/psi/raw/`
- `python scripts/psi/psi_catalog.py` — investigation metadata → `data/psi/catalog/`
- `python scripts/psi/psi_normalize.py` — normalized tables → `data/psi/processed/`

## Conventions

- TypeScript strict mode is on (`verbatimModuleSyntax`, `noUnusedLocals`):
  use `import type` for type-only imports.
- Tailwind v4 via `@tailwindcss/vite`; theme tokens in `src/index.css`
  (`void`, `panel`, `edge`, `flame`, `ember`, `ice`, `mist`).
- All UI copy is in English (NASA judges). Docs may be bilingual.
- Dataset records are honest about provenance: starter values carry
  `verified: false`; only pipeline-ingested records set `verified: true`.
- The insights engine is intentionally deterministic/local so the demo works
  offline; an LLM provider can be added behind the same interface later.
