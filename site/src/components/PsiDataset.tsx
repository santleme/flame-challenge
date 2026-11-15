import { useEffect, useRef, useState } from 'react'
import {
  ALL_THEMES,
  DATASET_STATS,
  INVESTIGATIONS,
  THEME_LABELS,
} from '../lib/dashboard'
import { attachKeyedFlame } from '../lib/keyedFlame'
import { getFilterTag, gsap, navigateBack, setFilterTag } from '../lib/scroll'
import { IconArrowLeft } from './Icons'
import Button from './ui/Button'
import Footer from './Footer'

const SOURCES = [
  { label: 'psi repo', href: 'https://psi.nasa.gov/physci/repo' },
  { label: 'images.nasa.gov', href: 'https://images.nasa.gov/' },
  { label: 'ntrs', href: 'https://ntrs.nasa.gov/' },
]

const fmtO2 = (i: { conditions: { oxygenPct: [number, number] | null } }) =>
  i.conditions.oxygenPct
    ? i.conditions.oxygenPct[0] === i.conditions.oxygenPct[1]
      ? `${i.conditions.oxygenPct[0]}%`
      : `${i.conditions.oxygenPct[0]}–${i.conditions.oxygenPct[1]}%`
    : '—'
const fmtFlow = (i: { conditions: { flowCms: [number, number] | null } }) =>
  i.conditions.flowCms ? `${i.conditions.flowCms[0]}–${i.conditions.flowCms[1]}` : '—'

/** PSI dataset — its own screen. Saffire-VI PMMA burn footage keyed the
 *  same way as the hero flame (black pixels → alpha), the provenance
 *  ledger, and the full investigation matrix that used to live inside
 *  the dashboard. Mounted as an overlay by App on '#psi-dataset'. */
export default function PsiDataset() {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Keep the selected theme across close/reopen.
  const [theme, setTheme] = useState<string>(() => {
    const t = getFilterTag()
    return t && (t === 'all' || ALL_THEMES.includes(t)) ? t : 'all'
  })
  const [open, setOpen] = useState<string | null>(null)

  // Mirror manual picks back into module state.
  useEffect(() => {
    setFilterTag(theme)
  }, [theme])

  // luminance keying — saffire-vi flame-on-black becomes real alpha and
  // floats behind the headline, same trick as the challenge section.
  // the loop window is discovered at runtime (the clip's container
  // reports an odd duration, so we adapt instead of hardcoding)
  const loopEnd = useRef(Infinity)
  useEffect(() => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    return attachKeyedFlame(v, c)
  }, [])

  // choreography — hero elements fly in on mount; further blocks reveal
  // against the overlay's own scroller (the window never scrolls here)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('[data-hero]', {
        opacity: 0,
        y: 18,
        duration: 0.6,
        ease: 'power2.out',
        stagger: 0.07,
      })
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
        gsap.from(el, {
          opacity: 0,
          y: 16,
          duration: 0.55,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 92%',
            scroller: root,
          },
        })
      })
    }, root)
    return () => ctx.revert()
  }, [])

  const filtered =
    theme === 'all'
      ? INVESTIGATIONS
      : INVESTIGATIONS.filter((i) => i.themes.includes(theme))

  return (
    <div
      ref={rootRef}
      data-lenis-prevent
      className="fixed inset-0 z-10 overflow-y-auto overscroll-contain bg-bg"
    >
      <section
        id="psi-dataset"
        aria-labelledby="psi-dataset-title"
        className="shell relative pb-28 pt-24 sm:pt-28"
      >
        {/* saffire-vi pmma burn — keyed footage bleeding behind the head */}
        <video
          ref={videoRef}
          className="absolute h-px w-px opacity-0"
          autoPlay
          muted
          playsInline
          loop
          preload="metadata"
          aria-hidden="true"
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = 0.5
            const d = e.currentTarget.duration
            loopEnd.current =
              Number.isFinite(d) && d > 1.5 ? d - 0.4 : Infinity
          }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= loopEnd.current)
              e.currentTarget.currentTime = 0.5
          }}
        >
          <source src="/assets/saffire_pmma.mp4" media="(min-width: 768px)" />
          <source src="/assets/saffire_pmma_sd.mp4" />
        </video>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-10 h-[min(60vh,520px)] sm:top-16"
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full object-cover opacity-80 [mask-image:radial-gradient(ellipse_at_center,black_42%,transparent_72%)]"
          />
        </div>

        <div className="relative">
          <div
            data-hero
            className="eyebrow flex items-baseline justify-between gap-6 opacity-70"
          >
            <Button asChild variant="glass" size="sm" className="lowercase">
              <a
                href="#top"
                onClick={(e) => {
                  e.preventDefault()
                  navigateBack()
                }}
              >
                <IconArrowLeft size={14} />
                back
              </a>
            </Button>
            <span className="hidden cursor-default transition-colors duration-300 hover:text-accent hover:opacity-100 sm:inline">
              nasa physical sciences informatics
            </span>
          </div>

          <h2
            id="psi-dataset-title"
            data-hero
            className="m-0 mt-6 cursor-default font-display text-[clamp(2.4rem,6vw,4.6rem)] font-bold leading-display tracking-tight text-ink transition-colors duration-300 hover:text-accent"
          >
            psi dataset
          </h2>
          <p
            data-hero
            className="mt-6 max-w-2xl text-body leading-copy text-ink opacity-80"
          >
            experiment telemetry pulled from the nasa physical sciences
            informatics repo, normalized to csv, and frozen into{' '}
            <span className="font-mono text-ink opacity-90">
              shared/calibrated-data/*.json
            </span>{' '}
            — the engine only reads verified records. burning behind the
            headline: saffire-vi, a pmma slab ignited inside a cygnus
            vehicle after departure — the scenario this engine replays.
          </p>

          <div data-hero className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="font-mono text-micro lowercase tracking-card text-ink opacity-60">
              {DATASET_STATS.investigations} investigations ·{' '}
              {DATASET_STATS.psiRuns} parsed runs ·{' '}
              {DATASET_STATS.verified} pipeline-verified
            </span>
            <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 font-mono text-mini lowercase tracking-card">
              {SOURCES.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link underline-offset-4 transition-colors duration-300 hover:text-accent hover:underline"
                  >
                    {s.label} ↗
                  </a>
                </li>
              ))}
              <li>
                <a
                  href="https://images.nasa.gov/details/Saf-VI%20S8C3%2BC4%201-sided%20PMMA_unmapped_jpeg-20x%20no%20text"
                  target="_blank"
                  rel="noreferrer"
                  className="text-link underline-offset-4 transition-colors duration-300 hover:text-accent hover:underline"
                >
                  saffire-vi footage ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* ============ investigation matrix ============ */}
        <div className="relative pt-20">
          <div
            data-reveal
            className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
          >
            <div className="eyebrow opacity-70">
              summarize — the psi investigation matrix
            </div>
            <div className="font-mono text-micro lowercase tracking-card text-ink opacity-60">
              {filtered.length} of {DATASET_STATS.investigations}{' '}
              investigations
            </div>
          </div>

          {/* theme filter — the names the brief calls out */}
          <div data-reveal className="dataset-filters mt-6">
            {['all', ...ALL_THEMES].map((t) => (
              <Button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                variant="chip"
              >
                {t === 'all' ? 'all' : (THEME_LABELS[t] ?? t)}
              </Button>
            ))}
          </div>

          <div
            data-reveal
            role="region"
            aria-label="Scrollable NASA PSI investigation table"
            tabIndex={0}
            className="mt-4 overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="font-mono text-micro lowercase tracking-eyebrow text-ink opacity-50">
                  <th className="border-b border-edge px-2 py-2 font-medium">investigation</th>
                  <th className="border-b border-edge px-2 py-2 font-medium">theme</th>
                  <th className="border-b border-edge px-2 py-2 font-medium">fuels / samples</th>
                  <th className="border-b border-edge px-2 py-2 font-medium">o₂</th>
                  <th className="border-b border-edge px-2 py-2 font-medium">flow cm/s</th>
                  <th className="border-b border-edge px-2 py-2 font-medium">runs</th>
                  <th className="border-b border-edge px-2 py-2 font-medium">verified</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const expanded = open === inv.id
                  return [
                    <tr
                      key={inv.id}
                      className="row-hover"
                    >
                      <td className="border-b border-edge px-2 py-2.5 font-mono text-tiny font-medium lowercase tracking-label text-ink">
                        <Button
                          type="button"
                          variant="row"
                          size="sm"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : inv.id)}
                          className="dataset-expand justify-start gap-2 text-left font-mono text-tiny font-medium lowercase tracking-label"
                        >
                          <span className="inline-block w-3 text-accent">
                            {expanded ? '−' : '+'}
                          </span>
                          {inv.name.toLowerCase()}
                        </Button>
                      </td>
                      <td className="border-b border-edge px-2 py-2.5 font-mono text-micro lowercase tracking-label text-ink opacity-70">
                        {inv.themes.map((t) => THEME_LABELS[t] ?? t).join(' · ')}
                      </td>
                      <td className="max-w-[220px] truncate border-b border-edge px-2 py-2.5 text-mini lowercase text-ink opacity-75">
                        {inv.fuels.join(', ')}
                      </td>
                      <td className="border-b border-edge px-2 py-2.5 font-mono text-mini text-ink opacity-75">
                        {fmtO2(inv)}
                      </td>
                      <td className="border-b border-edge px-2 py-2.5 font-mono text-mini text-ink opacity-75">
                        {fmtFlow(inv)}
                      </td>
                      <td className="border-b border-edge px-2 py-2.5 font-mono text-mini text-ink opacity-75">
                        {inv.psiRuns ?? '—'}
                      </td>
                      <td className="border-b border-edge px-2 py-2.5 font-mono text-mini">
                        <span
                          className={inv.verified ? 'text-accent' : 'text-ink opacity-40'}
                          title={inv.verified ? 'pipeline-ingested psi data' : 'curated from public literature'}
                        >
                          {inv.verified ? 'psi' : 'lit'}
                        </span>
                      </td>
                    </tr>,
                    expanded ? (
                      <tr key={`${inv.id}-detail`} className="bg-accent/4">
                        <td colSpan={7} className="border-b border-edge px-2 py-4">
                          <div className="grid gap-4 pl-8 sm:grid-cols-2 lg:grid-cols-3">
                            <div>
                              <div className="font-mono text-micro lowercase tracking-eyebrow text-accent">
                                objectives
                              </div>
                              <ul className="m-0 mt-1.5 list-none space-y-1 p-0 text-mini leading-relaxed text-ink opacity-80">
                                {inv.objectives.map((o) => (
                                  <li key={o.slice(0, 32)}>· {o}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="font-mono text-micro lowercase tracking-eyebrow text-accent">
                                rig &amp; sensors
                              </div>
                              <p className="m-0 mt-1.5 text-mini leading-relaxed text-ink opacity-80">
                                {inv.apparatus}
                              </p>
                              <ul className="m-0 mt-1.5 list-none space-y-1 p-0 text-mini leading-relaxed text-ink opacity-70">
                                {inv.sensors.map((s) => (
                                  <li key={s}>· {s}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="sm:col-span-2 lg:col-span-1">
                              <div className="font-mono text-micro lowercase tracking-eyebrow text-accent">
                                within-investigation variation
                              </div>
                              <p className="m-0 mt-1.5 text-mini leading-relaxed text-ink opacity-80">
                                <span className="opacity-60">held:</span>{' '}
                                {inv.testVariables.held.join(' · ')}
                              </p>
                              <p className="m-0 mt-1 text-mini leading-relaxed text-ink opacity-80">
                                <span className="opacity-60">varied:</span>{' '}
                                {inv.testVariables.varied.join(' · ')}
                              </p>
                              <p className="m-0 mt-2 font-mono text-micro lowercase tracking-label text-ink opacity-50">
                                {inv.platform}
                                {inv.facility ? ` · ${inv.facility}` : ''} · {inv.years}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  )
}
