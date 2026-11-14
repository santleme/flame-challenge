import { useState } from 'react'
import { ChevronDown, ChevronUp, EyeOff, Flame, Gauge, RotateCcw, Wind } from 'lucide-react'
import type { Engine } from '../game/engine'
import { riskIndexLocal, riskMaterials } from '../sim-bridge/risk'
import { roomAt } from '../game/fire'
import { useGameVersion } from '../state/store'
import type { DashConditions, EnvKey } from '../types'

const GRAVITY_FOR_ENV: Record<EnvKey, string> = {
  microgravity: 'microgravity',
  lunar: 'lunar',
  martian: 'martian',
  historical: 'microgravity',
  earth: 'earth',
}

const LEVEL_CLS: Record<string, string> = {
  minimal: 'bg-edge text-mist',
  low: 'bg-ice/15 text-ice',
  moderate: 'bg-ember/15 text-ember',
  high: 'bg-orange-500/20 text-orange-300',
  critical: 'bg-red-500/20 text-red-400',
}

interface Props {
  engine: Engine
  cond: DashConditions
  onCond: (patch: Partial<DashConditions>) => void
}

/**
 * Pillar 1 — the live risk ranking. Materials of the NASA PSI flammability
 * matrix re-order in real time as the cabin O₂ / ventilation dials move;
 * modules with running experiments or active fires surface on top.
 */
export default function RiskBoard({ engine, cond, onCond }: Props) {
  useGameVersion()
  const [open, setOpen] = useState(true)
  const st = engine.state
  const gravity = GRAVITY_FOR_ENV[cond.env]

  const ranked = riskMaterials()
    .map((m) => ({ m, r: riskIndexLocal(m.id, cond.o2Pct, cond.flowCms, gravity) }))
    .sort((a, b) => b.r.riskIndex - a.r.riskIndex)

  // module watchlist: bucket fires by room in one pass (was rooms × fires)
  const fireFlag = new Map<number, { burning: boolean; smoldering: boolean }>()
  for (const f of st.fires.values()) {
    const room = roomAt(st, f.x, f.y)
    if (!room) continue
    const fl = fireFlag.get(room.id) ?? { burning: false, smoldering: false }
    if (f.dormant <= 0 && !f.hidden) fl.burning = true
    else fl.smoldering = true
    fireFlag.set(room.id, fl)
  }
  const watch = st.rooms
    .map((room) => {
      const fl = fireFlag.get(room.id)
      const exp = room.experiment
      return {
        room,
        burning: fl?.burning ?? false,
        smoldering: fl?.smoldering ?? false,
        risk: exp?.state === 'running' ? exp.riskPct : 0,
      }
    })
    .filter((w) => w.burning || w.smoldering || w.risk > 0)
    .sort((a, b) => Number(b.burning) - Number(a.burning) || b.risk - a.risk)

  const top = ranked[0]

  return (
    <div className="pointer-events-auto absolute left-2 top-2 w-64 rounded border border-edge bg-panel/90 backdrop-blur">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 border-b border-edge px-2.5 py-1.5 text-left"
      >
        <Gauge className="h-3.5 w-3.5 text-ember" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-white">
          Risk ranking
        </span>
        <span className="ml-auto font-mono text-[9px] text-mist">risk = P·F·H·G</span>
        {open ? <ChevronUp className="h-3 w-3 text-mist" /> : <ChevronDown className="h-3 w-3 text-mist" />}
      </button>

      {open && (
        <div className="max-h-[52vh] overflow-y-auto px-2.5 py-2 hud-scroll">
          {/* cabin condition dials */}
          <div className="rounded border border-edge bg-panel2 p-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-mist">Cabin O₂</span>
              <span className="font-mono font-bold text-white">{cond.o2Pct.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={8}
              max={40}
              step={0.5}
              value={cond.o2Pct}
              onChange={(e) => onCond({ o2Pct: Number(e.target.value) })}
              className="mt-1 w-full accent-flame"
            />
            <div className="mt-1.5 flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-mist">
                <Wind className="h-3 w-3" /> Ventilation
              </span>
              <span className="font-mono font-bold text-white">{cond.flowCms.toFixed(0)} cm/s</span>
            </div>
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={cond.flowCms}
              onChange={(e) => onCond({ flowCms: Number(e.target.value) })}
              className="mt-1 w-full accent-ice"
            />
          </div>

          {/* module watchlist */}
          {watch.length > 0 && (
            <>
              <p className="mb-1 mt-2 text-[9px] font-semibold uppercase tracking-widest text-mist">
                module watch
              </p>
              <div className="space-y-1">
                {watch.slice(0, 4).map(({ room, burning, smoldering, risk }) => (
                  <div
                    key={room.id}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] ${
                      burning ? 'border-red-500/50 bg-red-500/10' : 'border-edge bg-panel2'
                    }`}
                  >
                    {(burning || smoldering) && <Flame className="h-3 w-3 shrink-0 text-red-400" />}
                    <span className="truncate font-semibold text-white/90">{room.label}</span>
                    <span className="ml-auto font-mono text-[9px] text-mist">
                      {burning ? 'BURNING' : smoldering ? 'SMOLDER' : `${risk}%`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* material ranking */}
          <p className="mb-1 mt-2 text-[9px] font-semibold uppercase tracking-widest text-mist">
            NASA PSI materials · {gravity === 'microgravity' ? 'µg' : gravity}
          </p>
          <div className="space-y-0.5">
            {ranked.map(({ m, r }, i) => (
              <div
                key={m.id}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${
                  i === 0 ? 'bg-ember/10 ring-1 ring-ember/40' : 'hover:bg-panel2'
                }`}
              >
                <span className="w-4 text-right font-mono text-[9px] text-mist">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-white/90">{m.name}</span>
                {r.flags.coolFlameCapable && <EyeOff className="h-3 w-3 shrink-0 text-ice" />}
                {r.flags.smoldering && <RotateCcw className="h-3 w-3 shrink-0 text-ember" />}
                <span className={`rounded px-1 py-px font-mono text-[8.5px] ${LEVEL_CLS[r.level]}`}>
                  {(r.riskIndex * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>

          {top && (
            <p className="mt-2 rounded bg-panel2 p-1.5 font-mono text-[8.5px] leading-snug text-mist">
              #{`1`} {top.m.name}: P<sub>ign</sub> {top.r.breakdown.ignitionPressure} × F
              <sub>flow</sub> {top.r.breakdown.flowFactor} × H {top.r.breakdown.hiddenFactor} × G{' '}
              {top.r.breakdown.gravityFactor} → {(top.r.riskIndex * 100).toFixed(0)}%
            </p>
          )}
          <p className="mt-1 text-[8.5px] text-mist/70">
            risk_model.json · C++-calibrated fit (mirror of /api/risk)
          </p>
        </div>
      )}
    </div>
  )
}
