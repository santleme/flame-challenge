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
import { analysisScenarioForResponse, generateDashboard } from '../lib/generatedDashboards'
import { navigate } from '../lib/scroll'
import {
  GRAVITY_G,
  mergeChamberState,
  toolCallsFromCommands,
  type AgentTurnModel,
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

// sim and dashboard are exclusive views — following "view dashboards"
// unmounts this console and plain useState would drop the whole chat and
// chamber state on every round trip. Module-level cache keeps the session
// alive across remounts (cleared on full reload, which is correct).
let cachedMsgs: ChatMsg[] | null = null
let cachedChamber: SiChamberState | null = null

export default function SimConsole({ presets }: { presets: SimPreset[] }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() =>
    (cachedMsgs ?? []).map((m) =>
      // a pending turn can't resolve while unmounted — close it out so the
      // composer isn't stuck busy and the row doesn't shimmer forever
      m.kind === 'agent' && m.pending
        ? { ...m, pending: false, briefing: m.briefing || 'reply lost — the view changed before it landed' }
        : m,
    ),
  )
  const [chamber, setChamber] = useState<SiChamberState>(
    () =>
      cachedChamber ?? {
        investigationId: presets[0]?.investigationId ?? 'flex-2',
        materialId: null,
        o2Pct: presets[0]?.o2Pct ?? 21,
        flowCms: presets[0]?.flowCms ?? null,
        gravity: presets[0]?.gravity ?? 'microgravity',
      },
  )
  const chamberRef = useRef(chamber)
  chamberRef.current = chamber
  const busy = msgs.some((m) => m.kind === 'agent' && m.pending)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  // restored messages keep their ids — start the counter past them or
  // new turns reuse keys React already rendered
  const idRef = useRef(Math.max(0, ...(cachedMsgs ?? []).map((m) => m.id)))
  const nid = () => ++idRef.current

  useEffect(() => {
    cachedMsgs = msgs
  }, [msgs])
  useEffect(() => {
    cachedChamber = chamber
  }, [chamber])

  // write-through: publish state to the session cache BEFORE React commits.
  // A reply that itself navigates to the dashboard unmounts this console in
  // the same batch — effect-based caching would lose the completed turn.
  const msgsRef = useRef<ChatMsg[]>(msgs)
  const commitMsgs = (updater: (ms: ChatMsg[]) => ChatMsg[]) => {
    const next = updater(msgsRef.current)
    msgsRef.current = next
    cachedMsgs = next
    setMsgs(next)
  }
  const commitChamber = (next: SiChamberState) => {
    chamberRef.current = next
    cachedChamber = next
    setChamber(next)
  }

  // the newest run-bearing turn owns the live chamber — flip its
  // chamber.run tool row to done when the stream completes or engine goes offline
  useEffect(() => {
    const onDone = () =>
      commitMsgs((ms) => {
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

  const applyResponse = (res: SiResponse, turnId: number, ms: number, suppressNav = false, prompt = '', sent?: SiChamberState, provisional = false) => {
    const sim = res.simulation_commands ?? null
    const { tools, run } = toolCallsFromCommands(sim)
    // emit before setMsgs: the lazy LiveChamber mount peeks the pending
    // ui command (2.5 s window) — ordering matters, React batches the rest.
    // A provisional preview is display-only: its locally-guessed commands
    // never touch the chamber, or partial live commands would merge onto
    // a contaminated state. The final response commits its commands once.
    if (!provisional && sim && Object.values(sim).some((v) => v != null)) {
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
      // a run-triggering turn produces a mission report — the dashboard
      // panel listens on 'ignis:dashboard-generated' and shows it as '· live'.
      // scenario = post-command execution chamber; analysisScenario = the
      // operating point res.chamber was actually scored at (commands may
      // have retuned O₂/flow after scoring). A provisional local answer
      // skips this — the live response that upgrades it owns the report,
      // so one run never yields two briefs
      if (hasRunCondition && !provisional) {
        generateDashboard(
          prompt, res, undefined, nextChamber,
          analysisScenarioForResponse(res, sent ?? nextChamber),
        )
      }
      commitChamber(nextChamber)
    }
    // when the copilot points somewhere (generated dashboards, a section),
    // follow it — this is how answers surface the dashboards they produced
    const section = res.navigation?.scroll_to_section
    // preset-driven turns must never leave the deck — the operator just
    // asked to simulate here, so a stray 'psi-dataset' hop is a bug
    if (section && !suppressNav && !provisional) {
      // 'chamber' is the copilot's name for this console — the live-chamber
      // video section no longer exists
      const target = section === 'chamber' ? '#ignis-console' : section.startsWith('#') ? section : `#${section}`
      if (target === '#ignis-console') {
        document.getElementById('ignis-console')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        navigate(target)
      }
    }
    // never auto-navigate after generating a report: sim and dashboard
    // are exclusive views, so leaving the deck would unmount the console
    // and discard chat, chamber state and the running experiment. The
    // turn's "view dashboards" link is the deliberate way over.
    commitMsgs((ms2) =>
      ms2.map((m) =>
        m.id === turnId
          ? {
              kind: 'agent',
              id: turnId,
              pending: false,
              // a preview claims nothing it hasn't done: tool rows and
              // the run/dashboard link appear only once real commands
              // were committed (the upgrade rewrites them below)
              tools: provisional ? [] : tools,
              briefing: res.briefing,
              action: res.recommended_action || null,
              run: provisional ? null : run,
              mode: res.mode,
              model: res.model,
              engine: res.engine ?? null,
              riskIndex: typeof res.chamber?.riskIndex === 'number' && !Number.isNaN(res.chamber.riskIndex) ? res.chamber.riskIndex : null,
              riskBand: (() => {
                const u = res.chamber?.uncertainty as { lower?: unknown; upper?: unknown } | undefined
                return typeof u?.lower === 'number' && typeof u?.upper === 'number'
                  ? { lower: u.lower, upper: u.upper }
                  : null
              })(),
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

  const sendTextRef = useRef<((text: string, display?: string, opts?: { suppressNav?: boolean; presetCommands?: SiSimulationCommands }) => Promise<void>) | null>(null)
  // sends serialize through this tail: a follow-up fired while a preview
  // still waits on its live answer reads chamberRef only after the live
  // response commits — never the pre-preview state. The composer stays
  // usable; the queued turn just starts its request late.
  const tailRef = useRef<Promise<void>>(Promise.resolve())
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
      // don't commit the preset yet — the send queues behind any reply
      // still in flight, and that reply's own commands would overwrite
      // these settings before `sent` is captured. The preset travels with
      // the prompt and is applied when this mission's turn starts.
      // several missions share an investigationId (apollo 1 & 11 → flare,
      // apollo 13 & 12 → same) — match the deck envelope by its own id
      const preset =
        presets.find((p) => p.id === cmd.__presetId) ??
        presets.find(
          (p) => p.investigationId === (cmd.__investigation ?? cmd.load_preset),
        )
      void sendTextRef.current?.(
        preset?.prompt ?? `Analyze ${cmd.__investigation ?? cmd.load_preset ?? 'this mission'}.`,
        preset ? `Explore mission — ${preset.title}` : undefined,
        { suppressNav: true, presetCommands: sim },
      )
    }
    window.addEventListener('ignis:ui-command', onDeckCommand)
    return () => window.removeEventListener('ignis:ui-command', onDeckCommand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets])

  const sendText = (text: string, display?: string, opts?: { suppressNav?: boolean; presetCommands?: SiSimulationCommands }) => {
    const uid = nid()
    const tid = nid()
    stickRef.current = true
    commitMsgs((ms) => [...ms, { kind: 'user', id: uid, text: display ?? text }, pendingTurn(tid)])
    const t0 = performance.now()
    const mine = tailRef.current.then(async () => {
      // a queued mission applies its envelope here — after the reply in
      // flight committed, before this request captures its chamber
      if (opts?.presetCommands) {
        commitChamber(mergeChamberState(chamberRef.current, opts.presetCommands))
      }
      const sent = chamberRef.current
      // progressive answer: the deterministic local model is instant and
      // grounded — show it when the copilot is slow (>8 s, e.g. a cold or
      // busy gateway), then upgrade the same turn when the live answer
      // lands. siChat itself resolves locally at its own timeout, so the
      // turn always ends complete.
      const live = siChat(text, sent)
      const winner = await Promise.race([
        live.then((r) => ({ r, provisional: false })),
        new Promise<{ r: SiResponse; provisional: boolean }>((resolve) =>
          window.setTimeout(
            () => resolve({ r: synthesizeLocalSiResponse(text, sent), provisional: true }),
            8000,
          ),
        ),
      ])
      const res = winner.r ?? synthesizeLocalSiResponse(text, sent)
      applyResponse(res, tid, performance.now() - t0, opts?.suppressNav, text, sent, winner.provisional)
      if (winner.provisional) {
        const later = await live
        // the final answer commits its commands once, merging onto the
        // original sent state (the preview never touched the chamber).
        // If the uplink failed outright, the preview becomes the answer
        // and its commands run like a normal offline turn.
        applyResponse(later ?? res, tid, performance.now() - t0, opts?.suppressNav, text, sent, false)
      }
    })
    tailRef.current = mine.catch(() => {})
    return mine
  }
  sendTextRef.current = sendText

  const sendVoice = (blob: Blob) => {
    const uid = nid()
    const tid = nid()
    stickRef.current = true
    // the pending turn doubles as the "listening / thinking" indicator
    commitMsgs((ms) => [...ms, pendingTurn(tid)])
    const t0 = performance.now()
    const mine = tailRef.current.then(async () => {
      const sent = chamberRef.current
      const res = await siVoice(blob, sent)
      const transcript = res?.transcript?.trim() || 'voice command'
      // insert the transcribed user bubble right before the pending turn
      commitMsgs((ms) => {
        const out: ChatMsg[] = []
        for (const m of ms) {
          if (m.id === tid) out.push({ kind: 'user', id: uid, text: `◉ ${transcript}` })
          out.push(m)
        }
        return out
      })
      if (res) {
        applyResponse(res, tid, performance.now() - t0, false, transcript, sent)
      } else {
        commitMsgs((ms) =>
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
    })
    tailRef.current = mine.catch(() => {})
    return mine
  }

  let liveTurnId = -1
  for (const m of msgs) {
    if (m.kind === 'agent' && m.run) liveTurnId = m.id
  }

  // protocol + evidence actions dispatch straight onto the chamber bus —
  // the turn stays the operator's log of what was asked and applied
  const applyCommands = (sim: SiSimulationCommands) => {
    const next = mergeChamberState(chamberRef.current, sim)
    emitSimulationCommands(sim, 'sim-console', next.investigationId ?? null)
    commitChamber(next)
  }

  // pair each query with its answer: the stream reads as a mission log —
  // numbered operator entries, each followed by Ignis's analysis
  const groups: { key: string; user: ChatMsg | null; agents: AgentTurnModel[]; n: number }[] = []
  let queryCount = 0
  for (const m of msgs) {
    if (m.kind === 'user') {
      queryCount++
      groups.push({ key: `u${m.id}`, user: m, agents: [], n: queryCount })
    } else {
      const tail = groups[groups.length - 1]
      if (tail && tail.user) tail.agents.push(m)
      else groups.push({ key: `a${m.id}`, user: null, agents: [m], n: 0 })
    }
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
              <div className="mt-8 flex max-w-xl flex-wrap items-baseline justify-center gap-x-8 gap-y-2">
                {[
                  'Run a SAFFIRE burn',
                  'Is methanol safe at 24% O₂?',
                  'Show me the riskiest scenario',
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendText(s)}
                    className="group border-none bg-transparent p-0 font-mono text-[13px] text-ink/60 transition-colors duration-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span aria-hidden="true" className="mr-2 inline-block transition-transform duration-200 group-hover:translate-x-1">→</span>
                    <span className="underline decoration-ink/20 underline-offset-4 transition-colors group-hover:decoration-ink/60">{s}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {groups.map((g, gi) => (
            <article
              key={g.key}
              className={gi > 0 ? 'border-t border-ink/10 pt-9' : ''}
            >
              {g.user?.kind === 'user' && (
                <header>
                  <div className="font-mono text-micro uppercase tracking-label text-ink/45">
                    <span className="tabular-nums">{String(g.n).padStart(2, '0')}</span>
                    <span aria-hidden="true" className="mx-2 text-ink/30">//</span>
                    <span>mission query</span>
                  </div>
                  <p className="m-0 mt-2.5 border-l-2 border-ink/70 pl-4 font-chat-sans text-[20px] font-medium leading-snug tracking-[-0.015em] text-ink sm:text-[24px]">
                    {g.user.text}
                  </p>
                </header>
              )}
              {g.agents.map((a, ai) => (
                <div key={a.id} className={g.user || ai > 0 ? 'mt-6' : ''}>
                  <AgentTurn turn={a} live={a.id === liveTurnId} onApply={applyCommands} />
                </div>
              ))}
            </article>
          ))}
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
