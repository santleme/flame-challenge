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
        <details className="group rounded-2xl border border-edge/60 bg-panel/60 px-4 py-2 shadow-[0_1px_2px_rgba(23,33,43,0.05)] backdrop-blur-sm transition-colors hover:border-edge/90 dark:bg-white/[0.04]" open={turn.tools.some((tool) => tool.live)}>
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm text-ink/80 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span className="font-medium">Engine actions</span>
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-micro font-semibold text-accent">{turn.tools.length}</span>
            {turn.engine && <span className="ml-auto font-mono text-tiny uppercase tracking-label text-ink/45">{turn.engine} engine</span>}
            <span aria-hidden="true" className="text-ink/45 transition-transform duration-300 group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-1.5 border-t border-edge/50 pt-1.5">
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

      <p className="m-0 font-chat-sans text-[15px] leading-7 tracking-[-0.01em] text-ink/85">{turn.briefing}</p>
      {turn.action && (
        <p className="m-0 flex items-start gap-2 rounded-xl border-l-2 border-accent/60 bg-accent/[0.05] px-3 py-2 font-chat-sans text-sm leading-relaxed text-ink/75"><span className="font-mono text-micro font-bold uppercase tracking-label text-accent">Next</span>{turn.action}</p>
      )}

      {turn.riskIndex != null && !Number.isNaN(turn.riskIndex) && (
        <div className="flex items-center gap-4 rounded-2xl border border-edge/60 bg-gradient-to-br from-ink/[0.05] to-transparent px-5 py-4 shadow-[0_1px_2px_rgba(23,33,43,0.05)] dark:from-white/[0.06]">
          <span className="font-display text-4xl font-bold tabular-nums leading-none tracking-tight text-amber-700 dark:text-amber-300">
            {Math.round(turn.riskIndex * 100)}
            <span className="text-xl font-semibold opacity-60">%</span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-tiny font-semibold uppercase tracking-label text-ink/60">risk index</span>
            <span className="font-mono text-micro uppercase tracking-label text-ink/40">fitted model · PSI-calibrated</span>
          </span>
        </div>
      )}

      {(turn.evidence ?? []).length > 0 && (
        <details className="group rounded-2xl border border-edge/60 bg-panel/60 px-4 py-2.5 text-sm text-ink/70 shadow-[0_1px_2px_rgba(23,33,43,0.05)] backdrop-blur-sm transition-colors hover:border-edge/90 dark:bg-white/[0.04]">
          <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span className="font-mono text-tiny font-semibold uppercase tracking-label text-ink/60">NASA PSI evidence</span>
            <span className="rounded-full border border-edge/70 bg-bg/70 px-2 py-0.5 font-mono text-micro text-ink/55">{turn.evidence.length} {turn.evidence.length === 1 ? 'run' : 'runs'}</span>
            <span aria-hidden="true" className="ml-auto text-ink/45 transition-transform duration-300 group-open:rotate-180">⌄</span>
          </summary>
          <ul className="mb-1 mt-2 space-y-1.5 border-t border-edge/50 pl-1 pt-2.5 font-mono text-[13px]">
            {turn.evidence.map((item, i) => (
              <li key={`${item.accession}-${item.runId ?? i}-${i}`}>
                {item.sourceUrl ? <a className="text-link underline decoration-link/30 underline-offset-2 transition-colors hover:decoration-link" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.accession} · {item.fuel} · {item.outcome}</a> : `${item.accession} · ${item.fuel} · ${item.outcome}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      {turn.run && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent/[0.07] px-4 py-3 shadow-[0_1px_2px_rgba(73,184,214,0.12)]">
          <div className="min-w-0 flex-1 font-mono text-[13px] text-ink/75">
            Run queued{turn.run.presetId ? ` · ${turn.run.presetId}` : ''}
            {turn.run.o2Pct != null ? ` · O₂ ${turn.run.o2Pct}%` : ''}
            {turn.run.flowCms != null ? ` · ${turn.run.flowCms} cm/s` : ''}
          </div>
          <a
            href="#dashboard-reports"
            className="flex-none rounded-full bg-ink px-4 py-2 font-mono text-xs font-semibold lowercase tracking-micro text-bg shadow-sm transition-all hover:-translate-y-px hover:bg-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            view dashboards →
          </a>
        </div>
      )}
    </div>
  )
}
