import { AlertTriangle, Flame, Info, ScrollText, Sparkles } from 'lucide-react'
import type { Engine } from '../game/engine'
import { useGameSelector } from '../state/store'
import type { EventKind } from '../game/types'

const STYLE: Record<EventKind, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: 'text-mist' },
  warn: { icon: AlertTriangle, cls: 'text-ember' },
  danger: { icon: Flame, cls: 'text-red-400' },
  science: { icon: Sparkles, cls: 'text-ice' },
  success: { icon: Sparkles, cls: 'text-emerald-400' },
}

function fmtT(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function EventFeed({ engine }: { engine: Engine }) {
  // re-render only when a new event lands (top id changes), not every tick
  useGameSelector((s) => s.events[0]?.id ?? 0)
  return (
    <div className="pointer-events-auto flex max-h-56 w-80 flex-col rounded border border-edge bg-panel/85 backdrop-blur">
      <div className="flex items-center gap-1.5 border-b border-edge px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-mist">
        <ScrollText className="h-3 w-3" /> Mission log
      </div>
      <div className="hud-scroll flex-1 overflow-y-auto px-2 py-1">
        {engine.state.events.map((e) => {
          const { icon: Icon, cls } = STYLE[e.kind]
          return (
            <div key={e.id} className="flex gap-1.5 py-0.5 text-[11px] leading-snug">
              <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${cls}`} />
              <div>
                <span className="mr-1 font-mono text-[9px] text-mist">{fmtT(e.t)}</span>
                <span className="text-white/90">{e.text}</span>
                {e.ref && <span className="ml-1 text-[9px] italic text-ice/70">[{e.ref}]</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
