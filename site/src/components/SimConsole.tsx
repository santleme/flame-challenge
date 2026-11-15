import { useEffect, useRef, useState } from 'react'
import {
  siChat,
  siVoice,
  synthesizeLocalSiResponse,
  type SiChamberState,
  type SiResponse,
  type SiSimulationCommands,
} from '../lib/api'
import { emitSimulationCommands } from '../lib/simBus'
import {
  GRAVITY_G,
  mergeChamberState,
  presetToCommands,
  toolCallsFromCommands,
  type ChatMsg,
  type PresetCommandSource,
} from '../lib/simConsole'
import AgentTurn from './AgentTurn'
import Composer from './Composer'
import IgnisSprite from './IgnisSprite'

export interface SimPreset extends PresetCommandSource {
  id: string
  title: string
  description: string
  outcomeStatus: string
}

export default function SimConsole({ presets }: { presets: SimPreset[] }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [chamber, setChamber] = useState<SiChamberState>(() => ({
    investigationId: presets[0]?.investigationId ?? 'flex-2',
    materialId: null,
    o2Pct: presets[0]?.o2Pct ?? 21,
    flowCms: presets[0]?.flowCms ?? null,
    gravity: presets[0]?.gravity ?? 'microgravity',
  }))
  const chamberRef = useRef(chamber)
  chamberRef.current = chamber
  const busy = msgs.some((m) => m.kind === 'agent' && m.pending)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const idRef = useRef(0)
  const nid = () => ++idRef.current

  // the newest run-bearing turn owns the live chamber — flip its
  // chamber.run tool row to done when the stream completes or engine goes offline
  useEffect(() => {
    const onDone = () =>
      setMsgs((ms) => {
        for (let i = ms.length - 1; i >= 0; i--) {
          const m = ms[i]
          if (m.kind === 'agent' && m.run) {
            if (!m.tools.some((t) => t.live)) break
            const copy = [...ms]
            copy[i] = {
              ...m,
              tools: m.tools.map((t) => ({ ...t, live: false })),
            }
            return copy
          }
        }
        return ms
      })
    window.addEventListener('ignis:chamber-complete', onDone)
    window.addEventListener('ignis:chamber-offline', onDone)
    window.addEventListener('ignis:chamber-command-error', onDone)
    return () => {
      window.removeEventListener('ignis:chamber-complete', onDone)
      window.removeEventListener('ignis:chamber-offline', onDone)
      window.removeEventListener('ignis:chamber-command-error', onDone)
    }
  }, [])

  // follow the tail unless the operator scrolled up to read
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [msgs])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160
  }

  const applyResponse = (res: SiResponse, turnId: number, ms: number) => {
    const sim = res.simulation_commands ?? null
    const { tools, run } = toolCallsFromCommands(sim)
    // emit before setMsgs: the lazy LiveChamber mount peeks the pending
    // ui command (2.5 s window) — ordering matters, React batches the rest
    if (sim && Object.values(sim).some((v) => v != null)) {
      const nextChamber = mergeChamberState(chamberRef.current, sim)
      // Materialize full chamber configuration so replacement LiveChamber instances
      // in follow-up runs retain accumulated O2, airflow, and investigation settings.
      // Only expand commands that were already run-triggering — a bare
      // gravity retune must not restart the live experiment.
      const hasRunCondition =
        sim.load_preset != null ||
        sim.set_o2_percent != null ||
        sim.set_airflow_cm_s != null ||
        sim.trigger_containment != null
      const mergedSim: SiSimulationCommands = hasRunCondition
        ? {
            load_preset: sim.load_preset ?? nextChamber.investigationId ?? undefined,
            set_o2_percent: sim.set_o2_percent ?? nextChamber.o2Pct,
            set_airflow_cm_s: sim.set_airflow_cm_s ?? nextChamber.flowCms,
            set_gravity_g: sim.set_gravity_g ?? (GRAVITY_G[nextChamber.gravity] ?? 0),
            trigger_containment:
              sim.trigger_containment ?? (nextChamber.sealed ? 'sealed' : undefined),
          }
        : sim
      emitSimulationCommands(mergedSim, 'sim-console', nextChamber.investigationId ?? null)
      setChamber(nextChamber)
    }
    setMsgs((ms2) =>
      ms2.map((m) =>
        m.id === turnId
          ? {
              kind: 'agent',
              id: turnId,
              pending: false,
              tools,
              briefing: res.briefing,
              action: res.recommended_action || null,
              run,
              mode: res.mode,
              model: res.model,
              engine: res.engine ?? null,
              riskIndex: typeof res.chamber?.riskIndex === 'number' && !Number.isNaN(res.chamber.riskIndex) ? res.chamber.riskIndex : null,
              evidence: res.evidence ?? [],
              ms,
            }
          : m,
      ),
    )
  }

  const pendingTurn = (id: number): ChatMsg => ({
    kind: 'agent',
    id,
    pending: true,
    tools: [],
    briefing: '',
    action: null,
    run: null,
    mode: null,
    model: null,
    engine: null,
    riskIndex: null,
    evidence: [],
    ms: null,
  })

  // deterministic preset chips — the selection path the envelopes lost.
  // A chip also inserts a run-bearing turn so a SimRunCard mounts a
  // LiveChamber even in an empty conversation (emit first: the lazy
  // mount peeks the pending command, same ordering as applyResponse).
  const [pickedPresetId, setPickedPresetId] = useState<string | null>(null)
  const pickPreset = (preset: SimPreset) => {
    const sim = presetToCommands(preset)
    const nextChamber = mergeChamberState(chamberRef.current, sim)
    setChamber(nextChamber)
    setPickedPresetId(preset.id)
    const { tools, run } = toolCallsFromCommands(sim)
    emitSimulationCommands(sim, 'sim-console', preset.investigationId ?? null)
    setMsgs((ms) => [
      ...ms,
      {
        kind: 'agent',
        id: nid(),
        pending: false,
        tools,
        briefing: preset.description,
        action: null,
        run,
        mode: 'preset',
        model: null,
        engine: null,
        riskIndex: null,
        evidence: [],
        ms: null,
      },
    ])
  }

  const sendText = async (text: string) => {
    const uid = nid()
    const tid = nid()
    stickRef.current = true
    setMsgs((ms) => [...ms, { kind: 'user', id: uid, text }, pendingTurn(tid)])
    const t0 = performance.now()
    const res =
      (await siChat(text, chamberRef.current)) ??
      synthesizeLocalSiResponse(text, chamberRef.current)
    applyResponse(res, tid, performance.now() - t0)
  }

  const sendVoice = async (blob: Blob) => {
    const uid = nid()
    const tid = nid()
    stickRef.current = true
    // the pending turn doubles as the "listening / thinking" indicator
    setMsgs((ms) => [...ms, pendingTurn(tid)])
    const t0 = performance.now()
    const res = await siVoice(blob, chamberRef.current)
    const transcript = res?.transcript?.trim() || 'voice command'
    // insert the transcribed user bubble right before the pending turn
    setMsgs((ms) => {
      const out: ChatMsg[] = []
      for (const m of ms) {
        if (m.id === tid) out.push({ kind: 'user', id: uid, text: `◉ ${transcript}` })
        out.push(m)
      }
      return out
    })
    if (res) {
      applyResponse(res, tid, performance.now() - t0)
    } else {
      setMsgs((ms) =>
        ms.map((m) =>
          m.id === tid
            ? {
                kind: 'agent' as const,
                id: tid,
                pending: false,
                tools: [],
                briefing: 'Voice uplink failed — type or retry.',
                action: null,
                run: null,
                mode: 'offline-fallback',
                model: null,
                engine: null,
                riskIndex: null,
                evidence: [],
                ms: performance.now() - t0,
              }
            : m,
        ),
      )
    }
  }

  let liveTurnId = -1
  for (const m of msgs) {
    if (m.kind === 'agent' && m.run) liveTurnId = m.id
  }

  return (
    <section aria-label="Ignis conversation" className="flex min-h-0 flex-1 flex-col font-chat-sans">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="Conversation with Ignis"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink/15"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-7 py-5 sm:py-7">

          {msgs.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center py-3 text-center sm:py-6">
              <IgnisSprite working={busy} />
              <h2 className="m-0 mt-2 max-w-xl font-jetbrains text-[clamp(1.75rem,4vw,2.25rem)] font-bold leading-tight tracking-tight">
                What are we testing today?
              </h2>
              <p className="mb-0 mt-3 max-w-xl font-chat-sans text-base font-normal leading-7 text-ink/75 sm:text-lg">
                Ask Ignis about an experiment or describe what you want to test.
              </p>
            </div>
          )}

          {msgs.map((m) =>
            m.kind === 'user' ? (
              <div
                key={m.id}
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-sky-200/70 bg-sky-100/75 px-4 py-3 text-base leading-relaxed text-slate-800 dark:border-sky-300/15 dark:bg-sky-400/10 dark:text-ink sm:max-w-[75%]"
              >
                {m.text}
              </div>
            ) : (
              <AgentTurn key={m.id} turn={m} live={m.id === liveTurnId} />
            ),
          )}
        </div>
      </div>

      {presets.length > 0 && (
        <div
          role="group"
          aria-label="Mission presets"
          className="mx-auto flex w-full max-w-3xl gap-2 overflow-x-auto pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {presets.slice(0, 8).map((p) => {
            const isActive = pickedPresetId === p.id
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={isActive}
                disabled={busy}
                onClick={() => pickPreset(p)}
                className={`flex-none whitespace-nowrap rounded-full border px-3 py-1.5 font-mono text-tiny font-semibold lowercase tracking-label transition-[border-color,color,background-color,transform] duration-150 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-50 motion-reduce:transform-none ${
                  isActive
                    ? 'border-accent/70 bg-accent/10 text-accent'
                    : 'border-edge/60 bg-white/50 text-ink/65 hover:border-edge hover:text-ink dark:bg-white/[0.04]'
                }`}
              >
                {p.title.replace(/^(historical crisis|guided scenario|mission):\s*/i, '')}
              </button>
            )
          })}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl pt-3">
        <Composer
          onSend={sendText}
          onVoice={sendVoice}
          disabled={busy}
          flameDefaults={{
            gravityG: GRAVITY_G[chamber.gravity] ?? 0,
            o2Pct: chamber.o2Pct,
            airflowCms: chamber.flowCms ?? 0.5,
            coolFlame: false,
          }}
        />
      </div>
    </section>
  )
}
