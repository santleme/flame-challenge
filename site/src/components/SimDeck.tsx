import { useEffect, useRef } from 'react'
import { gsap, navigateBack } from '../lib/scroll'
import KeyedFlame from './KeyedFlame'
import { IconArrowLeft } from './Icons'
import Button from './ui/Button'
import SimConsole from './SimConsole'
import type { MissionOutcomeStatus } from './CrewTimelinePanel'

export interface MissionPreset {
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

export const MISSION_PRESETS: MissionPreset[] = [
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
    id: 'saffire-scenario',
    title: 'Guided Scenario: SAFFIRE',
    tag: '21.8% O₂ · 10.2 psia',
    accent: '#be123c',
    o2Pct: 21.8,
    flowCms: 25.0,
    gravity: 'microgravity',
    investigationId: 'saffire',
    materialId: 'cotton',
    description: 'Largest deliberate fires ever set in an uncrewed cargo vehicle — meter-scale flame spread after Cygnus departure.',
    prompt: 'Analyze SAFFIRE meter-scale flame spread over cotton-fabric samples in a ventilated uncrewed vehicle.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
  {
    id: 'flex-2-scenario',
    title: 'Guided Scenario: FLEX-2',
    tag: '12–34% O₂ · Cool Flame',
    accent: '#0369a1',
    o2Pct: 21,
    flowCms: 0.5,
    gravity: 'microgravity',
    investigationId: 'flex-2',
    materialId: 'heptane',
    description: 'Droplet combustion that exposed sustained invisible cool-flame chemistry at ~600 K after visible hot-flame extinction.',
    prompt: 'Analyze FLEX-2 droplet cool-flame persistence and the post-extinction detection gap.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
  {
    id: 'sofie-gel-scenario',
    title: 'Guided Scenario: SoFIE-GEL',
    tag: '15–24% O₂ · Quiescent',
    accent: '#047857',
    o2Pct: 17,
    flowCms: 2.0,
    gravity: 'microgravity',
    investigationId: 'sofie-gel',
    materialId: 'pmma',
    description: 'PMMA flame spread sustained at ~15% O₂ in quiescent microgravity — below Earth extinction limits.',
    prompt: 'Analyze SoFIE-GEL low-oxygen flame persistence below Earth flammability limits.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
  {
    id: 'bass-ii-scenario',
    title: 'Guided Scenario: BASS-II',
    tag: '17–40% O₂ · Opposed Flow',
    accent: '#0f766e',
    o2Pct: 21,
    flowCms: 10.0,
    gravity: 'microgravity',
    investigationId: 'bass-ii',
    materialId: 'pmma-sphere',
    description: 'Opposed-flow flame spread and extinction over solid samples across a wide oxygen and flow envelope.',
    prompt: 'Analyze BASS-II opposed-flow flame spread and extinction boundaries over solid samples.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
  {
    id: 'acme-scenario',
    title: 'Guided Scenario: ACME',
    tag: '12–85% O₂ · Coflow Jet',
    accent: '#7c3aed',
    o2Pct: 40,
    flowCms: 20.0,
    gravity: 'microgravity',
    investigationId: 'acme',
    materialId: 'ethylene',
    description: 'Laminar coflow diffusion flames mapping soot inception and growth without buoyancy distortion.',
    prompt: 'Analyze ACME ethylene coflow soot inception under elevated oxygen and E-field control.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
  {
    id: 'same-scenario',
    title: 'Guided Scenario: SAME',
    tag: '21% O₂ · Smoke Aerosol',
    accent: '#475569',
    o2Pct: 21,
    flowCms: 5.0,
    gravity: 'microgravity',
    investigationId: 'same',
    materialId: 'teflon',
    description: 'Smoke particle sizing from overheated and ignited spacecraft materials — the detector-gap dataset.',
    prompt: 'Analyze SAME smoke-aerosol signatures from overheated wire insulation for detector design.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
  {
    id: 'confined-combustion-scenario',
    title: 'Guided Scenario: Confined Combustion',
    tag: '8.3 psia · Confined Plates',
    accent: '#4338ca',
    o2Pct: 30,
    flowCms: 8.0,
    gravity: 'microgravity',
    investigationId: 'confined-combustion',
    materialId: 'thin-sheet',
    description: 'Flame spread between close parallel plates — rack/duct geometry amplified by wall heat recirculation.',
    prompt: 'Analyze confined-geometry flame spread between parallel plates at reduced pressure.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
  {
    id: 'flare-scenario',
    title: 'Guided Scenario: FLARE',
    tag: 'Partial-G · 15–40% O₂',
    accent: '#b45309',
    o2Pct: 30,
    flowCms: 15.0,
    gravity: 'lunar',
    investigationId: 'flare',
    materialId: 'pmma',
    description: 'Material flammability limits mapped at Lunar (0.17 g) and Martian (0.38 g) gravity with an on-orbit centrifuge.',
    prompt: 'Analyze FLARE partial-gravity flammability limits for lunar and martian cabin atmospheres.',
    outcomeStatus: 'MISSION ACCOMPLISHED',
  },
]

export default function SimDeck() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(
      () => gsap.from('[data-hero]', { opacity: 0, y: 14, duration: 0.6, ease: 'power2.out', stagger: 0.07 }),
      root,
    )
    return () => ctx.revert()
  }, [])

  return (
    <div ref={rootRef} data-lenis-prevent className="fixed inset-0 z-10 flex flex-col bg-bg">
      <div className="shell relative pt-24 sm:pt-28">
        <KeyedFlame
          className="inset-x-0 -top-8 h-[min(40vh,320px)]"
          strength={0.3}
          src={{ hd: '/assets/saffire5_uv.mp4', sd: '/assets/saffire5_uv_sd.mp4' }}
        />
        <header className="relative pb-2">
          <div data-hero className="eyebrow flex items-baseline justify-between gap-6 opacity-70">
            <Button asChild variant="glass" size="sm" className="lowercase">
              <a
                href="#top"
                onClick={(e) => {
                  e.preventDefault()
                  navigateBack()
                }}
              >
                <IconArrowLeft size={14} /> back
              </a>
            </Button>
            <span className="hidden cursor-default transition-colors duration-300 hover:text-accent hover:opacity-100 sm:inline">
              ignis console — live chamber uplink
            </span>
          </div>
          <h1 data-hero className="mt-6 font-display text-[clamp(2.2rem,5vw,3.8rem)] font-bold leading-display tracking-tight">
            Simulations
          </h1>
        </header>
      </div>

      {/* full-bleed agent console — thread scrolls, chips + composer pin */}
      <div className="shell flex min-h-0 flex-1 flex-col pb-5">
        <SimConsole presets={MISSION_PRESETS} />
      </div>
    </div>
  )
}
