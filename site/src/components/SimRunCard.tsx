import { useEffect, useState } from 'react'
import type { ChamberState } from '../lib/live'
import { runOutcome, type RunRequest } from '../lib/simConsole'
import LiveChamber from './LiveChamber'

/**
 * A run inside an agent turn. While `live`, the card hosts the real
 * LiveChamber (it applies ignis:ui-command retunes itself); once a newer
 * run supersedes it the card freezes into a stat summary of the last
 * frame it saw on ignis:sim-frame.
 */
export default function SimRunCard({
  run,
  live,
}: {
  run: RunRequest
  live: boolean
}) {
  const [lastFrame, setLastFrame] = useState<ChamberState | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!live) return
    const onFrame = (e: Event) =>
      setLastFrame((e as CustomEvent<ChamberState>).detail ?? null)
    const onComplete = (e: Event) => {
      setLastFrame((e as CustomEvent<ChamberState>).detail ?? null)
      setDone(true)
    }
    window.addEventListener('ignis:sim-frame', onFrame)
    window.addEventListener('ignis:chamber-complete', onComplete)
    return () => {
      window.removeEventListener('ignis:sim-frame', onFrame)
      window.removeEventListener('ignis:chamber-complete', onComplete)
    }
  }, [live])

  if (live) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-edge p-3 sm:p-4">
        <LiveChamber stage autoBoot={false} />
        {done && lastFrame && (
          <span className="absolute right-3 top-10 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 font-mono text-micro uppercase tracking-label text-emerald-600 backdrop-blur dark:text-emerald-300">
            {runOutcome(lastFrame)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-edge bg-ink/[0.03] px-4 py-3 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-tiny text-ink/70">
        <span className="font-semibold">{run.presetId ?? 'chamber run'}</span>
        {lastFrame ? (
          <>
            <span>t {lastFrame.tSec.toFixed(1)}s</span>
            <span>o₂ {lastFrame.o2Pct.toFixed(1)}%</span>
            {lastFrame.spreadRateCms != null && (
              <span>{lastFrame.spreadRateCms.toFixed(2)} cm/s</span>
            )}
            {lastFrame.heatReleaseW != null && (
              <span>{lastFrame.heatReleaseW.toFixed(2)} w</span>
            )}
          </>
        ) : (
          <span className="opacity-60">run superseded</span>
        )}
        <span className="ml-auto rounded-full border border-edge px-2.5 py-0.5 text-micro uppercase tracking-label">
          {lastFrame ? runOutcome(lastFrame) : 'done'}
        </span>
      </div>
    </div>
  )
}
