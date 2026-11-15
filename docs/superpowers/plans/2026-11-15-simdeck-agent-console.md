# SimDeck Agent Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SimDeck's static preset grid with a full-bleed agent console — chat + push-to-talk voice driving real chamber runs rendered inline as live run cards.

**Architecture:** `SimConsole` owns the thread state and `SiChamberState`. Text goes to `siChat`, voice to `siVoice`; every response becomes an `AgentTurn` whose `simulation_commands` are fanned out through `emitSimulationCommands` → `ignis:ui-command` → a single `<LiveChamber stage autoBoot={false}/>` mounted inside the newest run card. Preset chips build deterministic local turns with the same command path.

**Tech Stack:** React 19, Tailwind 4 tokens, MediaRecorder, existing `lib/api.ts` / `lib/live.ts` / `lib/simBus.ts` / `lib/voice.ts`.

**Spec:** `docs/superpowers/specs/2026-11-15-simdeck-agent-console-design.md`

## Global Constraints

- User-facing copy in English (NASA judges).
- IGNIS tokens only: `--bg/--ink/--edge/--accent`, `Space Mono` for data, sans for prose — no terminal-look.
- `LiveChamber` behavior must stay identical for existing consumers: `autoBoot` defaults to `true`.
- Determinism: preset turns must produce identical `simulation_commands` for identical presets.

## Review Focus

- `simulation_commands` with no run condition (e.g. only `set_gravity_g`) → must not mount a chamber or mark a live run.
- Backend unreachable → `siChat` returns local-fallback turn; run card shows engine-offline (LiveChamber handles), no crash.
- Mic permission denied / no MediaRecorder → composer shows inline error, text path unaffected.
- Rapid consecutive sends → previous live card must unmount cleanly (`LiveChamber` WS cleanup on unmount) before the next mounts.
- `peekPendingUiCmd` window (2.5 s) must cover the gap between `emitUiCommand` and the lazy `LiveChamber` mount.

---

### Task 1: `lib/simConsole.ts` — thread types + command mapping

**Files:**
- Create: `site/src/lib/simConsole.ts`
- Test: `site/src/lib/simConsole.test.ts`

**Interfaces:**
- Produces:
  - `interface ToolCall { name: string; arg: string | null; live: boolean }`
  - `interface RunRequest { presetId: string | null; o2Pct: number | null; flowCms: number | null; gravityG: number | null; containment: string | null }`
  - `interface TurnCommands { tools: ToolCall[]; run: RunRequest | null }`
  - `toolCallsFromCommands(sim: SiSimulationCommands | null | undefined): TurnCommands`
  - `mergeChamberState(state: SiChamberState, sim: SiSimulationCommands): SiChamberState`
  - `presetToCommands(preset: MissionPreset-like): SiSimulationCommands`

- [ ] **Step 1: failing tests** — `toolCallsFromCommands` emits `chamber.run` (live) only when `load_preset|set_o2_percent|set_airflow_cm_s|trigger_containment` non-null; `mergeChamberState` maps `load_preset`→`investigationId`+`materialId` via `FALLBACK_INVESTIGATIONS` and `set_gravity_g`→`gravityRegime`; `presetToCommands` emits all four fields.
- [ ] **Step 2:** `cd site && npx vitest run src/lib/simConsole.test.ts` → FAIL (module missing).
- [ ] **Step 3: implement** `simConsole.ts` (pure functions only).
- [ ] **Step 4:** re-run vitest → PASS.
- [ ] **Step 5: commit** `feat(site): sim console command mapping helpers`.

### Task 2: `LiveChamber` `autoBoot` prop

**Files:**
- Modify: `site/src/components/LiveChamber.tsx` (~lines 23-29, 126-134)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LiveChamber({ stage?, autoBoot?, children? })` — `autoBoot?: boolean` default `true`; when `false`, skip the 250 ms boot `run()`.

- [ ] **Step 1:** add `autoBoot = true` prop; guard the boot effect with it.
- [ ] **Step 2:** `cd site && npx tsc -b` → clean.
- [ ] **Step 3: commit** `feat(site): optional autoBoot on LiveChamber`.

### Task 3: Turn primitives — `AgentTurn`, `SimRunCard`, `Composer`

**Files:**
- Create: `site/src/components/AgentTurn.tsx`
- Create: `site/src/components/SimRunCard.tsx`
- Create: `site/src/components/Composer.tsx`

**Interfaces:**
- Consumes: `ToolCall`/`RunRequest`/`TurnCommands` (Task 1); `LiveChamber` (Task 2); `getSimFrame`, `ignis:chamber-complete` (simBus); `SiChamberState` (api).
- Produces:
  - `AgentTurn({ turn }: { turn: AgentTurnModel })` — `AgentTurnModel = { id, tools, briefing, action, run: RunRequest | null, mode, ms }`; renders `IGNIS · worked {ms}s`, tool rows, prose, `<SimRunCard>` when `run`.
  - `SimRunCard({ run, live, onDone }: { run: RunRequest; live: boolean; onDone?: (f: ChamberState) => void })` — when `live`, mounts `<LiveChamber stage autoBoot={false}/>`; listens `ignis:chamber-complete` to show outcome chip (`extinct`/`out`/`cool flame` from regime) and call `onDone`.
  - `Composer({ onSend, onVoice, disabled }: { onSend: (text: string) => void; onVoice: (blob: Blob) => void; disabled?: boolean })` — input, Enter+send button, hold-◉ PTT (pointerdown/up, recording state + elapsed), inline error text.

- [ ] **Step 1:** implement the three components (styling per mockup A: sans prose, mono data, cyan accent, rounded panels).
- [ ] **Step 2:** `npx tsc -b` → clean; `npx oxlint src/components/AgentTurn.tsx src/components/SimRunCard.tsx src/components/Composer.tsx` → clean.
- [ ] **Step 3: commit** `feat(site): agent turn, run card, composer primitives`.

### Task 4: `SimConsole` — thread, send flow, chips, voice

**Files:**
- Create: `site/src/components/SimConsole.tsx`
- Modify: `site/src/lib/simConsole.ts` (add `AgentTurnModel`, `UserMsg`, `ChatMsg` types)

**Interfaces:**
- Consumes: everything above; `siChat`, `siVoice`, `emitSimulationCommands`; `MISSION_PRESETS` (from SimDeck — export it).
- Produces: `SimConsole({ presets }: { presets: MissionPreset[] })` — thread of `ChatMsg`, chamber `SiChamberState` (init `presets[0]`), send pipeline (thinking placeholder → response → turn → `emitSimulationCommands`), chip turns (deterministic `presetToCommands` + preset briefing/action), autoscroll-near-bottom.

- [ ] **Step 1:** implement; flow order per send: append user msg + pending turn → `siChat`/`siVoice` → fill turn (ms elapsed) → `emitSimulationCommands(sim, 'sim-console', state.investigationId)` → `mergeChamberState`.
- [ ] **Step 2:** `npx tsc -b` + `npx oxlint src/components/SimConsole.tsx` → clean.
- [ ] **Step 3: commit** `feat(site): SimConsole thread + composer + PTT voice`.

### Task 5: SimDeck rework + housekeeping

**Files:**
- Modify: `site/src/components/SimDeck.tsx`
- Modify: `.gitignore` (add `.superpowers/`)

**Interfaces:**
- Consumes: `SimConsole`; exports `MISSION_PRESETS` + `MissionPreset` type.
- Produces: overlay = hero (compressed) + `<SimConsole presets={MISSION_PRESETS}/>` full `.shell` width; card grid and `activeMission` selection removed.

- [ ] **Step 1:** rework SimDeck; delete grid block.
- [ ] **Step 2:** `npx tsc -b` → clean; `npx oxlint` → clean; `npm run build` → passes.
- [ ] **Step 3: commit** `feat(site): SimDeck full-bleed agent console`.
