# SimDeck agent console — design

## Intent

Turn the `#simulations` overlay (SimDeck) into a full-tab agent console:
the whole screen is a conversation with the IGNIS copilot — the user types
or holds a mic to talk, IGNIS answers in public (thinking → named tool
calls → briefing), and each reply can fire a real engine run rendered
inline as a "run card" containing the actual `LiveChamber` canvas.

## Why

The deck today is a static wall of 12 preset cards that only mark a
visual `activeMission` — nothing runs. The mission envelopes are good
data but bad UI (a rectangle grid the user called ugly). The chat makes
the sim engine reachable in one sentence and shows the agent working,
which is the demo surface for judges.

## Goals

- Full-bleed agent thread inside the SimDeck overlay (no centered column;
  use the `.shell` width).
- Text + push-to-talk voice input in a bottom composer.
- Agent turns show: `worked Ns`, tool call rows derived from
  `simulation_commands`, briefing + recommended action, and a run card.
- Run card embeds `<LiveChamber stage>` live in the newest turn; older
  run cards freeze to their final stats.
- Mission envelopes become suggestion chips above the composer; clicking
  one fires a deterministic preset turn (no LLM needed, works offline).
- Works offline for chat (existing `synthesizeLocalSiResponse`); chamber
  degrades to the engine-offline state already inside `LiveChamber`.

## Non-goals

- No change to the backend (`/api/si/chat`, `/api/si/voice-command`
  already return `simulation_commands`).
- No multi-run side-by-side canvases, no global VoiceHud, no
  speechSynthesis readback.
- Gravity presets stay copilot/risk context only — the chamber WS
  (`/ws/chamber`) has no gravity field; do not fake one.

## Anti-goals

- A terminal-looking UI (mono everywhere, cramped rectangles) — this
  look was explicitly rejected; prose in sans, mono only for data.
- A second chat implementation disconnected from `simBus`/`ignis:*`
  plumbing.

## Approaches

- **A — run card inside the thread (picked).** Each run-bearing turn
  contains the chamber canvas; previous cards collapse to stats.
- B — thread + permanent side stage: rejected, splits the screen and
  fights the "whole tab is the console" direction.
- C — floating dock: rejected, too small for the run card + telemetry.

## Decided how's

- `SimDeck.tsx` keeps the overlay + hero, drops the card grid, mounts
  `<SimConsole/>` with `MISSION_PRESETS` exported for chips.
- One `LiveChamber` instance lives inside the newest run-bearing
  `SimRunCard`; it keeps listening to `ignis:ui-command` (emitted via
  `emitSimulationCommands`) so follow-up commands retune mid-run.
- `LiveChamber` gains an `autoBoot` prop (default `true`, preserving
  current behavior); console cards pass `autoBoot={false}` so mounts
  only run when a command arrives.
- Tool rows map `simulation_commands` fields to named calls
  (`load_preset`, `set_o2_percent`, `set_airflow_cm_s`, `set_gravity_g`,
  `trigger_containment`, plus `chamber.run` when a run condition
  exists); `chamber.run` shows `● live` until `ignis:chamber-complete`.
- Composer: textarea/input + send + hold-to-talk mic (MediaRecorder →
  `siVoice`); transcript from `SiResponse.transcript` becomes the user
  bubble. Chips send the preset's `prompt`... no — chips build a
  deterministic preset turn locally (uses the preset's real fields) so
  cards always load the exact envelope; free text/voice goes through
  `siChat`/`siVoice`.
- `SiChamberState` tracked in `SimConsole`, merged from each response's
  commands (`mergeChamberState`), fed back into the next request.
- Auto-scroll only when already near the bottom.

## Left to the builder

- Exact styling within IGNIS tokens; toast/error surface for mic
  permission denial (inline composer error is fine).
- Whether `chamber-complete` appends a short result line or only the
  status chip inside the run card.
