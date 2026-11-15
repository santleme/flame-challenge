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
      <div className="flex items-center gap-3 py-1 text-ink/70">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
        <span className="text-body lowercase">ignis is thinking…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-label text-ink/55">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        <span>ignis</span>
        {turn.ms != null && (
          <span className="normal-case tracking-normal">
            · worked {(turn.ms / 1000).toFixed(1)}s
          </span>
        )}
        {turn.mode && (
          <span className="normal-case tracking-normal opacity-80">· {turn.mode}</span>
        )}
      </div>

      {turn.tools.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-edge bg-white/50 backdrop-blur-sm dark:bg-white/[0.03]">
          {turn.tools.map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 border-b border-edge/60 px-3.5 py-2 last:border-0"
            >
              <span className="flex h-4 w-4 flex-none items-center justify-center rounded bg-ink/5 font-mono text-micro text-accent">
                ▸
              </span>
              <span className="font-mono text-tiny text-ink">{t.name}</span>
              {t.arg && (
                <span className="truncate font-mono text-micro text-ink/50">{t.arg}</span>
              )}
              <span
                className={`ml-auto flex-none font-mono text-micro font-semibold ${
                  t.live ? 'text-accent' : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {t.live ? '● live' : '✓'}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="m-0 text-body leading-copy text-ink/85">{turn.briefing}</p>
      {turn.action && (
        <p className="m-0 text-tiny leading-relaxed text-ink/60">→ {turn.action}</p>
      )}

      {turn.run && <SimRunCard run={turn.run} live={live} />}
    </div>
  )
}
