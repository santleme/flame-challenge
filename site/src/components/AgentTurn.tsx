import type { AgentTurnModel } from '../lib/simConsole'
import SimRunCard from './SimRunCard'

export default function AgentTurn({
  turn,
  live,
}: {
  turn: AgentTurnModel
  live: boolean
}) {
  if (turn.pending) {
    return (
      <div className="flex items-center gap-2.5 py-1 text-ink/60">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        <span className="text-body">Ignis is thinking…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-micro text-ink/45">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <span className="font-semibold uppercase tracking-wide">Ignis</span>
        {turn.ms != null && <span>· worked {(turn.ms / 1000).toFixed(1)}s</span>}
        {turn.mode && <span>· {turn.mode}</span>}
      </div>

      {turn.tools.length > 0 && (
        <div className="divide-y divide-edge/50 overflow-hidden rounded-xl border border-edge/70 bg-white/50 dark:bg-white/[0.03]">
          {turn.tools.map((t, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3.5 py-2">
              <span className="text-[10px] text-accent">▸</span>
              <span className="font-mono text-tiny text-ink/90">{t.name}</span>
              {t.arg && (
                <span className="truncate font-mono text-micro text-ink/45">{t.arg}</span>
              )}
              <span
                className={`ml-auto flex-none font-mono text-micro ${
                  t.live ? 'text-accent' : 'text-ink/40'
                }`}
              >
                {t.live ? 'running…' : 'done'}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="m-0 text-body leading-copy text-ink/90">{turn.briefing}</p>
      {turn.action && (
        <p className="m-0 text-tiny leading-relaxed text-ink/55">→ {turn.action}</p>
      )}

      {turn.run && <SimRunCard run={turn.run} live={live} />}
    </div>
  )
}
