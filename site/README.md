# IGNIS website

React + TypeScript + Vite site for the IGNIS project. The hero keeps the
original isometric heat-wave canvases (now resize-safe: they redraw at
the current wave time instead of snapping to t=0); scroll runs on Lenis +
GSAP ScrollTrigger; the shipyard section expands to fullscreen.

```sh
npm install
npm run dev        # → http://localhost:5173 (proxies /api → :8000)
npm run build      # typecheck + static bundle → dist/
```

`src/lib/risk.ts` + `src/lib/api.ts` mirror the backend risk formula for
future live-data sections (offline fallback from
`shared/calibrated-data/risk_model.json`).
