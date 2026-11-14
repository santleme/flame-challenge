import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, History, Play } from 'lucide-react'
import { decisionScore } from '../game/decisions'
import { PRESETS } from '../game/presets'
import { fetchDecisionCards, localDecisionCards } from '../sim-bridge/decisions'
import { riskIndexLocal, riskMaterials } from '../sim-bridge/risk'
import type {
  DashConditions,
  DecisionCardsPayload,
  EnvKey,
  NeighborRef,
} from '../types'

const ENVS: { key: EnvKey; label: string; short: string }[] = [
  { key: 'microgravity', label: 'ISS Microgravity (0g)', short: '0g' },
  { key: 'lunar', label: 'Lunar Gateway (⅙g)', short: '⅙g' },
  { key: 'martian', label: 'Mars Transit', short: '0.38g' },
  { key: 'historical', label: 'Historical Crises', short: 'Apollo / Mir' },
  { key: 'earth', label: 'Earth Baseline (1g)', short: '1g' },
]

const GRAVITY_FOR_ENV: Record<EnvKey, string> = {
  microgravity: 'microgravity',
  lunar: 'lunar',
  martian: 'martian',
  historical: 'microgravity',
  earth: 'earth',
}

const ENV_FOR_GRAVITY: Record<string, EnvKey> = {
  microgravity: 'microgravity',
  'partial-gravity': 'lunar',
  lunar: 'lunar',
  martian: 'martian',
  earth: 'earth',
}

/** the material the cards should advise on — the RiskBoard's #1 threat
 *  under the current cabin dials */
function topMaterialId(cond: DashConditions): string {
  const g = GRAVITY_FOR_ENV[cond.env]
  let best = 'pmma'
  let hi = -1
  for (const m of riskMaterials()) {
    const r = riskIndexLocal(m.id, cond.o2Pct, cond.flowCms, g).riskIndex
    if (r > hi) {
      hi = r
      best = m.id
    }
  }
  return best
}

interface Props {
  cond: DashConditions
  onCond: (patch: Partial<DashConditions>) => void
  onApply: (presetId: string, patch: Partial<DashConditions>, action?: string) => void
}

/**
 * "What could you simulate?" — environment pills + decision cards whose
 * option bars are scored by the SI layer. Online, the backend tactics
 * engine returns counterfactual scores + KNN evidence chips; offline the
 * static deck is scored by the local risk mirror.
 */
export default function SimulateBar({ cond, onCond, onApply }: Props) {
  const [open, setOpen] = useState(true)
  const [live, setLive] = useState<DecisionCardsPayload | null>(null)

  const topMat = useMemo(() => topMaterialId(cond), [cond])

  const seq = useRef(0)
  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(() => {
      fetchDecisionCards(topMat, cond).then((p) => {
        if (id === seq.current) setLive(p)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [topMat, cond])

  const fallback = useMemo(() => localDecisionCards(topMat, cond), [topMat, cond])

  const cards = live?.cards ?? fallback.cards
  const briefing = live?.briefing ?? fallback.briefing

  const scored = useMemo(
    () =>
      cards.map((c) => ({
        card: c,
        options: c.options.map((o) => ({ o, score: o.score ?? decisionScore(o.model) })),
      })),
    [cards],
  )

  return (
    <section className="border-b border-edge bg-panel/60 backdrop-blur">
      <div className="flex items-center gap-3 px-3 pt-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-bold tracking-wide text-white">What could you simulate?</h2>
          <span className="hidden text-[10px] text-mist md:inline">
            decision surface over real NASA PSI records — click a regime, card or option to replay it
          </span>
        </div>
        <span
          className={`ml-auto rounded px-1.5 py-px font-mono text-[8.5px] font-semibold uppercase ${
            live ? 'bg-emerald-500/15 text-emerald-400' : 'bg-edge/60 text-mist'
          }`}
          title={live ? 'live tactical synthesis — PSI-fitted risk model + C++20 ignition pressure + KNN evidence' : 'local risk mirror — backend offline'}
        >
          {live ? 'Engine: C++20' : 'local model'}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded border border-edge px-1.5 py-0.5 text-[10px] text-mist hover:text-white"
          title="Collapse the decision surface"
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {open ? 'hide' : 'show'}
        </button>
      </div>

      {/* environment pills */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
        {ENVS.map((e) => {
          const active = cond.env === e.key
          return (
            <button
              key={e.key}
              onClick={() => onCond({ env: e.key, tag: e.key === 'historical' ? 'incident' : null })}
              title={e.label}
              className={`rounded-full px-3 py-1 text-[10px] font-semibold transition-colors ${
                active
                  ? 'bg-white text-void'
                  : 'border border-edge bg-transparent text-mist hover:border-mist hover:text-white'
              }`}
            >
              {e.key === 'historical' && <History className="mr-1 inline h-3 w-3" />}
              {e.label}
            </button>
          )
        })}
        <span className="mx-1 hidden h-4 w-px bg-edge sm:block" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-mist">
          official replays
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() =>
              onApply(p.id, {
                ...(p.env ? { env: p.env } : {}),
                ...(p.o2Pct !== undefined ? { o2Pct: p.o2Pct } : {}),
                ...(p.flowCms !== undefined ? { flowCms: p.flowCms } : {}),
              })
            }
            title={`${p.tagline} — ${p.citation}`}
            className="flex items-center gap-1 rounded border border-flame/50 px-2 py-0.5 text-[10px] font-semibold text-flame hover:bg-flame/15"
          >
            <Play className="h-2.5 w-2.5" />
            {p.chip ?? p.name.split(' — ')[0]}
          </button>
        ))}
      </div>

      {/* tactical briefing — live synthesizer, or the local mirror offline */}
      {open && briefing && (
        <p className="mx-3 mt-2 rounded border border-edge/60 bg-panel2 px-2.5 py-1.5 font-mono text-[9.5px] leading-snug text-mist">
          <span className="mr-1.5 font-bold uppercase text-ember">briefing · {topMat}</span>
          {briefing}
        </p>
      )}

      {/* decision cards */}
      {open && (
        <div className="grid gap-2.5 p-3 md:grid-cols-3">
          {scored.map(({ card, options }) => {
            const nb = card.neighbors ?? []
            return (
              <div
                key={card.id}
                className="flex flex-col rounded-lg border border-edge bg-panel2 p-3 transition-colors hover:border-mist/60"
              >
                <div className="text-[9px] font-semibold uppercase tracking-widest text-mist">
                  {card.context}
                </div>
                <button
                  onClick={() => onApply(card.preset, {})}
                  className="mt-1 text-left text-[13px] font-semibold leading-snug text-white hover:text-ice"
                  title="Replay this scenario in the yard"
                >
                  {card.question}
                </button>
                <div className="mt-2.5 space-y-2">
                  {options.map(({ o, score }) => (
                    <button
                      key={o.label}
                      onClick={() =>
                        onApply(
                          card.preset,
                          {
                            env: ENV_FOR_GRAVITY[o.model.gravity ?? ''] ?? cond.env,
                            o2Pct: o.model.o2Pct,
                            flowCms: o.model.flowCms,
                          },
                          o.action,
                        )
                      }
                      className="group/opt block w-full text-left"
                      title={`${o.why} — apply ${o.model.o2Pct}% O₂ / ${o.model.flowCms} cm/s and replay`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10.5px] text-white/85 group-hover/opt:text-white">
                          {o.label}
                        </span>
                        <span className="font-mono text-[10px] text-mist">{score}%</span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-edge">
                        <div
                          className={`h-full rounded-full transition-all ${
                            score >= 60 ? 'bg-emerald-400' : score >= 30 ? 'bg-ember' : 'bg-red-400'
                          }`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                      <div className="mt-0.5 truncate text-[9px] italic text-mist/80">{o.why}</div>
                    </button>
                  ))}
                </div>

                {/* KNN evidence — the closest real PSI tests */}
                {nb.length > 0 && <NeighborChips neighbors={nb} />}

                <div className="mt-auto pt-2.5">
                  <div className="text-[8px] font-semibold uppercase tracking-widest text-mist/70">
                    NASA PSI sources — {card.metric} scored by the risk engine
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {card.sources.map((s) => (
                      <button
                        key={s}
                        onClick={() => onCond({ tag: s.toLowerCase() })}
                        className="rounded bg-edge/70 px-1.5 py-px text-[9px] text-mist hover:bg-ice/20 hover:text-ice"
                        title="Highlight matching records in the PSI grid"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function NeighborChips({ neighbors }: { neighbors: NeighborRef[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1" title="nearest real PSI test runs (weighted-Euclidean KNN)">
      {neighbors.map((n) => (
        <span
          key={`${n.accession}-${n.runId}`}
          title={`${n.fuel || n.materialKey || '?'} · ${n.o2Pct ?? '?'}% O₂ · ${
            n.flowCms ?? 0
          } cm/s · outcome ${n.outcome}${n.verified ? ' · verified' : ''}`}
          className="rounded border border-ice/30 bg-ice/10 px-1.5 py-px font-mono text-[8.5px] text-ice"
        >
          {n.similarity}% · {n.accession} {n.runId}
        </span>
      ))}
    </div>
  )
}
