import { useEffect, useRef, useState } from 'react'
import {
  siChat,
  siVoice,
  synthesizeLocalSiResponse,
  type ChamberUiCommand,
  type SiChamberState,
  type SiResponse,
  type SiSimulationCommands,
} from '../lib/api'
import { emitSimulationCommands } from '../lib/simBus'
import { navigate } from '../lib/scroll'
import {
  GRAVITY_G,
  mergeChamberState,
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
  prompt?: string
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

  const applyResponse = (res: SiResponse, turnId: number, ms: number, suppressNav = false) => {
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
    // when the copilot points somewhere (generated dashboards, a section),
    // follow it — this is how answers surface the dashboards they produced
    const section = res.navigation?.scroll_to_section
    // preset-driven turns must never leave the deck — the operator just
    // asked to simulate here, so a stray 'psi-dataset' hop is a bug
    if (section && !suppressNav) {
      // 'chamber' is the copilot's name for this console — the live-chamber
      // video section no longer exists
      const target = section === 'chamber' ? '#ignis-console' : section.startsWith('#') ? section : `#${section}`
      if (target === '#ignis-console') {
        document.getElementById('ignis-console')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        navigate(target)
      }
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

  const sendTextRef = useRef<((text: string, display?: string, opts?: { suppressNav?: boolean }) => Promise<void>) | null>(null)
  // mission envelopes in the deck above announce picks on the chamber bus
  // (__origin 'sim-deck'). Each pick becomes a real LLM turn: the preset's
  // chamber context is applied first so the copilot answers under the
  // mission's O₂/flow/gravity conditions.
  useEffect(() => {
    const onDeckCommand = (event: Event) => {
      const cmd = (event as CustomEvent<ChamberUiCommand>).detail
      if (!cmd || cmd.__origin !== 'sim-deck') return
      const sim: SiSimulationCommands = {
        load_preset: cmd.load_preset ?? undefined,
        set_o2_percent: cmd.set_o2_percent ?? undefined,
        set_airflow_cm_s: cmd.set_airflow_cm_s ?? undefined,
        set_gravity_g: cmd.set_gravity_g ?? undefined,
        trigger_containment: cmd.trigger_containment ?? undefined,
      }
      const nextChamber = mergeChamberState(chamberRef.current, sim)
      setChamber(nextChamber)
      const preset = presets.find(
        (p) => p.investigationId === (cmd.__investigation ?? cmd.load_preset),
      )
      void sendTextRef.current?.(
        preset?.prompt ?? `Analyze ${cmd.__investigation ?? cmd.load_preset ?? 'this mission'}.`,
        preset ? `Explore mission — ${preset.title}` : undefined,
        { suppressNav: true },
      )
    }
    window.addEventListener('ignis:ui-command', onDeckCommand)
    return () => window.removeEventListener('ignis:ui-command', onDeckCommand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets])

  const sendText = async (text: string, display?: string, opts?: { suppressNav?: boolean }) => {
    const uid = nid()
    const tid = nid()
    stickRef.current = true
    setMsgs((ms) => [...ms, { kind: 'user', id: uid, text: display ?? text }, pendingTurn(tid)])
    const t0 = performance.now()
    const res =
      (await siChat(text, chamberRef.current)) ??
      synthesizeLocalSiResponse(text, chamberRef.current)
    applyResponse(res, tid, performance.now() - t0, opts?.suppressNav)
  }
  sendTextRef.current = sendText

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
              <div className="mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2">
                {[
                  'Run a SAFFIRE burn',
                  'Is methanol safe at 24% O₂?',
                  'Show me the riskiest scenario',
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendText(s)}
                    className="rounded-full border border-edge/70 bg-ink/[0.035] px-4 py-2 font-mono text-sm text-ink/80 transition-colors duration-200 hover:border-accent/60 hover:bg-accent/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:bg-white/[0.05]"
                  >
                    {s}
                  </button>
                ))}
              </div>
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
