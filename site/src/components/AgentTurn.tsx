import { useEffect, useState } from 'react'
import type { AgentTurnModel } from '../lib/simConsole'
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

export default function AgentTurn({
  turn,
}: {
  turn: AgentTurnModel
  live?: boolean
}) {
  const [quip, setQuip] = useState(0)
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

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink/65">
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_0_3px_rgba(73,184,214,.12)]" />
        <span className="font-semibold text-ink/80">Ignis</span>
        {turn.mode && <span>{turn.mode === 'llm' ? 'Connected' : 'Local response'}</span>}
      </div>

      {(turn.tools ?? []).length > 0 && (
        <details className="group rounded-2xl border border-edge/75 bg-ink/[0.025] px-4 py-2.5 dark:bg-white/[0.035]" open={turn.tools.some((tool) => tool.live)}>
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm text-ink/80 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span className="font-medium">Engine actions</span>
            <span className="rounded-full border border-edge/75 bg-bg/70 px-2 py-0.5 text-xs text-ink/65">{turn.tools.length}</span>
            {turn.engine && <span className="ml-auto text-sm text-ink/55">{turn.engine} engine</span>}
            <span aria-hidden="true" className="text-ink/50 transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-2 border-t border-edge/60 pt-2">
          {turn.tools.map((t, i) => (
            <div key={i} className="flex min-h-9 flex-wrap items-center gap-x-2.5 gap-y-1 py-1.5">
              {t.live ? (
                <span aria-label="Running" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              ) : (
                <span aria-label="Complete" className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">✓</span>
              )}
              <span className="font-mono text-sm text-ink/90">{t.name}</span>
              {t.arg && <span className="truncate font-mono text-sm text-ink/65">{t.arg}</span>}
              <span className={`ml-auto flex-none text-sm ${t.live ? 'text-accent' : 'text-emerald-700 dark:text-emerald-300'}`}>
                {t.live ? 'running' : 'done'}
              </span>
            </div>
          ))}
          </div>
        </details>
      )}

      <p className="m-0 text-base leading-7 text-ink/90">{turn.briefing}</p>
      {turn.action && (
        <p className="m-0 flex items-start gap-2 px-1 text-base leading-relaxed text-ink/70"><span className="font-semibold text-accent">Next</span>{turn.action}</p>
      )}

      {turn.riskIndex != null && !Number.isNaN(turn.riskIndex) && (
        <div className="flex items-center gap-3 rounded-2xl border border-edge/70 bg-ink/[0.035] px-4 py-3 dark:bg-white/[0.05]">
          <span className="font-display text-3xl font-bold tabular-nums leading-none tracking-tight text-amber-700 dark:text-amber-300">
            {Math.round(turn.riskIndex * 100)}
            <span className="text-lg font-semibold opacity-60">%</span>
          </span>
          <span className="font-mono text-tiny uppercase tracking-label text-ink/60">risk index</span>
        </div>
      )}

      {(turn.evidence ?? []).length > 0 && (
        <details className="group border-l border-edge/50 pl-3.5 text-sm text-ink/70">
          <summary className="cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-accent">
            NASA PSI evidence · {turn.evidence.length} {turn.evidence.length === 1 ? 'run' : 'runs'} <span className="float-right transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <ul className="mb-1 mt-2 space-y-1.5 pl-3">
            {turn.evidence.map((item, i) => (
              <li key={`${item.accession}-${item.runId ?? i}-${i}`}>
                {item.sourceUrl ? <a className="text-link underline decoration-link/30 underline-offset-2 hover:decoration-link" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.accession} · {item.fuel} · {item.outcome}</a> : `${item.accession} · ${item.fuel} · ${item.outcome}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      {turn.run && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/25 bg-accent/[0.06] px-4 py-3">
          <div className="min-w-0 flex-1 text-sm text-ink/75">
            Run queued{turn.run.presetId ? ` · ${turn.run.presetId}` : ''}
            {turn.run.o2Pct != null ? ` · O₂ ${turn.run.o2Pct}%` : ''}
            {turn.run.flowCms != null ? ` · ${turn.run.flowCms} cm/s` : ''}
          </div>
          <a
            href="#dashboard"
            className="flex-none rounded-full bg-[#1e3fae] px-4 py-2 font-mono text-xs font-semibold text-white transition-colors hover:bg-[#2a52d4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            view dashboards →
          </a>
        </div>
      )}
    </div>
  )
}
