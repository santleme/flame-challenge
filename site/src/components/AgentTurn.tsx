import { useEffect, useState, type ReactNode } from 'react'
import { navigate } from '../lib/scroll'
import type { AgentTurnModel } from '../lib/simConsole'
import type { SiEvidence, SiSimulationCommands } from '../lib/api'
import IgnisSprite from './IgnisSprite'

/** rotating status quips while the copilot thinks — dry mission-log humor */
const WORKING_QUIPS = [
  'Ignis is working…',
  'Calibrating oxygen sensors…',
  'A module just broke. Logging it.',
  'Querying NASA PSI archives…',
  'Rechecking crew oxygen budget…',
  'One astronaut misplaced. Found him.',
  'Venting the wrong valve — fixing.',
  'Re-running the burn simulation…',
  'Flashover risk: arguing with physics…',
  'Patching hull integrity (software side)…',
  'Crew notified. Nobody panicked. Yet.',
  'Duct-taping the O₂ generator…',
  'Cool flame detected — it is being subtle.',
  'Asking the engine nicely this time…',
  'Saffire says hi. And fire.',
  'Purging nitrogen. And doubts.',
]

const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (n: number) =>
  String(n)
    .split('')
    .map((d) => SUP_DIGITS[Number(d)])
    .join('')

/** converts recognized protocol codes into concrete simulation commands */
function protocolToCommands(action: string | null | undefined): SiSimulationCommands | null {
  if (!action) return null
  const code = action.trim().toUpperCase()
  switch (code) {
    case 'CUT_VENTILATION':
      return { set_airflow_cm_s: 0 }
    case 'REDUCE_O2':
      return { set_o2_percent: 14 }
    case 'COOL_AND_ISOLATE':
      return { trigger_containment: 'sealed' }
    default:
      return null
  }
}

/** physical quantities the prose sets in medium ink instead of a chip */
const PARAM_RE =
  /(\d+(?:[.,]\d+)?\s?%(?:\s?O₂)?|\d+(?:[.,]\d+)?\s?cm\/s\b|\d+(?:[.,]\d+)?\s?K\b|\d+(?:[.,]\d+)?\s?psia\b|\bLOC\b|O₂|N₂|CO₂)/g

/** one footnote per accession — the neighbors feed can repeat a run */
function dedupeEvidence(evidence: SiEvidence[]): SiEvidence[] {
  const seen = new Set<string>()
  return evidence.filter((e) => {
    const key = e.accession || e.runId
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** first span in the briefing where each cited experiment is named */
function citeSpans(text: string, evidence: SiEvidence[]): { start: number; end: number; index: number }[] {
  const spans: { start: number; end: number; index: number }[] = []
  evidence.forEach((e, index) => {
    const terms = [e.accession, e.investigationId]
      .filter((t): t is string => Boolean(t && t.length > 2))
      .map((t) => escapeRe(t).replace(/[-_]/g, '[-_\\s]?'))
    if (!terms.length) return
    const re = new RegExp(`\\b(?:${terms.join('|')})\\b`, 'i')
    const m = re.exec(text)
    if (m) spans.push({ start: m.index, end: m.index + m[0].length, index })
  })
  return spans.sort((a, b) => a.start - b.start)
}

/** prose with physical params in medium ink + superscript run markers */
function renderBriefing(text: string, evidence: SiEvidence[]): ReactNode {
  const spans = citeSpans(text, evidence).filter(
    (s, i, all) => i === 0 || s.start >= all[i - 1].end,
  )
  const out: ReactNode[] = []
  let cursor = 0
  let key = 0

  const pushParams = (chunk: string) => {
    if (!chunk) return
    const parts = chunk.split(PARAM_RE)
    parts.forEach((part, i) => {
      if (!part) return
      if (i % 2 === 1) {
        out.push(
          <span key={key++} className="font-medium text-ink">
            {part}
          </span>,
        )
      } else {
        out.push(part)
      }
    })
  }

  for (const s of spans) {
    pushParams(text.slice(cursor, s.start))
    pushParams(text.slice(s.start, s.end))
    out.push(
      <sup key={key++} className="ml-px font-mono text-[10px] text-accent">
        {sup(s.index + 1)}
      </sup>,
    )
    cursor = s.end
  }
  pushParams(text.slice(cursor))
  return out
}

export default function AgentTurn({
  turn,
  onApply,
}: {
  turn: AgentTurnModel
  live?: boolean
  onApply?: (sim: SiSimulationCommands) => void
}) {
  const [quip, setQuip] = useState(0)
  const [applied, setApplied] = useState(false)
  useEffect(() => {
    if (!turn.pending) return
    setQuip(Math.floor(Math.random() * WORKING_QUIPS.length))
    const timer = window.setInterval(
      () => setQuip((q) => (q + 1 + Math.floor(Math.random() * 3)) % WORKING_QUIPS.length),
      2200,
    )
    return () => window.clearInterval(timer)
  }, [turn.pending])

  if (turn.pending) {
    return (
      <div className="flex items-center gap-3 py-1 text-sm text-ink/65">
        <IgnisSprite working size={68} />
        <span key={quip} className="transition-opacity">{WORKING_QUIPS[quip]}</span>
      </div>
    )
  }

  const evidence = dedupeEvidence(turn.evidence ?? [])
  const riskPct =
    turn.riskIndex != null && !Number.isNaN(turn.riskIndex)
      ? Math.round(turn.riskIndex * 100)
      : null
  const executableCommands = protocolToCommands(turn.action)

  const applyProtocol = () => {
    if (!executableCommands) return
    onApply?.(executableCommands)
    setApplied(true)
  }

  const loadRun = (e: SiEvidence) => {
    const sim: SiSimulationCommands = {}
    if (e.investigationId) sim.load_preset = e.investigationId
    if (typeof e.o2Pct === 'number') sim.set_o2_percent = e.o2Pct
    if (typeof e.flowCms === 'number') sim.set_airflow_cm_s = e.flowCms
    if (Object.values(sim).some((v) => v != null)) onApply?.(sim)
  }

  return (
    <div className="w-full">
      {/* — agent identity — mono micro, no chrome */}
      <div className="flex items-baseline gap-3 font-mono text-micro uppercase tracking-label text-ink/50">
        <span className="font-semibold text-ink/80">Ignis</span>
        {turn.mode && <span>{turn.mode === 'llm' ? 'Connected' : 'Local response'}</span>}
        {turn.engine && <span className="ml-auto normal-case">{turn.engine} engine</span>}
      </div>

      {/* — asymmetric grid: naked telemetry margin + editorial prose — */}
      <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-[140px_1fr]">
        <div>
          {riskPct != null && (
            <div>
              <div className="font-chat-sans text-[56px] font-light leading-none tracking-tight tabular-nums text-ink">
                {riskPct}
                <span className="text-[26px] font-light text-ink/50">%</span>
              </div>
              <div className="relative mt-3 h-[2px] w-full bg-ink/10">
                {turn.riskBand && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 bg-ink/50"
                    style={{
                      left: `${Math.max(0, Math.min(1, turn.riskBand.lower)) * 100}%`,
                      width: `${Math.max(0, Math.min(1, turn.riskBand.upper) - Math.max(0, Math.min(1, turn.riskBand.lower))) * 100}%`,
                    }}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="absolute -top-[3px] h-[8px] w-[2px] bg-accent"
                  style={{ left: `calc(${riskPct}% - 1px)` }}
                />
              </div>
              <div className="mt-2.5 whitespace-nowrap font-mono text-micro uppercase tracking-label text-ink/45">
                risk · psi-calibrated
              </div>
              {turn.riskBand && (
                <div className="mt-0.5 font-mono text-micro tabular-nums text-ink/40">
                  90% band {Math.round(turn.riskBand.lower * 100)}–{Math.round(turn.riskBand.upper * 100)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 max-w-[62ch]">
          <p className="m-0 font-chat-sans text-[15px] leading-7 tracking-[-0.01em] text-ink/80">
            {renderBriefing(turn.briefing, evidence)}
          </p>

          {turn.action && (
            executableCommands ? (
              <button
                type="button"
                onClick={applyProtocol}
                className="group mt-4 flex items-center gap-2.5 border-none bg-transparent p-0 text-left font-mono text-[13px] text-ink/75 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 flex-none rounded-full ${applied ? 'bg-emerald-600' : 'animate-pulse bg-accent motion-reduce:animate-none'}`}
                />
                <span className="relative">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block transition-transform duration-200 group-hover:translate-x-1"
                  >
                    ↳
                  </span>
                  Apply protocol:{' '}
                  <span className="font-semibold uppercase tracking-micro">{turn.action.trim()}</span>
                  {applied && <span className="text-ink/45"> · applied</span>}
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1 left-0 h-px w-0 bg-ink transition-[width] duration-300 group-hover:w-full"
                  />
                </span>
              </button>
            ) : (
              <p className="m-0 mt-4 flex items-baseline gap-2.5 font-mono text-[13px] text-ink/75">
                <span aria-hidden="true" className="h-1.5 w-1.5 flex-none self-center rounded-full bg-ink/40" />
                <span>
                  <span aria-hidden="true" className="mr-2">↳</span>
                  {turn.action}
                </span>
              </p>
            )
          )}

          {(turn.tools ?? []).length > 0 && (
            <details
              className="group mt-6"
              open={turn.tools.some((tool) => tool.live)}
            >
              <summary className="flex min-h-7 cursor-pointer list-none items-center gap-3 font-mono text-micro uppercase tracking-label text-ink/50 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <span>engine actions</span>
                <span className="tabular-nums text-ink/40">{turn.tools.length}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-ink/10" />
                <span aria-hidden="true" className="transition-transform duration-300 group-open:rotate-180">⌄</span>
              </summary>
              <ul className="m-0 mt-1 list-none p-0 font-mono text-[13px]">
                {turn.tools.map((t, i) => (
                  <li key={i} className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink/10 py-2">
                    {t.live ? (
                      <span aria-label="Running" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
                    ) : (
                      <span aria-label="Complete" className="text-emerald-700 dark:text-emerald-300">✓</span>
                    )}
                    <span className="text-ink/90">{t.name}</span>
                    {t.arg && <span className="truncate text-ink/50">{t.arg}</span>}
                    <span className={`ml-auto flex-none ${t.live ? 'text-accent' : 'text-ink/45'}`}>
                      {t.live ? 'running' : 'done'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {turn.run && (
            <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[13px]">
              <span className="text-ink/80">
                run queued{turn.run.presetId ? ` · ${turn.run.presetId}` : ''}
                {turn.run.o2Pct != null ? ` · O₂ ${turn.run.o2Pct}%` : ''}
                {turn.run.flowCms != null ? ` · ${turn.run.flowCms} cm/s` : ''}
              </span>
              <a
                href="#dashboard-reports"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('#dashboard-reports')
                }}
                className="text-link no-underline underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                view dashboards →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* — scientific footnotes: hairline rule + superscript index, no box — */}
      {evidence.length > 0 && (
        <div className="mt-7 border-t border-ink/10 pt-3">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            {evidence.map((item, i) => (
              <span key={`${item.accession}-${i}`} className="inline-flex items-baseline gap-2 font-mono text-[12px]">
                <sup className="text-[10px] text-accent">{sup(i + 1)}</sup>
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`View ${item.accession} on NASA PSI`}
                    className="text-ink/65 underline decoration-ink/20 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {item.accession} · {item.fuel} ({item.outcome})
                    <span aria-hidden="true" className="ml-1 text-[10px] text-ink/40">↗</span>
                  </a>
                ) : (
                  <span className="text-ink/65">
                    {item.accession} · {item.fuel} ({item.outcome})
                  </span>
                )}
                {onApply && (
                  <button
                    type="button"
                    onClick={() => loadRun(item)}
                    title="Load these test conditions into the simulation chamber"
                    className="border-none bg-transparent p-0 font-mono text-micro tracking-micro text-ink/40 transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    ↳ simulate
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
