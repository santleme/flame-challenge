import { useEffect, useRef, useState } from 'react'
import {
  engineStatus,
  siChat,
  siVoice,
  synthesizeLocalSiResponse,
  type EngineStatus,
  type SiChamberState,
  type SiResponse,
} from '../lib/api'
import { emitSimulationCommands } from '../lib/simBus'
import {
  mergeChamberState,
  toolCallsFromCommands,
  type ChatMsg,
  type PresetCommandSource,
} from '../lib/simConsole'
import AgentTurn from './AgentTurn'
import Composer from './Composer'

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
  const [engine, setEngine] = useState<EngineStatus>('checking')
  const chamberRef = useRef(chamber)
  chamberRef.current = chamber

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const idRef = useRef(0)
  const nid = () => ++idRef.current

  useEffect(() => {
    let cancelled = false
    void engineStatus().then((s) => {
      if (!cancelled) setEngine(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // the newest run-bearing turn owns the live chamber — flip its
  // chamber.run tool row to done when the stream completes
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
          if (m.kind === 'agent' && !m.run) break
        }
        return ms
      })
    window.addEventListener('ignis:chamber-complete', onDone)
    return () => window.removeEventListener('ignis:chamber-complete', onDone)
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
      emitSimulationCommands(sim, 'sim-console', chamberRef.current.investigationId ?? null)
      setChamber((s) => mergeChamberState(s, sim))
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
    ms: null,
  })

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink/15"
      >
        <div className="flex flex-col gap-7 py-4">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-label text-ink/60">
            <span
              className={
                engine === 'cpp'
                  ? 'h-1.5 w-1.5 rounded-full bg-emerald-500'
                  : 'h-1.5 w-1.5 rounded-full bg-amber-500'
              }
            />
            <span>engine {engine === 'cpp' ? 'c++ · 30 hz' : 'local mirror'}</span>
          </div>

          {msgs.length === 0 && (
            <div className="py-8">
              <p className="m-0 max-w-2xl text-body leading-copy text-ink/80">
                Describe a scenario — an atmosphere, a material, a historical
                fire — and Ignis translates it into chamber parameters, then
                streams a real combustion run from the compiled physics core.
                Voice works too: hold ◉ below.
              </p>
            </div>
          )}

          {msgs.map((m) =>
            m.kind === 'user' ? (
              <div
                key={m.id}
                className="ml-auto max-w-[70%] rounded-2xl rounded-br-md border border-accent/30 bg-accent/10 px-4 py-2.5 text-body leading-relaxed text-ink"
              >
                {m.text}
              </div>
            ) : (
              <AgentTurn key={m.id} turn={m} live={m.id === liveTurnId} />
            ),
          )}
        </div>
      </div>

      <div className="pt-3">
        <Composer onSend={sendText} onVoice={sendVoice} />
      </div>
    </div>
  )
}
