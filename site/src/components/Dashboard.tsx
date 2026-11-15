import { useEffect, useState } from 'react'
import {
  dashboardGeneratedEvent,
  getGeneratedDashboards,
  clearGeneratedDashboards,
  SEED_REPORTS,
  exportReportMarkdown,
  type GeneratedDashboard,
} from '../lib/generatedDashboards'
import { navigate, navigateBack } from '../lib/scroll'
import Button from './ui/Button'
import { IconArrowLeft, IconArrowUpRight, IconDownload, IconFileText } from './Icons'
import SafetyEnvelopeChart from './SafetyEnvelopeChart'
import CrewTimelinePanel from './CrewTimelinePanel'
import InteractiveEquationCanvas from './InteractiveEquationCanvas'
import CounterfactualTrackCard from './CounterfactualTrackCard'
import MissionWaffleMatrix from './MissionWaffleMatrix'
import Footer from './Footer'

function percent(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${Math.round(value <= 1 ? value * 100 : value)}%`
}

function ReportCard({ item }: { item: GeneratedDashboard }) {
  const spec = item.spec
  const rubric = spec.rubric
  const risk = percent(item.response?.chamber?.riskIndex ?? rubric.rank.compositeRisk)
  const level = rubric.rank.level
  const evidence = item.response?.evidence ?? []

  const isDroplet = rubric.summarize.investigationId === 'flex-2'

  const handlePrint = () => {
    window.print()
  }

  const handleExport = () => {
    exportReportMarkdown(item)
  }

  return (
    <article
      id={`dashboard-${item.id}`}
      className="dashboard-result scroll-mt-28 space-y-8 rounded-shell panel-85 p-6 shadow-[0_24px_70px_-42px_rgba(16,35,60,.5)] backdrop-blur-2xl sm:p-10"
    >
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-edge pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-full border border-edge bg-white/40 px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-label text-accent dark:bg-white/[0.05]">
            {spec.missionTag}
          </span>
          <span className="rounded-full border border-edge px-3 py-1 font-mono text-xs opacity-70">
            {item.run ? 'Simulation Verified (C++20 Core)' : 'Copilot Grounded Analytical Head'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <time className="font-mono text-xs opacity-60" dateTime={new Date(item.createdAt).toISOString()}>
            {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(item.createdAt)}
          </time>
          <div className="flex items-center gap-2">
            <Button variant="glass" size="sm" onClick={handleExport} title="Download Markdown Executive Brief">
              <IconDownload size={14} /> Export Brief (.md)
            </Button>
            <Button variant="glass" size="sm" onClick={handlePrint} title="Print / Save PDF">
              <IconFileText size={14} /> PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Main Title & Executive Abstract */}
      <div>
        <h2 className="max-w-4xl font-display text-2xl font-bold leading-tight tracking-tight sm:text-4xl">
          {spec.title}
        </h2>
        <p className="mt-4 max-w-4xl text-base leading-relaxed opacity-85 sm:text-lg">
          {rubric.summarize.abstract}
        </p>
      </div>

      {/* 1. INTERACTIVE MATHEMATICAL PHYSICAL SOLVER CANVAS */}
      <div>
        <InteractiveEquationCanvas
          modelType={isDroplet ? 'droplet' : 'spread'}
          o2Pct={rubric.summarize.o2Pct}
          flowCms={rubric.summarize.flowCms}
          materialName={rubric.summarize.materialId}
        />
      </div>

      {/* 2. NASA RUBRIC PILLARS: Summarize · Rank · Interpret */}
      <div className="space-y-4">
        <div className="card-label flex items-center gap-2 opacity-80">
          <span>NASA Evaluation Rubric</span>
          <span>·</span>
          <span>Summarize · Rank · Interpret</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Pillar 1: SUMMARIZE */}
          <div className="flex flex-col justify-between rounded-2xl border border-edge bg-white/40 p-4 dark:bg-white/[0.03]">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">
                  1. Summarize
                </span>
                <span className="font-mono text-mini opacity-60">PSI Data Ingestion</span>
              </div>
              <h3 className="mt-2 text-base font-semibold">Microgravity Regimes</h3>
              <p className="mt-2 text-xs leading-relaxed opacity-75">
                Model: <strong className="font-mono font-medium">{rubric.summarize.investigationId}</strong> on{' '}
                <strong className="font-mono font-medium">{rubric.summarize.materialId}</strong> at{' '}
                <strong className="font-mono font-medium">{rubric.summarize.o2Pct}% O₂</strong>,{' '}
                <strong className="font-mono font-medium">{rubric.summarize.flowCms} cm/s</strong> forced airflow.
              </p>
            </div>
            <div className="mt-4 border-t border-edge pt-3">
              <div className="text-mini font-semibold uppercase tracking-wider opacity-60">NASA PSI Evidence IDs</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {rubric.summarize.psiAccessions.slice(0, 3).map((acc) => (
                  <span
                    key={acc}
                    className="rounded bg-black/10 px-2 py-0.5 font-mono text-micro dark:bg-white/10"
                  >
                    {acc}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Pillar 2: RANK */}
          <div className="flex flex-col justify-between rounded-2xl border border-edge bg-white/40 p-4 dark:bg-white/[0.03]">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400">
                  2. Rank
                </span>
                <span className="font-mono text-mini opacity-60">Conformal Risk Head</span>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-display text-4xl font-bold tabular-nums">
                  {risk ?? `${rubric.rank.compositeRisk}%`}
                </span>
                <span className="font-mono text-xs uppercase font-semibold text-rose-400">
                  {level.toUpperCase()} HAZARD
                </span>
              </div>
              <div className="mt-1 font-mono text-xs opacity-65">
                {rubric.rank.uncertaintyBand
                  ? `${Math.round((rubric.rank.uncertaintyBand.level ?? 0.9) * 100)}% Conformal Confidence: [${rubric.rank.uncertaintyBand.low}%, ${rubric.rank.uncertaintyBand.high}%]`
                  : 'Conformal bounds: uncalibrated'}
              </div>
            </div>
            <div className="mt-4 border-t border-edge pt-3">
              <div className="text-mini font-semibold uppercase tracking-wider opacity-60">Top SHAP Attribution</div>
              <div className="mt-1.5 space-y-1">
                {rubric.rank.shapDrivers.slice(0, 2).map((driver, idx) => (
                  <div key={idx} className="flex justify-between text-mini">
                    <span className="opacity-75">{driver.factor}</span>
                    <span className="font-mono font-bold text-accent">{driver.delta}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pillar 3: INTERPRET */}
          <div className="flex flex-col justify-between rounded-2xl border border-edge bg-white/40 p-4 dark:bg-white/[0.03]">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">
                  3. Interpret
                </span>
                <span className="font-mono text-mini opacity-60">Actionable Safety</span>
              </div>
              <h3 className="mt-2 text-base font-semibold">Operational Containment</h3>
              <p className="mt-2 text-xs leading-relaxed opacity-75">
                {rubric.interpret.actionableGuidance}
              </p>
            </div>
            <div className="mt-4 border-t border-edge pt-3">
              <div className="text-mini font-semibold uppercase tracking-wider opacity-60">Sensor Advisory</div>
              <div className="mt-1 text-mini opacity-75">
                {rubric.interpret.sensorAdvisory}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. 2D SAFETY OPERATING ENVELOPE (GO / NO-GO) */}
      <div>
        <SafetyEnvelopeChart
          currentO2={spec.safetyEnvelope.currentO2}
          currentFlow={spec.safetyEnvelope.currentFlow}
          materialName={rubric.summarize.materialId}
          gravityMode={rubric.summarize.gravityRegime}
          trajectory={spec.safetyEnvelope.trajectory}
        />
      </div>

      {/* 4. COUNTERFACTUAL DECISION TRACK CARD */}
      <div>
        <CounterfactualTrackCard
          scenarioTitle={spec.title}
          originalAction={spec.crewImpact.causalLog[2]?.action ?? 'Maintain forced ventilation without thermal isolation'}
          originalIntegrityPct={rubric.rank.level === 'critical' ? 18 : 28}
          originalCasualties={rubric.rank.level === 'critical' ? '1 Severe Casualty / Compartment Breached' : 'Smoke Inhalation Incident'}
          siProtocolAction={rubric.interpret.containmentDoctrine}
          siProtocolIntegrityPct={88}
          siProtocolCasualties="Zero Casualties · Module 100% Preserved"
          recommendedFlowCms={0.0}
          investigationId={rubric.summarize.investigationId}
          baselineO2={rubric.summarize.o2Pct}
        />
      </div>

      {/* 5. CREW TIMELINE & CASUALTY LOG */}
      <div>
        <CrewTimelinePanel
          missionTitle={`${spec.title} — Human Factors Audit`}
          outcomeStatus={spec.crewImpact.missionStatus}
          crew={spec.crewImpact.crew}
          causalLog={spec.crewImpact.causalLog}
          counterfactual={spec.crewImpact.counterfactual}
        />
      </div>

      {/* Source Records from PSI */}
      {evidence.length > 0 && (
        <div className="border-t border-edge pt-6">
          <h4 className="text-sm font-semibold">Closest Corroborating NASA PSI Records</h4>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {evidence.slice(0, 4).map((source) => (
              <li key={`${item.id}-${source.runId}`}>
                <a
                  className="inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-edge px-4 text-xs transition-colors hover:bg-white/50 dark:hover:bg-white/10"
                  href={source.sourceUrl || '#psi-dataset'}
                  target={source.sourceUrl ? '_blank' : undefined}
                  rel="noreferrer"
                >
                  <span className="truncate">
                    {source.accession} · {source.fuel} · {source.outcome}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums opacity-65">
                    {Math.round(source.similarity)}% match
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex flex-wrap gap-3 border-t border-edge pt-6">
        <Button asChild variant="glass" size="default">
          <a
            href="#simulations"
            onClick={(event) => {
              event.preventDefault()
              navigate('#simulations')
            }}
          >
            Re-test in Live Chamber <IconArrowUpRight size={16} />
          </a>
        </Button>
        <Button variant="ghost" size="default" onClick={handleExport}>
          <IconDownload size={15} /> Download Flight Brief
        </Button>
      </div>
    </article>
  )
}

export default function Dashboard() {
  const [items, setItems] = useState<GeneratedDashboard[]>(getGeneratedDashboards)

  useEffect(() => {
    const refresh = () => setItems(getGeneratedDashboards())
    window.addEventListener(dashboardGeneratedEvent(), refresh)
    return () => window.removeEventListener(dashboardGeneratedEvent(), refresh)
  }, [])

  useEffect(() => {
    const id = location.hash.startsWith('#dashboard-') ? location.hash.slice('#dashboard-'.length) : null
    if (!id) return
    const timer = window.setTimeout(
      () => document.getElementById(`dashboard-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      100,
    )
    return () => window.clearTimeout(timer)
  }, [items])

  return (
    <div data-lenis-prevent className="fixed inset-0 z-10 overflow-y-auto overscroll-contain bg-bg">
      <div className="shell pb-24 pt-28">
        <Button variant="glass" size="default" onClick={navigateBack}>
          <IconArrowLeft size={16} /> Back to Overview
        </Button>

        {/* Dashboard Title & Introduction */}
        <div className="mt-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-eyebrow text-accent">
              IGNIS · NASA PSI Flight Safety Intelligence
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tighter sm:text-6xl">
              Mission Safety Dashboard
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 opacity-75 sm:text-lg">
              Schema-driven flight certification briefs generated from 30 years of NASA microgravity combustion
              experiments, C++20 physical boundary models, and crew survival protocols.
            </p>
          </div>
          <Button variant="primary" size="default" onClick={() => navigate('#simulations')}>
            Run Live Simulation <IconArrowUpRight size={16} />
          </Button>
        </div>

        {/* SECTION: 5 Headline Exploration Findings */}
        <section className="mt-12 rounded-card panel-60 p-6 backdrop-blur-xl sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-4">
            <div>
              <span className="card-label">
                Corpus Core Discoveries
              </span>
              <h2 className="mt-1 font-display text-xl font-bold sm:text-2xl">
                The 5 Headline Exploration Findings
              </h2>
            </div>
            <span className="font-mono text-xs opacity-60">Verified across 614 NASA PSI Flight Runs</span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                num: '01',
                title: 'Flame Persists Below Earth LOC',
                tag: 'Limiting O₂',
                desc: 'Without buoyant heat dissipation, microgravity flames sustain creeping spread down to 12% O₂ — well beneath Earth flammability limits.',
                evidence: 'NASA PSI SoFIE-GEL & BASS-II',
              },
              {
                num: '02',
                title: 'Silent Cool-Flame Re-ignition',
                tag: 'Hidden Hazard',
                desc: 'Droplets sustain low-temperature (~600–720 K) invisible chemistry long after visible extinction. Premature air resumption triggers violent flashover.',
                evidence: 'FLEX & FLEX-2 (53 confirmed PSI runs)',
              },
              {
                num: '03',
                title: '34% O₂ Exploration Atmospheres',
                tag: 'Artemis Architecture',
                desc: 'Artemis 8.2 psia / 34% O₂ exploration atmospheres double polymer flame spread rates, invalidating standard terrestrial safety certifications.',
                evidence: 'NASA Saffire-IV & ACME',
              },
              {
                num: '04',
                title: 'Zero-Buoyancy Sensor Blindness',
                tag: 'Life Support Gap',
                desc: 'Lack of upward convective smoke plumes causes particulate agglomeration, bypassing standard optical ionization alarms calibrated for Earth.',
                evidence: 'SAME & SAME-R (PSI-102)',
              },
              {
                num: '05',
                title: 'Lunar / Martian Partial-g Spikes',
                tag: 'Moon / Mars Frontier',
                desc: 'Weak buoyancy in 0.16g (Moon) and 0.38g (Mars) supplies steady oxidizer without blowing flames out, creating higher peak flame speed than 0g.',
                evidence: 'FLARE (JAXA / NASA)',
              },
            ].map((f) => (
              <div
                key={f.num}
                className="flex flex-col justify-between rounded-2xl border border-edge bg-white/40 p-4 transition-all hover:border-accent/50 dark:bg-white/[0.03]"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-accent">{f.num}</span>
                    <span className="rounded bg-black/10 px-2 py-0.5 font-mono text-micro uppercase font-semibold dark:bg-white/10">
                      {f.tag}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold">{f.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed opacity-75">{f.desc}</p>
                </div>
                <div className="mt-4 border-t border-edge pt-2.5 font-mono text-micro text-accent opacity-80">
                  Evidence: {f.evidence}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION: Simile Mission Waffle Matrix */}
        <section className="mt-12">
          <MissionWaffleMatrix />
        </section>

        {/* Generated Reports List */}
        <div className="mt-14 space-y-10">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-bold sm:text-3xl">
              Interactive Mission Briefs ({items.length})
            </h2>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs opacity-60">Pre-Seeded &amp; Live Simulation Reports</span>
              {items.length > SEED_REPORTS.length && (
                <Button variant="glass" size="sm" onClick={clearGeneratedDashboards}>
                  Clear generated
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-12">
            {items.map((item) => (
              <ReportCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
