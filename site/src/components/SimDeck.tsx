import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/scroll'
import { emitUiCommand } from '../lib/simBus'
import { riskIndexLocal, riskLevel } from '../lib/risk'
import { attachSmoothScroll } from '../lib/smoothOverlay'
import KeyedFlame from './KeyedFlame'
import Footer from './Footer'
import SimConsole from './SimConsole'
import type { MissionOutcomeStatus } from './CrewTimelinePanel'

interface MissionPreset {
  id: string
  title: string
  tag: string
  accent: string
  o2Pct: number
  flowCms: number
  gravity: 'microgravity' | 'earth' | 'lunar' | 'mars'
  investigationId: string
  materialId: string
  description: string
  prompt: string
  outcomeStatus: MissionOutcomeStatus
}

const MISSION_PRESETS: MissionPreset[] = [
  {
    id: 'apollo-1-crisis',
    title: 'Historical Crisis: Apollo 1',
    tag: '100% O₂ Norm · 16.7 psia',
    accent: '#b91c1c',
    o2Pct: 40,
    flowCms: 5.0,
    gravity: 'earth',
    investigationId: 'flare',
    materialId: 'pmma',
    description: 'Pure high-pressure oxygen atmosphere resulting in catastrophic rapid flashover.',
    prompt: 'Analyze Apollo 1 pure oxygen risk conditions with high oxidizer fraction.',
    outcomeStatus: 'MISSION ABORTED / HULL BREACH',
  },
  {
    id: 'apollo-13-crisis',
    title: 'Historical Crisis: Apollo 13',
    tag: '100% O₂ Cryo · ~900 psia',
    accent: '#c2410c',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'microgravity',
    investigationId: 'same',
    materialId: 'teflon',
    description: 'Damaged Teflon wire insulation ignited inside a stirred liquid-oxygen tank; the rupture cascaded into the adjacent tank and crippled life support.',
    prompt: 'Analyze Apollo 13 cryo oxygen tank rupture — electrical ignition inside a pressurized oxidizer propagating to adjacent modules.',
    outcomeStatus: 'MISSION ABORTED / HULL BREACH',
  },
  {
    id: 'mir-1997-crisis',
    title: 'Historical Crisis: Mir 1997',
    tag: 'Self-Oxidizing · ~14 min burn',
    accent: '#a16207',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'microgravity',
    investigationId: 'sofie-gel',
    materialId: 'pmma',
    description: 'A lithium-perchlorate oxygen generator ruptured and burned for ~14 minutes — a self-oxidizing fire that ventilation cuts could not starve.',
    prompt: 'Analyze the Mir Vika oxygen-generator fire — self-oxidizing chemical burn that defeats ventilation-cut suppression.',
    outcomeStatus: 'EMERGENCY CONTAINED',
  },
  {
    id: 'challenger-1986-crisis',
    title: 'Historical Crisis: Challenger 51-L',
    tag: 'SRB Burn-Through · T+73 s',
    accent: '#9f1239',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'earth',
    investigationId: 'bass-ii',
    materialId: 'pmma',
    description: 'A cold-degraded O-ring failed to seal the right SRB field joint — a hot-gas plume burned through to the external tank 73 s after liftoff.',
    prompt: 'Analyze Challenger 51-L SRB field-joint burn-through — hot-gas impingement escaping a failed seal into the external tank.',
    outcomeStatus: 'MISSION ABORTED / HULL BREACH',
  },
  {
    id: 'columbia-2003-crisis',
    title: 'Historical Crisis: Columbia STS-107',
    tag: 'RCC Breach · Plasma Ingress',
    accent: '#ea580c',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'earth',
    investigationId: 'confined-combustion',
    materialId: 'thin-sheet',
    description: 'A bipod-foam strike breached the left wing leading edge at launch — superheated plasma entered the RCC cavity on reentry and the orbiter broke up over Texas.',
    prompt: 'Analyze Columbia STS-107 leading-edge breach — plasma ingress into a confined RCC wing cavity during hypersonic reentry.',
    outcomeStatus: 'MISSION ABORTED / HULL BREACH',
  },
  {
    id: 'apollo-12-crisis',
    title: 'Historical Crisis: Apollo 12',
    tag: 'Lightning · T+36 s',
    accent: '#7c3aed',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'earth',
    investigationId: 'same',
    materialId: 'teflon',
    description: 'Two lightning strikes in the first minute knocked the fuel cells offline and scrambled telemetry — one switch call from the ground restored power.',
    prompt: 'Analyze Apollo 12 lightning strike — electrical discharge through a pressurized-oxygen spacecraft and the loss of fuel-cell power.',
    outcomeStatus: 'EMERGENCY CONTAINED',
  },
  {
    id: 'gemini-8-crisis',
    title: 'Historical Crisis: Gemini 8',
    tag: 'Stuck Thruster · ~1 rev/s',
    accent: '#0f766e',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'microgravity',
    investigationId: 'bass-ii',
    materialId: 'pmma',
    description: 'A thruster stuck on after the first-ever docking and spun the linked craft until Armstrong cut away from the Agena and stopped the roll with the reentry thrusters.',
    prompt: 'Analyze the Gemini 8 stuck-thruster emergency — runaway propellant burn and spin after the first orbital docking.',
    outcomeStatus: 'EMERGENCY CONTAINED',
  },
  {
    id: 'skylab-crisis',
    title: 'Historical Crisis: Skylab',
    tag: 'Shield Loss · ~52 °C',
    accent: '#b45309',
    o2Pct: 35,
    flowCms: 5.0,
    gravity: 'microgravity',
    investigationId: 'sofie-gel',
    materialId: 'pmma',
    description: 'A micrometeoroid shield tore away at launch and the station overheated; a parasol sunshade saved it, and crews later burned samples in its zero-g flammability tests.',
    prompt: 'Analyze Skylab launch damage and thermal runaway, plus the zero-gravity flammability experiments flown aboard.',
    outcomeStatus: 'EMERGENCY CONTAINED',
  },
  {
    id: 'apollo-11-crisis',
    title: 'Historical Crisis: Apollo 11',
    tag: '1202 Alarm · ~25 s of fuel',
    accent: '#0369a1',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'lunar',
    investigationId: 'flare',
    materialId: 'pmma',
    description: 'Computer overload alarms and a shrinking descent-fuel margin threatened to abort the first lunar landing seconds from touchdown.',
    prompt: 'Analyze Apollo 11 powered descent — program alarms and a thin propellant margin on approach to the lunar surface.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
]

const GRAVITY_G = { microgravity: 0, earth: 1, lunar: 0.17, mars: 0.38 } as const

/** 'Historical Crisis: Apollo 13' → { kind: 'Historical Crisis', name: 'Apollo 13' } */
function splitTitle(preset: MissionPreset) {
  const [kind, name] = preset.title.split(': ')
  return { kind, name: name ?? preset.title }
}

/** only the historical crises stay on the deck — the featured mission
 *  leads left, two stack in the rail, and the shuttle losses close the
 *  spread as a scrolling carousel */
const FEATURE = MISSION_PRESETS[0] // apollo 1
const SIDE_A = MISSION_PRESETS[3] // challenger 51-l
const SIDE_B = MISSION_PRESETS[2] // mir 1997

/** official NASA video — images-api.nasa.gov. Every plate is a short,
 *  muted loop cut from archival footage (Apollo 1 / Challenger / Columbia
 *  from the "NASA Remembers Its Fallen Heroes" montage, Mir from the
 *  Mike Foale "In Their Own Words" piece, Apollo 13 from the 1970 KSC
 *  launch reel); posters are the first frames. */
const MISSION_MEDIA = {
  feature: {
    type: 'video',
    src: '/assets/nasa/apollo1_loop.mp4',
    poster: '/assets/nasa/apollo1_loop_poster.jpg',
    alt: 'Apollo 1 command module being hoisted at the launch tower — NASA, Fallen Heroes montage',
  },
  sideA: {
    type: 'video',
    src: '/assets/nasa/apollo13_launch_loop.mp4',
    poster: '/assets/nasa/apollo13_poster.jpg',
    alt: 'Apollo 13 Saturn V ignition and liftoff — NASA KSC-19700411',
  },
  sideB: {
    type: 'video',
    src: '/assets/nasa/mir_loop.mp4',
    poster: '/assets/nasa/mir_loop_poster.jpg',
    alt: 'Mir space station exterior — NASA, Mike Foale "In Their Own Words"',
  },
  bandA: {
    type: 'video',
    src: '/assets/nasa/challenger_loop.mp4',
    poster: '/assets/nasa/challenger_loop_poster.jpg',
    alt: 'Challenger STS-51L crew walking the flight line — NASA, Fallen Heroes montage',
  },
  apollo12: {
    type: 'video',
    src: '/assets/nasa/apollo12_loop.mp4',
    poster: '/assets/nasa/apollo12_loop_poster.jpg',
    alt: 'Lightning strikes the Apollo 12 launch pad area during liftoff — NASA, Apollo 12: The Pinpoint Mission',
  },
  gemini8: {
    type: 'video',
    src: '/assets/nasa/gemini8_loop.mp4',
    poster: '/assets/nasa/gemini8_loop_poster.jpg',
    alt: 'Agena target vehicle seen from the Gemini 8 window over Earth — NASA Mercury/Gemini/Apollo resource reel',
  },
  skylab: {
    type: 'video',
    src: '/assets/nasa/skylab_loop.mp4',
    poster: '/assets/nasa/skylab_loop_poster.jpg',
    alt: 'Flame burning in microgravity during the Skylab zero-g flammability studies — NASA Glenn film',
  },
  apollo11: {
    type: 'video',
    src: '/assets/nasa/apollo11_loop.mp4',
    poster: '/assets/nasa/apollo11_loop_poster.jpg',
    alt: 'Apollo 11 Saturn V rising from the launch pad cloud — NASA KSC press-site film',
  },
  bandB: {
    type: 'video',
    src: '/assets/nasa/columbia_loop.mp4',
    poster: '/assets/nasa/columbia_loop_poster.jpg',
    alt: 'Columbia STS-107 crew walking out to the vehicle — NASA, Fallen Heroes montage',
  },
} as const

/** poster until the pointer (or keyboard focus) reaches the nearest
 *  [data-hover-media] host, then it plays; touch devices have no hover, so
 *  they loop on their own. Reduced-motion users keep the poster. */
export function HoverVideo({ src, poster, label, className }: { src: string; poster: string; label: string; className: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const play = () => void v.play().catch(() => {})
    const stop = () => v.pause()
    if (matchMedia('(hover: none)').matches) {
      const io = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : stop()), { threshold: 0.35 })
      io.observe(v)
      return () => io.disconnect()
    }
    const host = v.closest<HTMLElement>('[data-hover-media]') ?? v
    host.addEventListener('pointerenter', play)
    host.addEventListener('pointerleave', stop)
    host.addEventListener('focusin', play)
    host.addEventListener('focusout', stop)
    return () => {
      host.removeEventListener('pointerenter', play)
      host.removeEventListener('pointerleave', stop)
      host.removeEventListener('focusin', play)
      host.removeEventListener('focusout', stop)
    }
  }, [])
  return <video ref={ref} className={className} src={src} poster={poster} aria-label={label} muted loop playsInline preload="auto" />
}

export default function SimDeck() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeMission, setActiveMission] = useState<MissionPreset>(MISSION_PRESETS[0])

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

  // selecting an envelope marks it active and announces the pick on the
  // chamber bus — the console below turns each pick into a real run
  // (chat turn + live chamber); scroll it into view so the operator sees it boot
  const loadMissionPreset = (preset: MissionPreset) => {
    setActiveMission(preset)
    emitUiCommand({
      load_preset: preset.investigationId,
      set_o2_percent: preset.o2Pct,
      set_airflow_cm_s: preset.flowCms,
      set_gravity_g: GRAVITY_G[preset.gravity],
      trigger_containment: null,
      __investigation: preset.investigationId,
      __origin: 'sim-deck',
      __run: false,
    })
    document.getElementById('ignis-console')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const pickProps = (preset: MissionPreset) => ({
    type: 'button' as const,
    'aria-pressed': activeMission.id === preset.id,
    onClick: () => loadMissionPreset(preset),
  })

  const feature = splitTitle(FEATURE)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const rail = [
    [SIDE_A, splitTitle(SIDE_A), MISSION_MEDIA.bandA, '02', 'cut-slant'],
    [SIDE_B, splitTitle(SIDE_B), MISSION_MEDIA.sideB, '03', 'cut-slant'],
  ] as const
  const carousel = [
    [MISSION_PRESETS[1], MISSION_MEDIA.sideA, 'cut-rail'],
    [MISSION_PRESETS[4], MISSION_MEDIA.bandB, 'cut-slant'],
    [MISSION_PRESETS[5], MISSION_MEDIA.apollo12, 'cut-rail'],
    [MISSION_PRESETS[6], MISSION_MEDIA.gemini8, 'cut-slant'],
    [MISSION_PRESETS[7], MISSION_MEDIA.skylab, 'cut-rail'],
    [MISSION_PRESETS[8], MISSION_MEDIA.apollo11, 'cut-slant'],
  ] as const

  const renderMedia = (media: (typeof MISSION_MEDIA)[keyof typeof MISSION_MEDIA], cls: string) =>
    media.type === 'video' ? (
      <HoverVideo src={media.src} poster={media.poster} label={media.alt} className={cls} />
    ) : (
      <img className={cls} src={media.src} alt={media.alt} loading="lazy" />
    )
  const mediaCls =
    'h-full w-full object-cover grayscale contrast-110 transition-[filter,transform] duration-700 ease-out group-hover:scale-[1.04] group-hover:grayscale-0 group-focus-visible:grayscale-0'

  return (
    <div ref={rootRef} data-lenis-prevent className="fixed inset-0 z-10 overflow-y-auto overflow-x-clip overscroll-contain bg-bg">
      <div className="relative mx-auto w-[min(92vw,96rem)] pb-28 pt-32 sm:pt-40">
        <KeyedFlame
          className="-top-24 left-1/2 h-[min(72vh,640px)] w-screen -translate-x-1/2"
          strength={0.3}
          mask="[mask-image:radial-gradient(ellipse_closest-side_at_50%_45%,black_12%,transparent_100%)]"
          src={{ hd: '/assets/saffire5_uv.mp4', sd: '/assets/saffire5_uv_sd.mp4' }}
        />

        {/* ---- editorial hero ---- */}
        <header className="relative sm:pl-[clamp(1rem,6vw,7rem)]">
          <div className="grid items-end gap-x-[clamp(3rem,7vw,9rem)] gap-y-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            <div>
              <p data-hero className="card-label !text-[color-mix(in_srgb,var(--accent)_55%,var(--ink))] dark:!text-accent">Guided Scenarios &amp; Historical Crises</p>
              <h1
                data-hero
                className="mt-2 font-display text-[clamp(2.1rem,3.8vw,3.25rem)] font-bold leading-display tracking-tight"
              >
                Mission Envelopes
              </h1>
            </div>
            <p data-hero className="max-w-sm text-caption leading-[1.7] opacity-80">
              Explore historical fire crises from NASA research — one click previews the mission.
            </p>
          </div>
        </header>

        {/* ---- missions — historical crises ---- */}
        <section className="relative mt-12 sm:mt-16" aria-label="Historical missions">
          <svg width="0" height="0" aria-hidden="true" className="absolute">
            <defs>
              <clipPath id="cut-hero" clipPathUnits="objectBoundingBox">
                <path d="M0.3,0 L0.97,0 Q1,0 1,0.04 L1,0.62 Q1,0.68 0.975,0.74 L0.92,0.95 Q0.905,1 0.87,1 L0.04,1 Q0,1 0.014,0.95 L0.28,0.04 Q0.29,0 0.3,0 Z" />
              </clipPath>
              <clipPath id="cut-slant" clipPathUnits="objectBoundingBox">
                <path d="M0.2,0 L0.96,0 Q1,0 1,0.06 L1,0.94 Q1,1 0.96,1 L0.03,1 Q0,1 0.01,0.94 L0.19,0.03 Q0.195,0 0.2,0 Z" />
              </clipPath>
              <clipPath id="cut-panel" clipPathUnits="objectBoundingBox">
                <path d="M0.07,0.03 Q0.075,0 0.1,0 L0.975,0 Q1,0 1,0.05 L1,0.95 Q1,1 0.975,1 L0.03,1 Q0,1 0.006,0.95 Z" />
              </clipPath>
              <clipPath id="cut-rail" clipPathUnits="objectBoundingBox">
                <path d="M0.1,0 L0.97,0 Q1,0 0.99,0.05 L0.93,0.95 Q0.92,1 0.89,1 L0.03,1 Q0,1 0.01,0.95 L0.07,0.05 Q0.08,0 0.1,0 Z" />
              </clipPath>
            </defs>
          </svg>
          <div aria-hidden="true" className="mb-12 h-px bg-gradient-to-r from-ink/50 to-transparent dark:from-ink/30 sm:mb-16" />

          <div className="relative grid gap-x-[clamp(3rem,7vw,9rem)] gap-y-24 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            {/* featured — apollo 1: giant name across the block, copy + plate below */}
            <article data-hero className="flex min-w-0 flex-col">
              <span className="inline-block self-start bg-[#e5202e] px-3 py-1.5 font-mono text-tiny font-semibold uppercase tracking-label text-white">
                Historical Crisis
              </span>
              <h2 className="mt-4 whitespace-nowrap font-display text-[clamp(3rem,7.6vw,7rem)] font-bold leading-[0.92] tracking-tight">
                {feature.name}
              </h2>
              <div className="mt-10 grid flex-1 items-center gap-x-[clamp(2.5rem,5vw,6rem)] gap-y-12 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="min-w-0">
                  <p className="font-mono text-[clamp(0.9rem,1.3vw,1.05rem)] font-semibold text-[#e5202e]">
                    {FEATURE.tag}
                  </p>
                  <p className="mt-5 max-w-xs text-body leading-[1.8] opacity-80">{FEATURE.description}</p>
                  <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
                    <button
                      {...pickProps(FEATURE)}
                      className="inline-flex origin-center items-center gap-3 rounded-[6px] bg-[#1e3fae] px-6 py-3.5 font-mono text-caption font-semibold text-white transition-[transform,background-color] duration-500 ease-out hover:scale-[1.06] hover:bg-[#2a52d4] focus-visible:scale-[1.06] motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                    >
                      {activeMission.id === FEATURE.id ? '● Active' : 'Explore Mission'} <span aria-hidden="true">→</span>
                    </button>
                    <button
                      type="button"
                      aria-expanded={detailsOpen}
                      onClick={() => setDetailsOpen((o) => !o)}
                      className="origin-center border-b-2 border-[#1e3fae] pb-1 font-mono text-caption font-semibold transition-[transform,color] duration-500 ease-out hover:scale-[1.06] hover:text-accent focus-visible:scale-[1.06] motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                    >
                      Details
                    </button>
                  </div>
                  {detailsOpen && (
                    <p className="mt-5 max-w-xs font-mono text-tiny leading-relaxed opacity-70">
                      {FEATURE.prompt} — {FEATURE.outcomeStatus}
                    </p>
                  )}
                </div>
                <div className="relative min-w-0">
                  <div data-hover-media className="group/feat cut-hero relative origin-center transition-transform duration-500 ease-out hover:scale-[1.04] motion-reduce:transform-none h-[300px] overflow-hidden bg-black sm:h-[420px] lg:h-[500px] xl:h-[560px]">
                    <HoverVideo
                      src={MISSION_MEDIA.feature.src}
                      poster={MISSION_MEDIA.feature.poster}
                      label={MISSION_MEDIA.feature.alt}
                      className="h-full w-full object-cover grayscale contrast-125 brightness-95 transition-[filter,transform] duration-700 ease-out group-hover/feat:scale-[1.03] group-hover/feat:grayscale-0 group-hover/feat:contrast-100"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-[#1e3fae]/15 mix-blend-multiply transition-opacity duration-700 group-hover/feat:opacity-0" />
                  </div>
                </div>
              </div>
            </article>

            {/* rail — two identical panels sharing the feature's height */}
            <div className="relative flex flex-col gap-10">
              {rail.map(([preset, t, media, n, shape]) => {
                const isActive = activeMission.id === preset.id
                return (
                  <button
                    key={preset.id}
                    {...pickProps(preset)}
                    data-hero
                    data-hover-media className="group flex flex-1 origin-center text-left transition-transform duration-500 ease-out hover:scale-[1.04] focus-visible:scale-[1.04] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent motion-reduce:transform-none"
                  >
                    <span className="cut-panel grid w-full grid-cols-[minmax(0,1fr)_46%] items-center gap-3 bg-ink/[0.09] dark:bg-ink/[0.07] py-10 pl-12 pr-8 transition-colors duration-300 group-hover:bg-ink/[0.13] dark:group-hover:bg-ink/[0.1]">
                      <span className="flex h-full min-w-0 flex-col justify-between gap-6">
                        <span className="block">
                          <span className="block font-mono text-tiny uppercase tracking-label opacity-60">
                            {n} / Historical Crisis
                          </span>
                          <span
                            className="mt-2 block font-display text-[clamp(1.5rem,2.2vw,2.25rem)] font-bold leading-[1.05] tracking-tight transition-colors duration-300 group-hover:text-accent"
                            style={isActive ? { color: preset.accent } : undefined}
                          >
                            {t.name}
                          </span>
                          <span className="mt-3 block font-mono text-tiny font-semibold text-[#e5202e]">
                            {isActive ? '● active' : preset.tag}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="grid size-10 shrink-0 place-items-center rounded-full border border-[#1e3fae] font-mono text-caption text-[#1e3fae] transition-colors duration-300 group-hover:bg-[#1e3fae] group-hover:text-white"
                        >
                          →
                        </span>
                      </span>
                      <span className={`${shape} block h-48 overflow-hidden bg-black sm:h-60`}>
                        {renderMedia(media, mediaCls)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* carousel — the other crises scroll past; pauses on hover / focus */}
          <div className="mission-bleed relative mt-24 pt-16 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-ink/50 before:to-transparent dark:before:from-ink/30 sm:mt-32">
            <p className="mb-10 font-mono text-tiny uppercase tracking-label opacity-60">
              More historical crises <span aria-hidden="true">→</span>
            </p>
            <div className="marquee bleed-both">
              <div className="marquee-track">
                {[0, 1].map((copy) => (
                  <ul key={copy} className="marquee-group" aria-hidden={copy === 1 || undefined}>
                    {carousel.map(([preset, media, shape], i) => {
                      const t = splitTitle(preset)
                      const isActive = activeMission.id === preset.id
                      return (
                        <li key={preset.id} className="marquee-item">
                          <button
                            {...pickProps(preset)}
                            tabIndex={copy === 1 ? -1 : undefined}
                            data-hover-media
                            className="group flex h-full w-full origin-center flex-col text-left transition-transform duration-500 ease-out hover:scale-[1.06] focus-visible:scale-[1.06] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent motion-reduce:transform-none"
                          >
                            <span className={`${shape} block h-48 overflow-hidden bg-black sm:h-56`}>
                              {renderMedia(media, mediaCls)}
                            </span>
                            <span className="mt-6 flex min-w-0 flex-1 items-start justify-between gap-4">
                              <span className="min-w-0">
                                <span className="block font-mono text-tiny uppercase tracking-label opacity-60">
                                  {String(i + 4).padStart(2, '0')} / Historical Crisis
                                </span>
                                <span
                                  className="mt-1 block font-display text-[clamp(1.5rem,2.3vw,2rem)] font-bold leading-display tracking-tight transition-colors duration-300 group-hover:text-accent"
                                  style={isActive ? { color: preset.accent } : undefined}
                                >
                                  {t.name}
                                </span>
                                <span className="mt-2 block font-mono text-tiny font-semibold text-[#1e3fae]">
                                  {isActive ? '● active' : preset.tag}
                                </span>
                                <span className="mt-3 line-clamp-3 block text-caption leading-relaxed opacity-75">
                                  {preset.description}
                                </span>
                              </span>
                              <span
                                aria-hidden="true"
                                className="mt-2 grid size-10 shrink-0 place-items-center rounded-full border border-[#1e3fae] font-mono text-caption text-[#1e3fae] transition-colors duration-300 group-hover:bg-[#1e3fae] group-hover:text-white"
                              >
                                →
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---- mission risk board — every preset scored by the local
                engine mirror, macOS-widget minimal: one number per tile ---- */}
        <section aria-label="Mission risk comparison" className="relative mt-24 sm:mt-32">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 className="font-display text-2xl font-bold sm:text-3xl">
              Mission risk board
            </h2>
            <span className="font-mono text-micro lowercase tracking-eyebrow opacity-50">
              live engine · tap to simulate
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[...MISSION_PRESETS]
              .map((preset) => ({
                preset,
                risk: riskIndexLocal(
                  preset.materialId,
                  preset.o2Pct,
                  preset.flowCms,
                  preset.gravity,
                ),
              }))
              .sort((a, b) => b.risk.riskIndex - a.risk.riskIndex)
              .map(({ preset, risk: r }) => {
              const pct = Math.round(r.riskIndex * 100)
              const isActive = activeMission.id === preset.id
              return (
                <button
                  key={preset.id}
                  {...pickProps(preset)}
                  className={`group rounded-card border p-5 text-left shadow-sm backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg sm:p-6 ${
                    isActive ? 'border-accent/60 bg-accent/5' : 'border-edge panel-85'
                  }`}
                >
                  <div
                    className="font-display text-5xl font-bold leading-none tracking-tight sm:text-6xl"
                    style={{ color: preset.accent }}
                  >
                    {pct}
                    <span className="text-2xl font-semibold opacity-60">%</span>
                  </div>
                  <div className="mt-3 font-display text-base font-semibold leading-tight sm:text-lg">
                    {splitTitle(preset).name}
                  </div>
                  <div className="mt-1 font-mono text-tiny lowercase tracking-label opacity-60">
                    {riskLevel(r.riskIndex)}
                    {isActive ? ' · ●' : ''}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* ---- live console — chat + flame composer under the envelopes ---- */}
        <section id="ignis-console" aria-label="Ignis console" className="relative mt-24 flex h-[85vh] min-h-[560px] flex-col scroll-mt-16 sm:mt-32">
          <SimConsole presets={MISSION_PRESETS} />
        </section>
      </div>
      <Footer />
    </div>
  )
}
