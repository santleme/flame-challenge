# SI stack — local, zero-cost bring-up

The voice/SI copilot (`/api/si/chat`, `/api/si/voice`, `/api/si/voice-command`)
needs two OpenAI-compatible sidecars. This setup runs both **locally** —
no accounts, no API keys, no venue-wifi dependency:

| Role | Process | Port |
|---|---|---|
| STT | `whisper-server` (whisper.cpp, `small.en`, CPU) | `127.0.0.1:8081` |
| LLM | `ollama serve` (systemd unit, `llama3.2:3b`) | `127.0.0.1:11434` |
| API | `uvicorn backend.api.main:app` | `127.0.0.1:8000` |

Everything is optional by design: with either sidecar down the API serves
the deterministic offline fallback (`mode: "offline-fallback"`), so the
demo never hangs.

## 1. whisper.cpp (STT)

```bash
git clone --depth 1 https://github.com/ggml-org/whisper.cpp ~/whisper.cpp
cd ~/whisper.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j --config Release
bash models/download-ggml-model.sh small.en    # ~465 MB; base.en works too

./build/bin/whisper-server -m models/ggml-small.en.bin \
    --host 127.0.0.1 --port 8081 -t 8 &
```

**Endpoint gotcha:** which route `whisper-server` serves depends on the
build — older builds expose `POST /inference` (multipart `file` +
`response_format=json` → `{"text": "…"}`), newer ones the
OpenAI-compatible `POST /v1/audio/transcriptions`. Point `STT_BASE_URL`
at whichever your build serves (`WHISPER_CPP_URL` is a legacy alias read
only when `STT_BASE_URL` is unset — check `STT_BASE_URL` first) —
the backend POSTs `file` + `response_format` (+ `model` when `STT_MODEL`
is set) to the URL verbatim.

Smoke test:

```bash
curl -X POST http://localhost:8081/inference \
  -F file=@$HOME/whisper.cpp/samples/jfk.wav -F response_format=json
```

## 2. Ollama (LLM)

`ollama serve` already runs as a systemd unit (`Restart=always`) on
`:11434`, exposing an OpenAI-compatible `/v1` — **no 9Router needed**;
the backend only requires *an* OpenAI-compatible base URL.

Models in use (CPU-only box, ~24 tok/s vs ~11 tok/s for 8b):

```bash
ollama pull llama3.1:8b     # quality option
# fast option — if registry DNS fails inside ollama (WSL quirk), fetch
# the GGUF from Hugging Face and create locally instead of pulling:
curl -sL -o ~/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
  'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf'
cd ~/models && printf 'FROM ./Llama-3.2-3B-Instruct-Q4_K_M.gguf\n' > Modelfile
ollama create llama3.2:3b -f Modelfile
```

## 3. backend/.env

Not committed — copy the contract and fill it in:

```bash
cp backend/.env.example backend/.env
```

For this all-local setup:

```
NINE_ROUTER_BASE_URL=http://localhost:11434/v1
NINE_ROUTER_API_KEY=ollama
NINE_ROUTER_MODEL=llama3.2:3b
STT_BASE_URL=http://localhost:8081/v1/audio/transcriptions   # newer whisper.cpp
# STT_BASE_URL=http://localhost:8081/inference               # older builds (replace the line above)
SI_LLM_TIMEOUT_S=75     # CPU inference: 12 s default dies mid-reply
```

Without `.env`, the code defaults to a 9Router gateway on
`http://localhost:20128/v1` and whisper.cpp on
`http://localhost:8081/v1/audio/transcriptions`.

`SI_LLM_TIMEOUT_S` is read when the OpenAI client is first created —
**restart uvicorn after changing `.env`**.

## 4. Bring-up

```bash
./scripts/si_up.sh        # starts whisper-server + api if down, checks ollama
cd site && npm run dev    # dashboard on :5173 (proxies /api → :8000)
```

## 5. Verify

```bash
curl localhost:8000/health                                  # engine: "c++"
curl -X POST localhost:8000/api/si/chat -H 'content-type: application/json' \
  -d '{"message":"run saffire","current_chamber_state":{"o2Pct":21,"flowCms":10}}'
# want: "mode":"llm", "model":"llama3.2:3b"
curl -X POST localhost:8000/api/si/voice-command \
  -F "audio=@$HOME/whisper.cpp/samples/jfk.wav;type=audio/wav" -F 'state={}'
# want: "stt":"whisper.cpp", "transcript":"…"
```

## 6. Latency notes (Ryzen 7700X, CPU only)

- STT: ~1–2 s for a 5 s PTT clip.
- LLM: ~24 tok/s → a voice answer lands in ~15–25 s incl. model warm-up.
  Keep the model resident (Ollama default keep-alive is 5 min; send one
  chat before demoing).
- Prefer quality over speed → `NINE_ROUTER_MODEL=llama3.1:8b` (~2.3× slower).

## 7. Optional: 9Router in front

To route through 9Router instead of talking to Ollama directly
(free-tier providers, combos, quota tracking):

```bash
npm install -g 9router && 9router        # dashboard → http://localhost:20128
# Dashboard → connect a provider (Ollama local, or free tiers)
# .env → NINE_ROUTER_BASE_URL=http://localhost:20128/v1
#        NINE_ROUTER_API_KEY=<key from dashboard>
```

## Troubleshooting

- **`mode: offline-fallback` always** → stale uvicorn. Kill it
  (`pkill -f 'uvicorn.*main:app'` — careful, the pattern matches your own
  shell; prefer `ss -tlnp | grep :8000` + kill the pid) and restart.
- **LLM call dies at ~24 s** → `SI_LLM_TIMEOUT_S` not loaded (stale
  server) or the model is cold-loading; retry once warm.
- **`ollama pull` DNS errors** → WSL resolver flake; daemon is a system
  service so use the GGUF + `ollama create` path above (pure local file).
- **`stt: "offline"`** → whisper-server not on :8081, or `STT_BASE_URL`
  points at the wrong route for your build (`/inference` vs
  `/v1/audio/transcriptions`). `STT_BASE_URL` wins over the
  `WHISPER_CPP_URL` alias — check it first.
