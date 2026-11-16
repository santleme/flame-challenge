import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  buildSeedReports,
  clearGeneratedDashboards,
  exportReportMarkdown,
  getGeneratedDashboards,
  type GeneratedDashboard,
} from '../lib/generatedDashboards'
import { missionMedia } from '../lib/missionMedia'
import { navigate } from '../lib/scroll'
import { emitSimulationCommands } from '../lib/simBus'
import { GRAVITY_G } from '../lib/simConsole'
import { cn } from '../lib/cn'
import { HoverVideo } from './SimDeck'
import './missionReports.css'

const SEED_IDS = new Set(buildSeedReports().map((s) => s.id))
const LOC_MICROGRAVITY = 12
const LOC_EARTH = 15.5

type Tab = 'risk' | 'guidance' | 'envelope' | 'crew'
type Regime = 'all' | 'lunar' | 'microgravity' | 'earth'
type Level = GeneratedDashboard['spec']['rubric']['rank']['level']

const TABS: Array<[Tab, string]> = [
  ['risk', 'Risk'],
  ['guidance', 'Guidance'],
  ['envelope', 'Envelope'],
  ['crew', 'Crew'],
]
const REGIMES: Array<[Regime, string]> = [
  ['all', 'All'],
  ['lunar', 'Lunar 0.16g'],
  ['microgravity', '0g Orbit'],
  ['earth', '1g Base'],
]
const LEVELS: Record<Level, { dot: string; tone: string }> = {
  critical: { dot: 'var(--r-red)', tone: 'c-red' },
  high: { dot: 'var(--r-amber)', tone: 'c-amber' },
  moderate: { dot: 'var(--r-blue)', tone: 'c-blue' },
  low: { dot: 'var(--r-green)', tone: 'c-green' },
}

const ICONS = {
  flame: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  wind: (
    <>
      <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
      <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
      <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
    </>
  ),
  activity: <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />,
  gauge: (
    <>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </>
  ),
  check: (
    <>
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
} as const

function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg className={cn('ico', className)} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

function matchesRegime(r: GeneratedDashboard, regime: Regime) {
  if (regime === 'all') return true
  const g = (r.spec.rubric.summarize.gravityRegime || '').toLowerCase()
  if (regime === 'microgravity') return g.includes('0g') || g.includes('micro')
  if (regime === 'lunar') return g.includes('lunar') || g.includes('0.16')
  return g.includes('earth') || g.includes('1g')
}

function splitTitle(title: string) {
  const [name, ...rest] = title.split('//')
  return { name: name?.trim() || title, sub: rest.join('//').trim() }
}

const shortId = (id: string) => id.slice(0, 8).replace(/[^a-z0-9]/gi, '').toUpperCase()

function RiskTab({ report }: { report: GeneratedDashboard }) {
  const { rank } = report.spec.rubric
  const labels: Record<string, string> = {
    flammability: 'Flammability',
    hiddenHazard: 'Hidden hazard',
    explorationRelevance: 'Exploration relevance',
    dataRichness: 'NASA data richness',
  }
  const band = rank.uncertaintyBand
  const icons = ['flame', 'wind', 'activity'] as const
  return (
    <div className="two">
      <div className="gray">
        <p className="r-eyebrow">Risk vector</p>
        {Object.entries(rank.components).map(([k, v]) => (
          <div key={k} className="metric">
            <div className="h">
              <span>{labels[k] ?? k}</span>
              <b>{v}%</b>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.min(100, v)}%` }} />
            </div>
          </div>
        ))}
        {band && (
          <p className="note">
            {Math.round((band.level ?? 0.9) * 100)}% conformal interval · {band.low}–{band.high}%
          </p>
        )}
      </div>
      <div>
        <p className="r-eyebrow">What drives the score</p>
        <ul className="items">
          {rank.shapDrivers.map((d, i) => (
            <li key={d.factor}>
              <Icon name={icons[i % icons.length]} className="c-coral" />
              <div>
                <h4>{d.factor}</h4>
                <p>{d.rationale}</p>
              </div>
              <span className={cn('delta', d.delta.startsWith('+') ? 'c-red' : 'c-green')}>{d.delta}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function GuidanceTab({ report }: { report: GeneratedDashboard }) {
  const { summarize, interpret } = report.spec.rubric
  return (
    <div className="two">
      <div>
        <p className="r-eyebrow">NASA PSI synthesis</p>
        <p className="abstract">{summarize.abstract}</p>
        <div className="chips">
          <span>{summarize.materialId}</span>
          <span>{summarize.investigationId}</span>
          {summarize.psiAccessions.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
        {summarize.paperCitations.length > 0 && (
          <ul className="cites">
            {summarize.paperCitations.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <ul className="items">
        <li>
          <Icon name="shield" className="c-red" />
          <div>
            <h4 className="c-red">Immediate containment</h4>
            <p style={{ color: 'var(--ink)' }}>{interpret.containmentDoctrine}</p>
          </div>
          <span />
        </li>
        {(
          [
            ['check', 'Flight guidance', interpret.actionableGuidance],
            ['activity', 'Early detection', interpret.sensorAdvisory],
            ['gauge', 'Atmosphere limits', interpret.atmosphereLimits],
          ] as const
        ).map(([icon, label, text]) => (
          <li key={label}>
            <Icon name={icon} className="c-coral" />
            <div>
              <h4>{label}</h4>
              <p>{text}</p>
            </div>
            <span />
          </li>
        ))}
      </ul>
    </div>
  )
}

function EnvelopeChart({ env }: { env: GeneratedDashboard['spec']['safetyEnvelope'] }) {
  const W = 520
  const H = 320
  const p = { t: 20, r: 20, b: 46, l: 50 }
  const iw = W - p.l - p.r
  const ih = H - p.t - p.b
  const X = (f: number) => p.l + (Math.max(0, Math.min(f, 30)) / 30) * iw
  const Y = (o: number) => p.t + ih - (Math.max(0, Math.min(o, 40)) / 40) * ih
  const loc = env.locPct ?? LOC_MICROGRAVITY
  const zone = env.zone === 'runaway' ? 'var(--r-red)' : env.zone === 'safe' ? 'var(--r-green)' : 'var(--r-amber)'
  const cx = X(env.currentFlow)
  const cy = Y(env.currentO2)
  const flip = cx > W * 0.58
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Oxygen concentration versus forced airflow velocity">
      {[0, 10, 20, 30, 40].map((o) => (
        <g key={o}>
          <line x1={p.l} x2={p.l + iw} y1={Y(o)} y2={Y(o)} stroke="currentColor" strokeOpacity=".1" />
          <text x={p.l - 8} y={Y(o) + 3.5} fontSize="11" textAnchor="end" fill="currentColor" opacity=".5">
            {o}%
          </text>
        </g>
      ))}
      {[0, 10, 20, 30].map((f) => (
        <text key={f} x={X(f)} y={p.t + ih + 18} fontSize="11" textAnchor="middle" fill="currentColor" opacity=".5">
          {f}
        </text>
      ))}
      <rect x={p.l} y={Y(loc)} width={iw} height={p.t + ih - Y(loc)} rx="6" fill="var(--r-green)" opacity=".18" />
      <polygon
        points={`${X(0)},${Y(38)} ${X(5)},${Y(28)} ${X(12)},${Y(22)} ${X(30)},${Y(17)} ${X(30)},${Y(40)} ${X(0)},${Y(40)}`}
        fill="var(--r-red)"
        opacity=".15"
      />
      <line x1={p.l} x2={p.l + iw} y1={Y(loc)} y2={Y(loc)} stroke="var(--r-green)" strokeOpacity=".7" strokeDasharray="4 4" />
      <text x={p.l + 10} y={p.t + ih - 10} fontSize="11" fontWeight="500" fill="var(--r-green)">
        Safe · below LOC
      </text>
      <text x={p.l + iw - 10} y={p.t + 18} fontSize="11" fontWeight="500" fill="var(--r-red)" textAnchor="end">
        Thermal runaway
      </text>
      {env.trajectory.length > 1 && (
        <polyline points={env.trajectory.map((t) => `${X(t.flowCms)},${Y(t.o2Pct)}`).join(' ')} fill="none" stroke="var(--r-blue)" strokeWidth="2" strokeDasharray="3 3" />
      )}
      <circle cx={cx} cy={cy} r="11" fill={zone} opacity=".22" />
      <circle cx={cx} cy={cy} r="5.5" fill={zone} stroke="var(--r-panel)" strokeWidth="2.5" />
      <text x={flip ? cx - 16 : cx + 16} y={cy - 9} fontSize="12" fontWeight="500" fill="currentColor" textAnchor={flip ? 'end' : 'start'}>
        {env.currentO2}% O₂ · {env.currentFlow} cm/s
      </text>
      <text x={p.l + iw / 2} y={H - 6} fontSize="11" textAnchor="middle" fill="currentColor" opacity=".5">
        Airflow velocity (cm/s)
      </text>
      <text transform={`rotate(-90 11 ${p.t + ih / 2})`} x="11" y={p.t + ih / 2} fontSize="11" textAnchor="middle" fill="currentColor" opacity=".5">
        O₂ concentration
      </text>
    </svg>
  )
}

function EnvelopeTab({ report }: { report: GeneratedDashboard }) {
  const { safetyEnvelope: env, rubric } = report.spec
  const loc = env.locPct ?? LOC_MICROGRAVITY
  const margin = +(env.currentO2 - loc).toFixed(1)
  const over = margin > 0
  const zoneTone = env.zone === 'runaway' ? 'c-red' : env.zone === 'safe' ? 'c-green' : 'c-amber'
  const facts: Array<[string, ReactNode]> = [
    ['Zone', <span key="z" className={cn(zoneTone, 'capitalize')}>{env.zone}</span>],
    ['Operating point', `${env.currentO2}% O₂ · ${env.currentFlow} cm/s`],
    ['Pressure · gravity', `${rubric.summarize.pressureKpa} kPa · ${rubric.summarize.gravityRegime}`],
    ['Material LOC', `${loc.toFixed(1)}% O₂`],
    ['Earth baseline LOC', `${LOC_EARTH.toFixed(1)}% O₂`],
    [
      'LOC margin',
      <span key="m" className={over ? 'c-red' : 'c-green'}>
        {over ? '+' : ''}
        {margin} pts {over ? 'above LOC' : 'below LOC'}
      </span>,
    ],
  ]
  return (
    <div className="two" style={{ alignItems: 'center' }}>
      <div className="gray">
        <p className="r-eyebrow">Flammability boundary</p>
        <EnvelopeChart env={env} />
      </div>
      <div>
        <dl className="facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="note">Boundaries follow NASA PSI SoFIE-GEL and BASS-II empirical flammability limits.</p>
      </div>
    </div>
  )
}

function Avatar({ name, src }: { name: string; src?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [src])
  return (
    <span className="av">
      {name
        .split(' ')
        .map((n) => n[0])
        .join('')}
      {src && !broken && <img src={src} alt="" onError={() => setBroken(true)} />}
    </span>
  )
}

function CrewTab({ report }: { report: GeneratedDashboard }) {
  const { crewImpact: ci } = report.spec
  const cf = ci.counterfactual
  const original = ci.causalLog.find((e) => e.severity === 'danger')?.action ?? ci.missionStatus
  return (
    <div className="stack">
      <div>
        <div className="cf-head">
          <div>
            <p className="r-eyebrow" style={{ marginBottom: '.4rem' }}>Counterfactual recovery</p>
            <h4>{cf.title}</h4>
          </div>
          <div className="cf-chips">
            <span className="c-green">+{cf.crewSavedPct}% crew preserved</span>
            <span className="c-blue">−{cf.riskReductionPct}% risk</span>
          </div>
        </div>
        <div className="cf">
          <div className="gray">
            <h4 className="c-red">Original execution</h4>
            <p className="b">{original}</p>
            <div className="bar">
              <i className="bad" style={{ width: `${Math.max(15, 100 - cf.riskReductionPct)}%` }} />
            </div>
          </div>
          <div className="gray">
            <h4 className="c-green">IGNIS recovery protocol</h4>
            <p className="b">{cf.recommendedAction}</p>
            <div className="bar">
              <i className="ok" style={{ width: `${cf.crewSavedPct}%` }} />
            </div>
            <p className="note" style={{ marginTop: '.9rem' }}>{cf.outcomeDelta}</p>
          </div>
        </div>
      </div>
      <div className="two">
        <div>
          <p className="r-eyebrow">Crew · {ci.crew.length} personnel</p>
          <ul>
            {ci.crew.map((m) => {
              const ok = m.status === 'Nominal' || m.status === 'Safe'
              return (
                <li key={m.id} className="person">
                  <Avatar name={m.name} src={m.avatar} />
                  <span className="n">
                    <b>{m.name}</b>
                    <small>{m.role}</small>
                  </span>
                  <em className={ok ? 'c-green' : m.status === 'Smoke Inhalation' ? 'c-amber' : 'c-red'}>● {m.status}</em>
                </li>
              )
            })}
          </ul>
        </div>
        <div>
          <p className="r-eyebrow">Causal log</p>
          <ol className="tl">
            {ci.causalLog.map((e, i) => (
              <li key={`${e.time}-${i}`}>
                <i style={{ background: e.severity === 'danger' ? 'var(--r-red)' : e.severity === 'warning' ? 'var(--r-amber)' : 'var(--r-blue)' }} />
                <small>
                  <b>{e.time}</b> · {e.actor}
                </small>
                <p>{e.action}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

function Featured({ report, custom, onSimulate }: { report: GeneratedDashboard; custom: boolean; onSimulate: () => void }) {
  const { spec } = report
  const { summarize, rank } = spec.rubric
  const { name, sub } = splitTitle(spec.title)
  const media = missionMedia(summarize.investigationId, summarize.gravityRegime)
  const lv = LEVELS[rank.level]
  const tele: Array<[string, string]> = [
    ['Oxygen', `${summarize.o2Pct}%`],
    ['Airflow', `${summarize.flowCms} cm/s`],
    ['Pressure', `${summarize.pressureKpa} kPa`],
    ['Gravity', summarize.gravityRegime],
  ]
  return (
    <article className="feature rise-in">
      <figure data-hover-media className="media">
        <HoverVideo src={media.src} poster={media.poster} label={media.caption} className="" />
        <figcaption>{media.caption}</figcaption>
      </figure>
      <div>
        <span className="tag">
          <span className="dot" style={{ background: 'var(--r-coral)' }} />
          {spec.missionTag}
          {custom && ' · Live session'}
        </span>
        <h3 className="title">{name}</h3>
        {sub && <p className="sub">{sub}</p>}
        <div className="score">
          <div>
            <b>{rank.compositeRisk}</b>
            <i>%</i>
          </div>
          <span className={cn('level', lv.tone)}>
            <span className="dot" style={{ background: lv.dot }} />
            {rank.level} risk
          </span>
        </div>
        <dl className="tele">
          {tele.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="actions">
          <button type="button" className="r-btn" onClick={onSimulate}>
            Simulate in Live Chamber <span aria-hidden="true">↗</span>
          </button>
          <button type="button" className="link" onClick={() => exportReportMarkdown(report)} title="Download Markdown brief">
            ↓ Export .md
          </button>
        </div>
      </div>
    </article>
  )
}

export default function MissionReportsPanel() {
  const [reports, setReports] = useState<GeneratedDashboard[]>(getGeneratedDashboards)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('risk')
  const [regime, setRegime] = useState<Regime>('all')

  useEffect(() => {
    const sync = (event: Event) => {
      setReports(getGeneratedDashboards())
      // a fresh live report takes focus — the run the operator just
      // triggered should be what they see when they open the dashboard
      const id = (event as CustomEvent<GeneratedDashboard>).detail?.id
      if (id) setSelectedId(id)
    }
    window.addEventListener('ignis:dashboard-generated', sync)
    return () => window.removeEventListener('ignis:dashboard-generated', sync)
  }, [])

  // deep link: '#dashboard-reports' (the console's "view dashboards" hop)
  // routes to the dashboard view — scroll the panel into view on mount
  // so the operator lands on the brief, not the page top
  useEffect(() => {
    const scrollToBrief = () => {
      const hash = location.hash.slice(1)
      if (hash === 'dashboard-reports' || hash === 'mission-reports') {
        const el = document.getElementById('mission-reports') || document.getElementById('dashboard-reports')
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    const t = setTimeout(scrollToBrief, 60)
    window.addEventListener('hashchange', scrollToBrief)
    window.addEventListener('ignis:route', scrollToBrief)
    return () => {
      clearTimeout(t)
      window.removeEventListener('hashchange', scrollToBrief)
      window.removeEventListener('ignis:route', scrollToBrief)
    }
  }, [])

  const filtered = useMemo(() => reports.filter((r) => matchesRegime(r, regime)), [reports, regime])
  const current = filtered.find((r) => r.id === selectedId) ?? filtered[0]
  const critical = reports.filter((r) => r.spec.rubric.rank.level === 'critical').length
  const peak = Math.max(0, ...reports.map((r) => r.spec.rubric.rank.compositeRisk))
  const hasCustom = reports.some((r) => !SEED_IDS.has(r.id))

  const simulate = (r: GeneratedDashboard) => {
    const s = r.spec.rubric.summarize
    emitSimulationCommands(
      {
        load_preset: s.investigationId,
        set_o2_percent: s.o2Pct,
        set_airflow_cm_s: s.flowCms,
        // reproduce the gravity the report was scored at — a lunar brief
        // must run in lunar gravity, not the chamber default
        set_gravity_g: GRAVITY_G[r.analysisScenario?.gravity ?? r.scenario?.gravity ?? 'microgravity'] ?? 0,
      },
      'mission-brief',
      s.investigationId,
    )
    navigate('#simulations')
  }

  const reset = () => {
    clearGeneratedDashboards()
    setReports(getGeneratedDashboards())
    setSelectedId(null)
  }

  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([k]) => k === tab)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const [key] = TABS[(next + TABS.length) % TABS.length]
    setTab(key)
    document.getElementById(`rpt-tab-${key}`)?.focus()
  }

  return (
    <div className="rpt">
      <header className="hero">
        <h2 id="mission-reports">Generated Mission Reports</h2>
        <p className="lede">Flight certification briefs built from NASA microgravity combustion data and the IGNIS physics core.</p>
        <div className="hero-row">
          <span className="pill-badge">
            <span className="dot" style={{ background: 'var(--r-red)' }} />
            <b>{critical} critical</b> · peak risk {peak}%
          </span>
          <div className="seg" role="group" aria-label="Filter by gravity regime">
            {REGIMES.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={regime === key} onClick={() => setRegime(key)}>
                {label}
              </button>
            ))}
            {hasCustom && (
              <button type="button" onClick={reset} title="Remove live-session reports and restore the seed briefs">
                Reset
              </button>
            )}
          </div>
        </div>
      </header>

      {!current ? (
        <div className="empty">
          <p>No briefs match this regime.</p>
          <p style={{ marginTop: '1rem' }}>
            <button type="button" className="r-btn" onClick={() => setRegime('all')}>
              Show all briefs
            </button>
          </p>
        </div>
      ) : (
        <>
          <div className="picker" role="tablist" aria-label="Mission briefs">
            {filtered.map((r) => {
              const rk = r.spec.rubric.rank
              return (
                <button key={r.id} type="button" role="tab" className="pick" aria-selected={r.id === current.id} onClick={() => setSelectedId(r.id)}>
                  <span className="dot" style={{ background: LEVELS[rk.level].dot }} />
                  {splitTitle(r.spec.title).name}
                  <small>
                    {rk.compositeRisk}%{!SEED_IDS.has(r.id) && ' · live'}
                  </small>
                </button>
              )
            })}
          </div>

          <Featured key={current.id} report={current} custom={!SEED_IDS.has(current.id)} onSimulate={() => simulate(current)} />

          <section className="breakdown" aria-label="Report breakdown">
            <h3>Report breakdown</h3>
            <div className="tabs" role="tablist" aria-label="Report sections" onKeyDown={onTabKey}>
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  id={`rpt-tab-${key}`}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === key}
                  aria-controls="rpt-panel"
                  tabIndex={tab === key ? 0 : -1}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div key={`${current.id}-${tab}`} id="rpt-panel" role="tabpanel" aria-labelledby={`rpt-tab-${tab}`} className="panelbox rise-in">
              {tab === 'risk' && <RiskTab report={current} />}
              {tab === 'guidance' && <GuidanceTab report={current} />}
              {tab === 'envelope' && <EnvelopeTab report={current} />}
              {tab === 'crew' && <CrewTab report={current} />}
            </div>
            <p className="note" style={{ marginTop: '2rem' }}>
              IGNIS-REPORT-{shortId(current.id)} ·{' '}
              {SEED_IDS.has(current.id) ? 'curated demo brief' : `${current.response.mode} · ${current.response.model}`}
            </p>
          </section>
        </>
      )}
    </div>
  )
}
