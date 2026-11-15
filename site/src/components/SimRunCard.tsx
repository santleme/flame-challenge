import { useEffect, useState } from 'react'
import type { ChamberState } from '../lib/live'
import { runOutcome, type RunRequest } from '../lib/simConsole'
import LiveChamber from './LiveChamber'

/**
 * A run inside an agent turn — a bare LiveChamber canvas wrapped in the
 * card's own chrome (preset + status + stats). Once a newer run
 * supersedes it, the card freezes into a one-line summary of the last
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
  const [failed, setFailed] = useState<'offline' | 'rejected' | null>(null)

  useEffect(() => {
    if (!live) return
    const onFrame = (e: Event) =>
      setLastFrame((e as CustomEvent<ChamberState>).detail ?? null)
    const onComplete = (e: Event) => {
      setLastFrame((e as CustomEvent<ChamberState>).detail ?? null)
      setDone(true)
    }
    const onOffline = () => {
      setDone(true)
      setFailed('offline')
    }
    const onRejected = () => {
      setDone(true)
      setFailed('rejected')
    }
    window.addEventListener('ignis:sim-frame', onFrame)
    window.addEventListener('ignis:chamber-complete', onComplete)
    window.addEventListener('ignis:chamber-offline', onOffline)
    window.addEventListener('ignis:chamber-command-error', onRejected)
    return () => {
      window.removeEventListener('ignis:sim-frame', onFrame)
      window.removeEventListener('ignis:chamber-complete', onComplete)
      window.removeEventListener('ignis:chamber-offline', onOffline)
      window.removeEventListener('ignis:chamber-command-error', onRejected)
    }
  }, [live])

  if (!live) {
    return (
      <div className="rounded-xl border border-edge bg-ink/[0.03] px-4 py-3 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-tiny text-ink/70">
          <span className="font-semibold">{run.presetId ?? 'chamber run'}</span>
          {lastFrame ? (
            <>
              <span>t {lastFrame.tSec.toFixed(1)}s</span>
              <span>o₂ {lastFrame.o2Pct.toFixed(1)}%</span>
              {lastFrame.spreadRateCms != null && (
                <span>{lastFrame.spreadRateCms.toFixed(2)} cm/s</span>
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

  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-white/60 shadow-sm dark:bg-white/[0.03]">
      <div className="flex items-center justify-between border-b border-edge/60 px-4 py-2.5">
        <span className="font-mono text-micro uppercase tracking-label text-ink/55">
          chamber run · {run.presetId ?? 'custom'}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-micro uppercase tracking-label ${
            done
              ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border border-accent/40 bg-accent/10 text-accent'
          }`}
        >
          {done
            ? lastFrame
              ? runOutcome(lastFrame)
              : failed === 'rejected'
                ? 'run rejected'
                : 'engine offline'
            : '● live'}
        </span>
      </div>

      <div className="p-3">
        <LiveChamber bare autoBoot={false} />
      </div>

      {lastFrame && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-edge/60 px-4 py-2.5 font-mono text-micro lowercase text-ink/60">
          <span>t {lastFrame.tSec.toFixed(1)}s</span>
          <span>o₂ {lastFrame.o2Pct.toFixed(1)}%</span>
          {lastFrame.spreadRateCms != null && (
            <span>spread {lastFrame.spreadRateCms.toFixed(2)} cm/s</span>
          )}
          {lastFrame.frontPosCm != null && (
            <span>front {lastFrame.frontPosCm.toFixed(1)} cm</span>
          )}
          {lastFrame.heatReleaseW != null && (
            <span>{lastFrame.heatReleaseW.toFixed(2)} w</span>
          )}
          {lastFrame.coolFlame && (
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              cool flame
            </span>
          )}
        </div>
      )}
    </div>
  )
}
