import { useEffect, useState } from 'react'
import { Cpu, ExternalLink, EyeOff, Flame, FlaskConical, RotateCcw, ShieldAlert, X } from 'lucide-react'
import type { Engine } from '../game/engine'
import { investigations } from '../game/engine'
import { flowRange, limitingO2, o2Range, specFor } from '../game/experiments'
import { gravityContrast } from '../game/telemetry'
import { previewExperiment } from '../sim-bridge/physics'
import type { RiskAxis } from '../game/types'
import type { Investigation } from '../types'

interface Props {
  engine: Engine
  roomId: number
  onClose: () => void
}

const HAZARD_SHORT: Record<string, string> = {
  'low-oxygen-persistence': 'persists at low O₂',
  'cool-flames': 'cool flames',
  'smolder-risk': 're-ignition risk',
  'toxic-aerosol': 'toxic aerosol',
  'large-scale-spread': 'large-scale spread',
  'detection-gap': 'detection gap',
  'exploration-atmosphere': 'exploration atm.',
  'partial-gravity': 'partial-g',
}

const FACTOR_LABEL: Record<RiskAxis, { label: string; hint: string }> = {
  ignition: { label: 'Ignition', hint: 'drop O₂ toward the LOC' },
  propagation: { label: 'Propagation', hint: 'cut forced flow' },
  detection: { label: 'Detection gap', hint: 'post a sensor watch — hidden flames' },
  persistence: { label: 'Persistence', hint: 'expect re-ignition after knock-down' },
}

export default function ExperimentModal({ engine, roomId, onClose }: Props) {
  const [inv, setInv] = useState<Investigation>(investigations[0])
  const range = o2Range(inv)
  const fRange = flowRange(inv)
  const [o2, setO2] = useState<number>(() => Math.min(range[1], Math.max(range[0], 21)))
  const [flow, setFlow] = useState<number>(0)
  const [physics, setPhysics] = useState<'c++' | 'local'>('local')
  // preview pressure is bound to the exact inputs that produced it — a
  // preview for other settings must never feed specFor or startExperiment
  const [preview, setPreview] = useState<
    { invId: string; o2: number; flow: number; pressure: number } | undefined
  >(undefined)
  const loc = limitingO2(inv)

  // live risk from the C++ core when the backend is up (local model otherwise)
  // — debounced so slider drags don't queue a request per step
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      previewExperiment(inv, o2, flow)
        .then((p) => {
          if (!live) return
          setPhysics(p.engine)
          setPreview({ invId: inv.id, o2, flow, pressure: p.ignitionPressure })
        })
        .catch(() => {
          // a failed preview must not surface as an unhandled rejection or
          // leave a stale pressure bound — fall back to the local model
          if (!live) return
          setPhysics('local')
          setPreview(undefined)
        })
    }, 180)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [inv, o2, flow])

  const pressure =
    preview && preview.invId === inv.id && preview.o2 === o2 && preview.flow === flow
      ? preview.pressure
      : undefined
  const spec = specFor(inv, o2, flow, pressure)

  const pick = (i: Investigation) => {
    setInv(i)
    const r = o2Range(i)
    setO2(Math.min(r[1], Math.max(r[0], 21)))
    setFlow(flowRange(i)[0])
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-void/70 backdrop-blur-sm">
      <div className="flex h-[78%] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-flame" />
            <span className="text-sm font-bold tracking-wide text-white">Run Combustion Experiment</span>
            <span className="rounded bg-ice/10 px-2 py-0.5 text-[10px] text-ice">
              records: NASA Physical Sciences Informatics
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-semibold uppercase ${
                physics === 'c++' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-edge/70 text-mist'
              }`}
              title={physics === 'c++' ? 'Risk computed by the compiled C++ engine' : 'Backend offline — local physics model'}
            >
              <Cpu className="h-3 w-3" />
              {physics === 'c++' ? 'C++ core' : 'local model'}
            </span>
            <button onClick={onClose} className="text-mist hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* investigation list */}
          <div className="hud-scroll w-[46%] space-y-1.5 overflow-y-auto border-r border-edge p-2.5">
            {investigations.map((i) => (
              <button
                key={i.id}
                onClick={() => pick(i)}
                className={`w-full rounded border p-2 text-left transition-colors ${
                  inv.id === i.id ? 'border-flame bg-flame/10' : 'border-edge bg-panel2 hover:border-mist'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-white">{i.name}</span>
                  <span className="text-[9px] uppercase text-mist">{i.category}</span>
                </div>
                <div className="mt-0.5 line-clamp-1 text-[10px] text-mist">
                  {i.platform}
                  {i.facility ? ` · ${i.facility}` : ''} · {i.years}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {i.hazards.slice(0, 3).map((h) => (
                    <span key={h} className="rounded bg-edge/70 px-1 py-px text-[9px] text-mist">
                      {HAZARD_SHORT[h] ?? h}
                    </span>
                  ))}
                  {i.metrics.coolFlameObserved && (
                    <span className="flex items-center gap-0.5 rounded bg-ice/10 px-1 py-px text-[9px] text-ice">
                      <EyeOff className="h-2.5 w-2.5" /> cool flame
                    </span>
                  )}
                  {i.metrics.smolderObserved && (
                    <span className="flex items-center gap-0.5 rounded bg-ember/10 px-1 py-px text-[9px] text-ember">
                      <RotateCcw className="h-2.5 w-2.5" /> smolder
                    </span>
                  )}
                  {!i.verified && (
                    <span className="rounded bg-edge/70 px-1 py-px text-[9px] italic text-mist">unverified</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* detail + dial */}
          <div className="hud-scroll flex flex-1 flex-col overflow-y-auto p-4">
            <div className="text-[13px] font-semibold text-white">{inv.title}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-mist">
              {inv.agencies.join(' + ')} · {inv.fuels.join(', ')}
              {inv.conditions.pressureKpa ? ` · ${inv.conditions.pressureKpa} kPa` : ''}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="limiting O₂" value={inv.metrics.limitingOxygenPct != null ? `${inv.metrics.limitingOxygenPct}%` : '—'} />
              <Metric
                label="flame spread"
                value={
                  inv.metrics.flameSpreadRateCms
                    ? `${inv.metrics.flameSpreadRateCms.min}–${inv.metrics.flameSpreadRateCms.max} cm/s`
                    : '—'
                }
              />
              <Metric label="data" value={inv.data.availability} />
            </div>

            {/* O2 dial */}
            <div className="mt-4 rounded border border-edge bg-panel2 p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-mist">Test atmosphere — oxygen fraction</span>
                <span className="font-mono text-[13px] font-bold text-white">{o2.toFixed(1)}% O₂</span>
              </div>
              <input
                type="range"
                min={range[0]}
                max={range[1]}
                step={0.5}
                value={o2}
                onChange={(e) => setO2(Number(e.target.value))}
                className="mt-2 w-full accent-flame"
              />
              <div className="flex justify-between font-mono text-[9px] text-mist">
                <span>{range[0]}%</span>
                <span className="text-ember">LOC {loc}%</span>
                <span>{range[1]}%</span>
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-mist">
                Pushing O₂ above the limiting concentration yields richer data — and a sharply
                higher ignition probability. In microgravity, flames can persist below Earth LOC.
              </p>
            </div>

            {/* forced-flow dial — SAFFIRE ventilation vector */}
            <div className="mt-2 rounded border border-edge bg-panel2 p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-mist">Forced flow (ventilation)</span>
                <span className="font-mono text-[13px] font-bold text-white">{flow.toFixed(1)} cm/s</span>
              </div>
              <input
                type="range"
                min={fRange[0]}
                max={fRange[1]}
                step={0.5}
                value={flow}
                onChange={(e) => setFlow(Number(e.target.value))}
                className="mt-2 w-full accent-ice"
              />
              <div className="flex justify-between font-mono text-[9px] text-mist">
                <span>{fRange[0]} cm/s</span>
                <span>{fRange[1]} cm/s</span>
              </div>
            </div>

            {/* risk decomposition */}
            <div className="mt-2 rounded border border-edge bg-panel2 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[10px]">
                <span className="uppercase tracking-wide text-mist">risk decomposition</span>
                <span className="text-ember">
                  dominant: {FACTOR_LABEL[spec.dominant].label} — {FACTOR_LABEL[spec.dominant].hint}
                </span>
              </div>
              <div className="space-y-1">
                {(Object.keys(spec.factors) as RiskAxis[]).map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className={`w-24 text-[10px] ${k === spec.dominant ? 'font-semibold text-ember' : 'text-mist'}`}>
                      {FACTOR_LABEL[k].label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
                      <div
                        className={`h-full rounded-full ${k === spec.dominant ? 'bg-ember' : 'bg-mist/60'}`}
                        style={{ width: `${spec.factors[k]}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-[10px] text-mist">{spec.factors[k]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* comparative telemetry — Earth 1 g vs microgravity */}
            <div className="mt-2 rounded border border-ice/25 bg-ice/5 p-3">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-ice">
                Telemetry — Earth 1 g vs µg (PSI)
              </div>
              <div className="mt-1.5 space-y-1 text-[10px] leading-snug">
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 font-mono text-mist">Earth 1 g</span>
                  <span className="text-white/80">{gravityContrast(inv).earth}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 font-mono text-ice">Space µg</span>
                  <span className="text-white/80">{gravityContrast(inv).space}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 rounded border border-edge bg-panel2 p-2.5 text-center">
                <div className="text-[9px] uppercase tracking-wide text-mist">ignition risk</div>
                <div
                  className={`font-mono text-xl font-bold ${
                    spec.riskPct > 50 ? 'text-red-400' : spec.riskPct > 25 ? 'text-ember' : 'text-emerald-400'
                  }`}
                >
                  {spec.riskPct}%
                </div>
              </div>
              <div className="flex-1 rounded border border-edge bg-panel2 p-2.5 text-center">
                <div className="text-[9px] uppercase tracking-wide text-mist">expected yield</div>
                <div className="font-mono text-xl font-bold text-ice">+{spec.scienceYield} sci</div>
              </div>
            </div>

            {inv.metrics.coolFlameObserved && (
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ice">
                <EyeOff className="h-3 w-3" /> Failure may ignite undetected cool flames — watch the chamber.
              </div>
            )}

            <div className="mt-auto pt-3">
              <button
                onClick={() => {
                  if (engine.startExperiment(roomId, inv.id, o2, flow, pressure)) onClose()
                }}
                className="flex w-full items-center justify-center gap-2 rounded bg-flame py-2 text-[13px] font-bold text-white hover:bg-flame/85"
              >
                <Flame className="h-4 w-4" /> Ignite — {inv.name} @ {o2.toFixed(1)}% O₂ · {flow.toFixed(1)} cm/s
              </button>
              {inv.data.psiUrl && (
                <a
                  href={inv.data.psiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-ice/70 hover:text-ice"
                >
                  <ExternalLink className="h-3 w-3" /> PSI record
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-t border-edge px-4 py-1.5 text-[9px] text-mist">
          <ShieldAlert className="h-3 w-3" />
          Incident physics (spread rate, hidden combustion, re-ignition) derive from each
          investigation&apos;s published metrics.
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-edge bg-panel2 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-mist">{label}</div>
      <div className="font-mono text-[12px] font-semibold text-white">{value}</div>
    </div>
  )
}
