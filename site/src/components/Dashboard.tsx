import { useEffect, useMemo, useRef, useState } from 'react'
import {
  HEADLINE_EXPLORATION_FINDINGS,
} from '../lib/generatedDashboards'
import { DATASET_STATS } from '../lib/dashboard'
import { gsap, navigate } from '../lib/scroll'
import { attachSmoothScroll } from '../lib/smoothOverlay'
import { cn } from '../lib/cn'
import { IconArrowUpRight } from './Icons'
import KeyedFlame from './KeyedFlame'
import { HoverVideo } from './SimDeck'
import MissionReportsPanel from './MissionReportsPanel'
import Footer from './Footer'

/** one official NASA clip per finding, in HEADLINE_EXPLORATION_FINDINGS order */
const FINDING_MEDIA = [
  {
    src: '/assets/sofie_flame.mp4',
    poster: '/assets/sofie_poster.jpg',
    caption: 'SoFIE-GEL flame in microgravity — NASA',
  },
  {
    src: '/assets/saffire5_uv_sd.mp4',
    poster: '/assets/nasa/saffire5_uv_poster.jpg',
    caption: 'Saffire-V flame, UV channel — NASA',
  },
  {
    src: '/assets/nasa/acme_loop.mp4',
    poster: '/assets/nasa/acme_loop_poster.jpg',
    caption: 'ACME microgravity flame — NASA Glenn',
  },
  {
    src: '/assets/nasa/soot_loop.mp4',
    poster: '/assets/nasa/soot_loop_poster.jpg',
    caption: 'Glowing soot clusters in a microgravity flame — NASA',
  },
  {
    src: '/assets/nasa/droptower_loop.mp4',
    poster: '/assets/nasa/droptower_loop_poster.jpg',
    caption: 'Zero-G Drop Tower, NASA Glenn',
  },
] as const

const blueBtn =
  'inline-flex origin-center items-center gap-3 rounded-[6px] bg-[#1e3fae] px-6 py-3.5 font-mono text-caption font-semibold text-white transition-[transform,background-color] duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)] will-change-transform hover:scale-[1.03] hover:bg-[#2a52d4] focus-visible:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent motion-reduce:transform-none'

function SectionHead({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="m-0 scroll-mt-12 font-display text-[clamp(1.6rem,2.6vw,2.25rem)] font-bold leading-display tracking-tight">
      {title}
    </h2>
  )
}

export default function Dashboard() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [finding, setFinding] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('[data-hero]', { opacity: 0, y: 14, duration: 0.6, ease: 'power2.out', stagger: 0.07 })
    }, root)
    return () => ctx.revert()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    return root ? attachSmoothScroll(root) : undefined
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      const hash = location.hash.slice(1)
      if (hash === 'dashboard-reports' || hash === 'mission-reports') {
        const el = document.getElementById('dashboard-reports') || document.getElementById('mission-reports')
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    const timer = setTimeout(handleScroll, 120)
    window.addEventListener('hashchange', handleScroll)
    window.addEventListener('ignis:route', handleScroll)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('hashchange', handleScroll)
      window.removeEventListener('ignis:route', handleScroll)
    }
  }, [])

  const f = HEADLINE_EXPLORATION_FINDINGS[finding]
  const stats = useMemo(
    () => [
      [DATASET_STATS.investigations, 'investigations'],
      [DATASET_STATS.psiRuns, 'parsed PSI runs'],
      [DATASET_STATS.verified, 'pipeline-verified'],
    ],
    [],
  )

  return (
    <div ref={rootRef} data-lenis-prevent className="fixed inset-0 z-10 overflow-y-auto overflow-x-clip overscroll-contain bg-bg">
      <div className="relative mx-auto w-[min(92vw,96rem)] pb-28 pt-32 sm:pt-40">
        <svg width="0" height="0" aria-hidden="true" className="absolute">
          <defs>
            <clipPath id="dash-cut-hero" clipPathUnits="objectBoundingBox">
              <path d="M0.3,0 L0.97,0 Q1,0 1,0.04 L1,0.62 Q1,0.68 0.975,0.74 L0.92,0.95 Q0.905,1 0.87,1 L0.04,1 Q0,1 0.014,0.95 L0.28,0.04 Q0.29,0 0.3,0 Z" />
            </clipPath>
            <clipPath id="dash-cut-panel" clipPathUnits="objectBoundingBox">
              <path d="M0.07,0.03 Q0.075,0 0.1,0 L0.975,0 Q1,0 1,0.05 L1,0.95 Q1,1 0.975,1 L0.03,1 Q0,1 0.006,0.95 Z" />
            </clipPath>
          </defs>
        </svg>

        <KeyedFlame
          className="-top-24 left-1/2 h-[min(72vh,640px)] w-screen -translate-x-1/2"
          strength={0.3}
          mask="[mask-image:radial-gradient(ellipse_closest-side_at_50%_45%,black_12%,transparent_100%)]"
          src={{ hd: '/assets/saffire5_uv.mp4', sd: '/assets/saffire5_uv_sd.mp4' }}
        />

        {/* ---- masthead ---- */}
        <header className="relative">
          <div className="grid items-end gap-x-[clamp(3rem,7vw,9rem)] gap-y-8 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            <div>
              <p data-hero className="card-label !text-[color-mix(in_srgb,var(--accent)_55%,var(--ink))] dark:!text-[color-mix(in_srgb,var(--accent)_55%,var(--ink))] dark:text-accent">
                IGNIS · NASA PSI Flight Safety Intelligence
              </p>
              <h1
                data-hero
                className="mt-2 font-display text-[clamp(2.4rem,5vw,4.5rem)] font-bold leading-[0.95] tracking-tight"
              >
                Mission Safety Dashboard
              </h1>
            </div>
            <div data-hero>
              <p className="max-w-sm text-caption leading-[1.7] opacity-90 dark:opacity-80">
                Schema-driven flight certification briefs generated from 30 years of NASA microgravity combustion
                experiments, C++20 physical boundary models, and crew survival protocols.
              </p>
              <button type="button" onClick={() => navigate('#simulations')} className={cn(blueBtn, 'mt-6')}>
                Run Live Simulation <IconArrowUpRight size={16} />
              </button>
            </div>
          </div>

          <div data-hero className="mt-10 border-t border-ink/30 dark:border-edge pt-6">
            <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
              {stats.map(([v, k]) => (
                <div key={k}>
                  <dd className="m-0 font-display text-2xl font-bold tabular-nums tracking-tight">{v}</dd>
                  <dt className="font-mono text-tiny uppercase tracking-label opacity-75 dark:opacity-60">{k}</dt>
                </div>
              ))}
            </dl>
          </div>
        </header>

        {/* ---- 01 headline findings ---- */}
        <section className="relative mt-16 sm:mt-20" aria-label="Headline findings">
          <SectionHead id="findings" title="What the corpus tells us" />

          <div className="relative mt-8 grid gap-x-[clamp(2rem,5vw,6rem)] gap-y-10 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            <article key={f.id} className="rise-in flex min-w-0 flex-col">
              <span className="inline-block self-start bg-[#e5202e] px-3 py-1.5 font-mono text-tiny font-semibold uppercase tracking-label text-white">
                {f.badge}
              </span>
              <h3 className="m-0 mt-4 font-display text-[clamp(1.8rem,3.4vw,3rem)] font-bold leading-[0.98] tracking-tight">
                {f.title}
              </h3>
              <div className="mt-6 grid flex-1 items-start gap-x-[clamp(2.5rem,5vw,6rem)] gap-y-12 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="min-w-0">
                  <p className="m-0 text-body leading-[1.8] opacity-95 dark:opacity-85">{f.finding}</p>
                  <p className="mt-4 font-mono text-micro opacity-75 dark:opacity-60">{f.code} · {f.psiProof}</p>
                </div>
                <div data-hover-media className="min-w-0">
                  <div
                    style={{ clipPath: 'url(#dash-cut-hero)' }}
                    className="group/feat relative h-[220px] origin-center overflow-hidden bg-black transition-transform duration-500 ease-out hover:scale-[1.04] motion-reduce:transform-none sm:h-[280px] lg:h-[320px]"
                  >
                    <HoverVideo
                      key={f.id}
                      src={FINDING_MEDIA[finding].src}
                      poster={FINDING_MEDIA[finding].poster}
                      label={FINDING_MEDIA[finding].caption}
                      className="h-full w-full object-cover grayscale contrast-125 brightness-95 transition-[filter,transform] duration-700 ease-out group-hover/feat:scale-[1.03] group-hover/feat:grayscale-0 group-hover/feat:contrast-100"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-[#1e3fae]/15 mix-blend-multiply transition-opacity duration-700 group-hover/feat:opacity-0" />
                  </div>
                  <p className="mt-2 font-mono text-micro opacity-70 dark:opacity-55">{FINDING_MEDIA[finding].caption}</p>
                </div>
              </div>
            </article>


            <ol className="finding-carousel m-0 flex list-none flex-col gap-2 p-0" role="tablist" aria-label="Headline findings">
              {HEADLINE_EXPLORATION_FINDINGS.map((item, i) => {
                const on = finding === i
                return (
                  <li key={item.id} className="flex flex-1">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setFinding(i)}
                      style={{ clipPath: 'url(#dash-cut-panel)' }}
                      className={cn(
                        'group flex w-full origin-center items-center gap-4 py-3 pl-10 pr-6 text-left transition-[background-color,transform] duration-500 ease-out motion-reduce:transform-none',
                        on
                          ? 'scale-[1.03] bg-ink/[0.3] dark:bg-ink/[0.2]'
                          : 'bg-ink/[0.11] hover:scale-[1.02] hover:bg-ink/[0.17] dark:bg-ink/[0.07] dark:hover:bg-ink/[0.11]',
                      )}
                    >
                      <span className="relative grid size-10 shrink-0 place-items-center">
                        <svg viewBox="0 0 48 48" aria-hidden="true" className="absolute inset-0 size-full">
                          <rect x="1.5" y="1.5" width="45" height="45" rx="10" pathLength="100" fill="none" strokeWidth="2" className="stroke-ink/25" />
                          {on && (
                            <rect
                              key={finding}
                              x="1.5"
                              y="1.5"
                              width="45"
                              height="45"
                              rx="10"
                              pathLength="100"
                              fill="none"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              className="finding-timer stroke-[#e5202e]"
                              onAnimationEnd={() => setFinding((v) => (v + 1) % HEADLINE_EXPLORATION_FINDINGS.length)}
                            />
                          )}
                        </svg>
                        <span className={cn('font-mono text-tiny font-bold tabular-nums', on ? 'text-[#e5202e]' : 'opacity-75 dark:opacity-60')}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block font-display text-base font-bold leading-snug tracking-tight transition-colors group-hover:text-accent',
                            on && 'text-[#e5202e]',
                          )}
                        >
                          {item.title}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-full border border-[#1e3fae] font-mono text-caption text-[#1e3fae] transition-colors group-hover:bg-[#1e3fae] group-hover:text-white"
                      >
                        →
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        {/* ---- 02 generated mission reports ---- */}
        <section id="dashboard-reports" className="relative mt-16 sm:mt-20 scroll-mt-16" aria-label="Generated mission reports">
          <MissionReportsPanel />
        </section>
      </div>
      <Footer />
    </div>
  )
}
