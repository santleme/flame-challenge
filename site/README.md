# IGNIS site

React 19 + TypeScript + Vite front end for Flame in Freefall. The landing
page is an editorial scroll (Hero/Challenge/Crew/Shipyard, Lenis + GSAP
ScrollTrigger; the isometric heat-wave canvases are resize-safe — they
redraw at the current wave time instead of snapping to t=0). Three
overlay views ride on top of it:

- `PsiDataset` — PSI corpus explorer: investigations, real runs,
  citations.
- `SimDeck` — simulation deck: investigation presets, generated mission
  reports (`/api/mission-reports/templates`) and `SimConsole`, the agent
  console — chat + push-to-talk voice (MediaRecorder →
  `/api/si/chat` `/api/si/voice-command`). Every response becomes an `AgentTurn`
  whose `simulation_commands` fan out through `emitSimulationCommands` →
  `ignis:ui-command` (bus in `src/lib/simBus.ts`; `lib/voice.ts`
  transcodes clips to WAV PCM16 16 kHz in-browser).
- `Dashboard` — the summarize · rank · interpret deliverable over the PSI
  corpus + `MissionReportsPanel`.

```sh
npm install
npm run dev        # → http://localhost:5173 (proxies /api → :8000)
npm run build      # typecheck + static bundle → dist/
npm run lint       # oxlint
npm test           # vitest
```

`src/lib/risk.ts` + `src/lib/api.ts` mirror the backend risk formula for
the offline fallback (fitted model from
`shared/calibrated-data/risk_model.json`); the baked
`src/data/psi_snapshot.json` (`data/pipelines/build_site_snapshot.py`)
powers leaderboard/insights while the API is cold. For a split deploy
set `VITE_API_URL` (see `.env.example`) — REST uses it verbatim and the
`/ws/chamber` socket maps `https→wss` (`src/lib/apiBase.ts`).
