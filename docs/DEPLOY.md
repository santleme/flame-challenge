# DEPLOY — free tier, zero local setup

Frontend on **Vercel** (free), backend on **Render** free web-service
tier (or **Koyeb** — same shape). LLM + STT ride the **Groq** free API,
so the container stays lean (<350 MB, <150 MB RSS — fits the 512 MB
tier). Hugging Face Spaces was the original plan, but Docker Spaces now
require a PRO subscription — Render is the drop-in replacement.

| Piece | Where | What runs |
|---|---|---|
| `site/` | Vercel | IGNIS dashboard — static SPA, falls back to the bundled physics mirror while the API wakes up |
| root `Dockerfile` | Render (or Koyeb) | C++20 engine `.so` + FastAPI on `$PORT` — no whisper sidecar |
| LLM | Groq free tier | `qwen/qwen3.8-27b` via the OpenAI-compatible endpoint |
| STT | Groq free tier | `whisper-large-v3-turbo` via the OpenAI-compatible endpoint |

## Step 1 — push the repo

Render builds the root `Dockerfile` straight from GitHub:

```bash
git push origin main
```

## Step 2 — backend on Render

1. https://render.com → **New → Web Service → Existing Repo (Docker)** →
   pick this repo. Render detects the Dockerfile and injects `PORT`;
   `scripts/start_prod.sh` binds it.
2. Choose the **free** instance type.
3. **Environment**, add:

| Variable | Value |
|---|---|
| `NINE_ROUTER_BASE_URL` | `https://api.groq.com/openai/v1` |
| `NINE_ROUTER_API_KEY` | **secret** — Groq console key |
| `NINE_ROUTER_MODEL` | `qwen/qwen3.8-27b` |
| `STT_BASE_URL` | `https://api.groq.com/openai/v1/audio/transcriptions` |
| `STT_API_KEY` | same Groq key |
| `STT_MODEL` | `whisper-large-v3-turbo` |
| `CORS_ORIGINS` | `https://<your-app>.vercel.app` (fill in after step 3) |

Skip `NINE_ROUTER_*` and the copilot still answers via the deterministic
offline fallback; skip `STT_*` and voice reports STT offline while text
chat keeps working. Gemini works as the LLM alternative
(`NINE_ROUTER_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
`NINE_ROUTER_MODEL=gemini-2.5-flash`).

**Koyeb alternative:** New → App → GitHub → Dockerfile builder →
`Instance: free` → same env vars. Koyeb's free tier doesn't sleep, so
the cold-start story below doesn't apply.

## Step 3 — frontend on Vercel

1. https://vercel.com/new → import the repo → leave **Root Directory at
   the repo root** (the default). The root `vercel.json` runs
   `cd site && npm ci && npm run build` and serves `site/dist`; the root
   `.vercelignore` trims the upload so `shared/calibrated-data` still
   reaches the build (the risk mirror imports it). Do not set the root
   directory to `site/` — that switches to `site/vercel.json` and skips
   the monorepo layout the site depends on.
2. **Environment Variables**:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://<your-service>.onrender.com` |

3. Deploy.

## Step 4 — close the CORS loop

Back on Render: set `CORS_ORIGINS=https://<your-app>.vercel.app` and
redeploy. The WebSocket (`wss://…/ws/chamber`) needs no extra config —
`VITE_API_URL` is mapped `https→wss` by `site/src/lib/apiBase.ts`.

## Step 5 — verify

```bash
curl https://<your-service>.onrender.com/health
# {"ok":true,"engine":"c++","module":"freefall_engine"}
```

Open the Vercel URL → engine badge shows `c++` once the backend is warm.
**Cold start:** Render free instances sleep on idle (~30-60 s to boot).
`site/src/main.tsx` fires a silent `/health` ping on page load — the
request wakes the container while the visitor is still on the hero, and
the dashboard runs on the baked physics snapshot (`engine: local`) until
live calls start answering.

## What's in the image

- `core/build/freefall_engine.*.so` compiled in-stage and health-checked
  (`test_physics` runs during build)
- `data/bundle` + `data/processed` (incl. the committed
  `search_index.json` retrieval corpus) + `shared/calibrated-data`
- secrets stay out — `.dockerignore` drops every `.env`
- no whisper.cpp: STT is an external OpenAI-compatible endpoint
  (`STT_BASE_URL`), keeping the image under the 512 MB free-tier budget
