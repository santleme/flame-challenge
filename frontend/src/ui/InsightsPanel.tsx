import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Flame,
  LineChart as LineChartIcon,
  Play,
  ShieldAlert,
  X,
} from 'lucide-react'
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getInvestigations } from '../lib/data'
import { buildInsights, rankInvestigations } from '../lib/insights'
import { INV_MATERIAL, injectTarget, MASTER_ROWS } from '../game/masterSheet'
import { limitingO2, o2Range } from '../game/experiments'
import { riskCurveLocal, riskIndexLocal } from '../sim-bridge/risk'
import type { DashConditions, EnvKey, Investigation, MasterRow, Severity } from '../types'

const GRAVITY_FOR_ENV: Record<EnvKey, string> = {
  microgravity: 'microgravity',
  lunar: 'lunar',
  martian: 'martian',
  historical: 'microgravity',
  earth: 'earth',
}

const SEV_CLS: Record<Severity, string> = {
  critical: 'border-red-500/60 bg-red-500/10 text-red-300',
  high: 'border-ember/60 bg-ember/10 text-ember',
  medium: 'border-ice/40 bg-ice/10 text-ice',
}

const AXIS_CLS = [
  ['flammability', 'bg-red-400'],
  ['hiddenHazard', 'bg-ember'],
  ['relevance', 'bg-ice'],
  ['dataRichness', 'bg-mist'],
] as const

interface Props {
  cond: DashConditions
  onClose: () => void
  onInject: (row: MasterRow) => void
}

/**
 * Pillar 3 — the interpreted dashboard the challenge brief asks for:
 * ranks every PSI investigation, summarizes what the data says, and
 * interprets it into plain-language fire-safety findings. All scoring is
 * computed live from the shared calibrated JSONs — works fully offline.
 */
export default function InsightsPanel({ cond, onClose, onInject }: Props) {
  const invs = useMemo(() => getInvestigations(), [])
  const ranked = useMemo(() => rankInvestigations(invs, cond), [invs, cond])
  const insights = useMemo(() => buildInsights(invs, ranked, cond), [invs, ranked, cond])
  const [selId, setSelId] = useState(ranked[0]?.inv.id ?? '')
  const sel = invs.find((i) => i.id === selId) ?? ranked[0]?.inv

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-void/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <div className="flex items-center gap-2">
            <LineChartIcon className="h-4 w-4 text-flame" />
            <span className="text-sm font-bold tracking-wide text-white">PSI INSIGHTS</span>
            <span className="font-mono text-[10px] text-mist">
              {invs.length} investigations ranked · {cond.o2Pct}% O₂ · {cond.flowCms} cm/s ·{' '}
              {GRAVITY_FOR_ENV[cond.env]}
            </span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-mist hover:bg-edge hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* auto-interpreted findings */}
        <div className="flex gap-2 overflow-x-auto border-b border-edge px-4 py-2 hud-scroll">
          {insights.map((ins) => (
            <div
              key={ins.id}
              className={`w-72 shrink-0 rounded border p-2 ${SEV_CLS[ins.severity]}`}
            >
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest">
                {ins.severity === 'critical' ? (
                  <ShieldAlert className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {ins.kind} · {ins.severity}
              </div>
              <p className="mt-1 text-[11px] font-semibold leading-snug text-white/90">{ins.title}</p>
              <p className="mt-0.5 text-[9.5px] leading-snug text-white/60">{ins.body}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {ins.sources.map((s) => (
                  <span key={s} className="rounded bg-edge/70 px-1 py-px text-[8px] text-mist">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ranked list — the "ranks" pillar */}
          <div className="w-[340px] shrink-0 overflow-y-auto border-r border-edge hud-scroll">
            <div className="sticky top-0 border-b border-edge bg-panel2 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-mist">
              rank · investigation · score = .35F + .30H + .20R + .15D
            </div>
            {ranked.map((r) => {
              const active = r.inv.id === selId
              return (
                <button
                  key={r.inv.id}
                  onClick={() => setSelId(r.inv.id)}
                  className={`block w-full border-b border-edge/50 px-3 py-2 text-left ${
                    active ? 'bg-flame/10 ring-1 ring-inset ring-flame/40' : 'hover:bg-panel2'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[11px] font-bold text-mist">#{r.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-white">
                      {r.inv.name}
                    </span>
                    {r.inv.verified && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />}
                    <span className="font-mono text-[11px] font-bold text-flame">{r.score.total}</span>
                  </div>
                  <div className="ml-8 mt-1 flex h-1.5 overflow-hidden rounded-full bg-edge">
                    {AXIS_CLS.map(([k, cls]) => (
                      <div
                        key={k}
                        className={cls}
                        style={{ width: `${(r.score[k] * scoreWeight(k)) / 1}%`, opacity: 0.85 }}
                      />
                    ))}
                  </div>
                  <p className="ml-8 mt-1 truncate text-[9px] italic text-mist">{r.summary}</p>
                </button>
              )
            })}
          </div>

          {/* detail — summarize + interpret */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4 hud-scroll">
            {sel && <Detail inv={sel} cond={cond} onInject={onInject} />}
          </div>
        </div>

        <div className="border-t border-edge px-4 py-1.5 text-[9px] text-mist">
          Scores recompute with the cabin dials (RiskBoard) — F flammability · H hidden-hazard ·
          R exploration relevance · D data richness. Verified ✓ = record merged from parsed PSI
          per-test runs; everything else is a curated literature value.
        </div>
      </div>
    </div>
  )
}

function scoreWeight(k: string): number {
  return { flammability: 0.35, hiddenHazard: 0.3, relevance: 0.2, dataRichness: 0.15 }[k] ?? 0
}

function Detail({
  inv,
  cond,
  onInject,
}: {
  inv: Investigation
  cond: DashConditions
  onInject: (row: MasterRow) => void
}) {
  const gravity = GRAVITY_FOR_ENV[cond.env]
  const matId = INV_MATERIAL[inv.id]
  const loc = limitingO2(inv)
  const curve = useMemo(
    () => (matId ? riskCurveLocal(matId, cond.flowCms, gravity) : []),
    [matId, cond.flowCms, gravity],
  )
  const now = matId ? riskIndexLocal(matId, cond.o2Pct, cond.flowCms, gravity) : null
  const runs = MASTER_ROWS.filter(
    (r) => r.record_type === 'experiment_run' && r.investigation_id === inv.id,
  ).slice(0, 8)

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-bold text-white">{inv.name}</h3>
        <span className="text-[10px] text-mist">
          {inv.title} · {inv.agencies.join('/')} · {inv.platform} · {inv.years}
        </span>
        {inv.data.psiUrl && (
          <a
            href={inv.data.psiUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-0.5 font-mono text-[9.5px] text-ice hover:underline"
          >
            psi.nasa.gov <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      {/* key numbers */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Stat label="LOC" value={`${loc}% O₂`} sub={matId ? `via ${matId}` : 'dataset range'} />
        <Stat
          label="risk now"
          value={now ? `${(now.riskIndex * 100).toFixed(0)}%` : '—'}
          sub={now ? `${now.level} · ${now.materialName}` : 'no engine material'}
          tone={now && now.riskIndex >= 0.5 ? 'text-red-400' : undefined}
        />
        <Stat
          label="PSI runs"
          value={inv.psiRuns !== undefined ? String(inv.psiRuns) : '—'}
          sub={inv.verified ? 'parsed & verified' : 'not yet ingested'}
        />
        <Stat
          label="O₂ envelope"
          value={
            inv.psiO2RangePct || inv.conditions.oxygenPct
              ? `${o2Range(inv)[0]}–${o2Range(inv)[1]}%`
              : '—'
          }
          sub={
            (inv.psiO2RangePct ? 'parsed PSI runs' : 'curated range') +
            (inv.metrics.coolFlameObserved ? ' · cool flame observed' : ' · hot-flame regime')
          }
        />
      </div>

      {/* risk curve */}
      {curve.length > 0 && (
        <div className="mt-3 rounded border border-edge bg-panel2 p-2">
          <div className="mb-1 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-widest text-mist">
            <Flame className="h-3 w-3 text-ember" />
            risk index vs cabin O₂ — {now?.materialName} @ {cond.flowCms} cm/s
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={curve} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <XAxis
                dataKey="o2Pct"
                stroke="#8b9db5"
                fontSize={9}
                tickLine={false}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis
                stroke="#8b9db5"
                fontSize={9}
                tickLine={false}
                domain={[0, 1]}
                tickFormatter={(v: number) => `${v * 100}%`}
              />
              <Tooltip
                contentStyle={{
                  background: '#0b1220',
                  border: '1px solid #233148',
                  fontSize: 10,
                }}
                formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, 'risk']}
                labelFormatter={(v) => `${v}% O₂`}
              />
              <ReferenceLine
                x={loc}
                stroke="#f5a524"
                strokeDasharray="4 3"
                label={{ value: `LOC ${loc}%`, fill: '#f5a524', fontSize: 8, position: 'insideTopRight' }}
              />
              <ReferenceLine
                x={cond.o2Pct}
                stroke="#e5484d"
                strokeDasharray="4 3"
                label={{ value: `cabin ${cond.o2Pct}%`, fill: '#e5484d', fontSize: 8, position: 'insideTopLeft' }}
              />
              <Line
                type="monotone"
                dataKey="riskIndex"
                stroke="#ff6b35"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* findings + implications — the "interprets" pillar */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-mist">
            key findings (dataset)
          </p>
          <ul className="mt-1 space-y-1">
            {inv.keyFindings.slice(0, 4).map((f) => (
              <li key={f} className="text-[10.5px] leading-snug text-white/85">
                · {f}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-mist">
            exploration safety implications
          </p>
          <ul className="mt-1 space-y-1">
            {inv.safetyImplications.slice(0, 4).map((f) => (
              <li key={f} className="text-[10.5px] leading-snug text-ember/90">
                · {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* auditable source runs */}
      {runs.length > 0 && (
        <div className="mt-3">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-mist">
            parsed PSI test runs — click to inject into the yard
          </p>
          <div className="mt-1 space-y-0.5">
            {runs.map((r) => {
              const tgt = injectTarget(r)
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded border border-edge/60 bg-panel2 px-2 py-1 text-[10px]"
                >
                  <span className="font-mono text-[9px] text-mist">{r.id}</span>
                  <span className="min-w-0 flex-1 truncate text-white/80">{r.name}</span>
                  <span className="font-mono text-[9px] text-mist">
                    {r.o2_pct ? `${r.o2_pct}% O₂` : ''} {r.outcome ?? ''}
                  </span>
                  {r.verified === 'true' && (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                  )}
                  {tgt && (
                    <button
                      onClick={() => onInject(r)}
                      className="flex items-center gap-1 rounded bg-flame/15 px-1.5 py-0.5 text-[9px] font-bold text-flame hover:bg-flame/30"
                    >
                      <Play className="h-2.5 w-2.5" /> Inject
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {inv.hazards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {inv.hazards.map((h) => (
            <span
              key={h}
              className="rounded-full border border-edge px-2 py-px text-[9px] text-mist"
            >
              {h}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: string
}) {
  return (
    <div className="rounded border border-edge bg-panel2 p-2">
      <div className="text-[8.5px] uppercase tracking-widest text-mist">{label}</div>
      <div className={`font-mono text-[14px] font-bold ${tone ?? 'text-white'}`}>{value}</div>
      <div className="truncate text-[8.5px] text-mist" title={sub}>
        {sub}
      </div>
    </div>
  )
}
