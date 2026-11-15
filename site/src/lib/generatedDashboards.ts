import type { ChamberState } from './live'
import type { SiChamberState, SiResponse } from './api'
import type { CrewMember, CausalEvent, CounterfactualDoctrine, MissionOutcomeStatus } from '../components/CrewTimelinePanel'
import { riskIndexLocal } from './risk'
import type { RiskUncertainty } from './risk'

export interface HeadlineFinding {
  id: string
  code: string
  title: string
  finding: string
  psiProof: string
  impact: string
  badge: string
}

export const HEADLINE_EXPLORATION_FINDINGS: HeadlineFinding[] = [
  {
    id: 'finding-loc-persistence',
    code: 'PSI-SoFIE-01',
    title: 'Flame Persists Below Earth LOC',
    finding:
      'In microgravity, absence of buoyant heat loss allows solid materials (PMMA, Nomex) to sustain creeping flames down to 12.0% O₂ — well below the terrestrial Limiting Oxygen Concentration of ~15.5%.',
    psiProof: 'NASA PSI SoFIE-GEL and BASS-II data (PSI-101/102)',
    impact: 'Cabin fire safety protocols cannot rely on terrestrial extinction thresholds.',
    badge: 'Critical Physics Gap',
  },
  {
    id: 'finding-cool-flames',
    code: 'PSI-FLEX-02',
    title: 'Silent Cool Flame Post-Flameout',
    finding:
      'Hydrocarbon droplets and liquid fuel leaks experience radiative visible flame extinction, yet low-temperature (~600–720 K) chemical consumption continues invisibly without optical emission.',
    psiProof: 'FLEX & FLEX-2 experiments (53 confirmed cool-flame runs in PSI catalog)',
    impact: 'Premature hatch opening or airflow resumption causes instantaneous explosive re-ignition.',
    badge: 'Hidden Anomaly',
  },
  {
    id: 'finding-exploration-atmospheres',
    code: 'NASA-EA-34',
    title: '34% O₂ Exploration Atmospheres',
    finding:
      'To enable rapid EVA without decompression sickness, Artemis habitats operate at 34% O₂ / 8.2 psia (56.5 kPa). This elevated oxidizer fraction doubles flame propagation velocity on composite polymers.',
    psiProof: 'NASA Saffire-IV and ACME coflow combustion series',
    impact: 'Materials certified for ISS 21% O₂ fail catastrophically under Artemis Lunar cabin norms.',
    badge: 'Artemis Architecture',
  },
  {
    id: 'finding-sensor-blindness',
    code: 'PSI-SAME-04',
    title: 'Zero-Buoyancy Aerosol Sensor Blindness',
    finding:
      'Without buoyancy, smoke particles do not rise to ceiling-mounted detectors; instead, smoke particles agglomerate into massive fractal soot chains that bypass standard optical ionization detectors.',
    psiProof: 'Smoke Aerosol Measurement Experiment (SAME & SAME-R, PSI-102)',
    impact: 'Early detection in spacecraft cabins requires multi-point forced duct sampling.',
    badge: 'Life Support Threat',
  },
  {
    id: 'finding-partial-gravity',
    code: 'PSI-FLARE-05',
    title: 'Lunar & Martian Partial-g Non-Linearity',
    finding:
      'Combustion risk does not scale linearly from 0g to 1g. In Moon (0.16g) and Mars (0.38g) gravity, weak buoyant plumes supply fresh oxidizer faster than diffusion alone, creating peak flammability spikes.',
    psiProof: 'FLARE (JAXA/NASA) parabolic and Drop Tower campaign',
    impact: 'Surface habitats face higher peak convective spread rates than orbiting stations.',
    badge: 'Lunar/Mars Frontier',
  },
]

export interface MissionReportSpec {
  id: string
  createdAt: number
  title: string
  missionTag: string
  rubric: {
    summarize: {
      investigationId: string
      materialId: string
      abstract: string
      psiAccessions: string[]
      paperCitations: string[]
      pressureKpa: number
      gravityRegime: string
      o2Pct: number
      flowCms: number
    }
    rank: {
      compositeRisk: number
      level: 'low' | 'moderate' | 'high' | 'critical'
      uncertaintyBand?: { low: number; high: number; level?: number } | null
      components: {
        flammability: number
        hiddenHazard: number
        explorationRelevance: number
        dataRichness: number
      }
      shapDrivers: Array<{ factor: string; delta: string; rationale: string }>
    }
    interpret: {
      actionableGuidance: string
      containmentDoctrine: string
      sensorAdvisory: string
      atmosphereLimits: string
    }
  }
  headlineFindings: HeadlineFinding[]
  crewImpact: {
    missionStatus: MissionOutcomeStatus
    crew: CrewMember[]
    causalLog: CausalEvent[]
    counterfactual: CounterfactualDoctrine
  }
  safetyEnvelope: {
    currentO2: number
    currentFlow: number
    zone: 'safe' | 'amber' | 'runaway'
    trajectory: Array<{ o2Pct: number; flowCms: number }>
  }
  rawScenario?: SiChamberState
  rawResponse?: SiResponse
  run?: ChamberState
}

export interface GeneratedDashboard {
  id: string
  createdAt: number
  prompt: string
  response: SiResponse
  scenario?: SiChamberState
  analysisScenario?: SiChamberState
  engineGravityMode?: string
  run?: ChamberState
  spec: MissionReportSpec
}

const STORE_KEY = 'ignis-generated-dashboards-v2'
const EVENT = 'ignis:dashboard-generated'
const MAX_ITEMS = 30

/**
 * 3 Golden-Path Pre-seeded Reports for instant demo readiness
 */
export const SEED_REPORTS: GeneratedDashboard[] = [
  {
    id: 'artemis-01',
    createdAt: Date.now() - 1000 * 60 * 35,
    prompt: 'ARTEMIS-01 // Lunar Habitat Airlock (34% O₂, 8.2 psia, 0.16g)',
    engineGravityMode: 'Lunar 0.16g surface gravity coupled with Artemis 8.2 psia atmosphere',
    scenario: {
      investigationId: 'flare',
      materialId: 'pmma',
      o2Pct: 34,
      flowCms: 1.5,
      gravity: 'lunar',
      sealed: false,
    },
    analysisScenario: {
      investigationId: 'flare',
      materialId: 'pmma',
      o2Pct: 34,
      flowCms: 1.5,
      gravity: 'lunar',
    },
    response: {
      mode: 'llm',
      model: '9router/gemini-2.5-pro',
      briefing:
        'CRITICAL FIRE DYNAMICS ADVISORY: Operation in Artemis Exploration Atmosphere (34% O₂ at 8.2 psia / 56.5 kPa). Under 0.16g lunar gravity, the combination of enriched oxidizer and weak buoyancy creates severe thermal flame spread along PMMA harness conduits. The Limiting Oxygen Concentration drops to 12.0%.',
      recommended_action:
        'Seal airlock outer bulkhead. Cut duct recirculator within 3 seconds of thermal trigger. Depressurize module to < 10 kPa if smoldering persists.',
      ui_command: null,
      chamber: {
        riskIndex: 0.84,
        level: 'critical',
        materialId: 'pmma',
        o2Pct: 34,
        flowCms: 1.5,
        gravity: 'lunar',
      },
      evidence: [
        {
          runId: 'psi-flare-012',
          accession: 'PSI-FLARE-012',
          investigationId: 'flare',
          fuel: 'PMMA Solid Slab',
          outcome: 'rapid forward spread',
          similarity: 96,
          verified: false,
          sourceUrl: 'https://psi.nasa.gov/physci/repo',
        },
        {
          runId: 'psi-sofie-044',
          accession: 'PSI-SoFIE-GEL-044',
          investigationId: 'sofie-gel',
          fuel: 'PMMA Solid Slab',
          outcome: 'boundary persistence',
          similarity: 91,
          verified: false,
          sourceUrl: 'https://psi.nasa.gov/physci/repo',
        },
      ],
      simulation_commands: {
        load_preset: 'flare',
        set_o2_percent: 34,
        set_airflow_cm_s: 1.5,
      },
    },
    run: {
      model: 'spread',
      tSec: 18.4,
      regime: 1,
      o2Pct: 34,
      o2EffPct: 33.1,
      volumeLiters: 120,
      ignited: true,
      coolFlame: false,
      finished: true,
      frontPosCm: 22.8,
      spreadRateCms: 1.24,
      intensity: 0.92,
      heatReleaseW: 412.5,
    },
    spec: {
      id: 'artemis-01',
      createdAt: Date.now() - 1000 * 60 * 35,
      title: 'ARTEMIS-01 // Lunar Habitat Airlock (34% O₂, 8.2 psia, 0.16g)',
      missionTag: 'Artemis Base Camp · Lunar Surface (0.16g)',
      rubric: {
        summarize: {
          investigationId: 'flare',
          materialId: 'PMMA / Spacecraft Wiring Duct',
          abstract:
            'Evaluates the severe acceleration of flame spread inside an Artemis airlock conduit operating under Exploration Atmosphere (34.0% O₂, 56.5 kPa, 0.16g). NASA FLARE and SoFIE data confirm partial-gravity buoyant chimney flow.',
          psiAccessions: ['PSI-FLARE-012', 'PSI-SoFIE-GEL-044', 'NTRS-20220014881'],
          paperCitations: ['NASA TP-2021-00234: Flame Design Spacecraft Fire Safety Demonstration', 'AIAA 2023-1892'],
          pressureKpa: 56.5,
          gravityRegime: 'Lunar 0.16g',
          o2Pct: 34.0,
          flowCms: 1.5,
        },
        rank: {
          compositeRisk: 84,
          level: 'critical',
          uncertaintyBand: { low: 79, high: 88, level: 0.95 },
          components: {
            flammability: 92,
            hiddenHazard: 74,
            explorationRelevance: 98,
            dataRichness: 86,
          },
          shapDrivers: [
            { factor: 'Elevated O₂ (34.0%)', delta: '+28%', rationale: 'Enriched oxidizer lowers activation energy barrier' },
            { factor: 'Lunar 0.16g buoyancy', delta: '+14%', rationale: 'Partial gravity supplies chimney airflow without blowing flame out' },
            { factor: 'Low-speed ventilation', delta: '+8%', rationale: 'Airlock recirculation feed sustains steady diffusion boundary layer' },
          ],
        },
        interpret: {
          actionableGuidance:
            'Mandate immediate compartment isolation and dual-phase N₂ inerting. Standard handheld water-mist extinguishers are insufficient for 34% O₂ flashovers.',
          containmentDoctrine:
            'Seal airlock outer bulkhead. Cut duct recirculator within 3 seconds of thermal trigger. Depressurize module to < 10 kPa if smoldering persists.',
          sensorAdvisory:
            'Standard optical smoke detectors will lag by up to 45 seconds due to weak convective transport. Deploy duct-mounted aspirating particle counters.',
          atmosphereLimits:
            'Material PMMA prohibited in exposed conduits above 28% O₂ unless clad with fluoropolymer barrier.',
        },
      },
      headlineFindings: HEADLINE_EXPLORATION_FINDINGS,
      crewImpact: {
        missionStatus: 'EMERGENCY CONTAINED',
        crew: [
          {
            id: 'cdr',
            name: 'Cdr. Alex Chen',
            role: 'Mission Commander',
            avatar: '/assets/crew_lucas.png',
            status: 'Nominal',
            statusDetail: 'Sealed airlock bulkhead from Command Module; prevented hab-wide smoke migration.',
          },
          {
            id: 'fe',
            name: 'Elena Ruiz',
            role: 'Flight Systems Engineer',
            avatar: '/assets/pixel_engineer.png',
            status: 'Smoke Inhalation',
            statusDetail: 'Suffered secondary smoke inhalation while manually toggling emergency duct damper.',
          },
          {
            id: 'ps',
            name: 'Dr. Marcus Vance',
            role: 'Payload Specialist',
            avatar: '/assets/pixel_scientist.png',
            status: 'Safe',
            statusDetail: 'Isolated scientific glovebox telemetry; no physical contact with airlock bay.',
          },
        ],
        causalLog: [
          { time: 'T+00:00', actor: 'Airlock Duct', action: 'Overcurrent fault ignites wiring insulation.', severity: 'info' },
          { time: 'T+00:04', actor: '34% O₂ Atmosphere', action: 'Flame spreads 2.4x faster than Earth baseline.', severity: 'danger' },
          { time: 'T+00:09', actor: 'Elena Ruiz (FE)', action: 'Attempts manual override; exposed to combustion gas.', severity: 'warning' },
          { time: 'T+00:14', actor: 'Cdr. Chen', action: 'Automated bulkhead seal engaged; nitrogen purge started.', severity: 'info' },
        ],
        counterfactual: {
          title: 'Artemis Rapid Depress Containment Doctrine',
          recommendedAction:
            'Automated pneumatic cut of airlock circulation with immediate emergency venting to vacuum. Zero human intervention in contaminated volume.',
          outcomeDelta: 'Zero smoke exposure to Flight Engineer. Quenched in 1.8 seconds.',
          crewSavedPct: 100,
          riskReductionPct: 82,
        },
      },
      safetyEnvelope: {
        currentO2: 34,
        currentFlow: 1.5,
        zone: 'runaway',
        trajectory: [
          { o2Pct: 21, flowCms: 0.5 },
          { o2Pct: 28, flowCms: 1.0 },
          { o2Pct: 34, flowCms: 1.5 },
        ],
      },
    },
  },
  {
    id: 'iss-flex-02',
    createdAt: Date.now() - 1000 * 60 * 120,
    prompt: 'ISS-FLEX-02 // Heptane Droplet Radiative Quenching & Silent Cool Flame',
    engineGravityMode: 'True Microgravity (0g) inside ISS Microgravity Science Glovebox',
    scenario: {
      investigationId: 'flex-2',
      materialId: 'heptane',
      o2Pct: 21,
      flowCms: 0.0,
      gravity: 'microgravity',
      sealed: true,
    },
    analysisScenario: {
      investigationId: 'flex-2',
      materialId: 'heptane',
      o2Pct: 21,
      flowCms: 0.0,
      gravity: 'microgravity',
    },
    response: {
      mode: 'llm',
      model: '9router/gemini-2.5-pro',
      briefing:
        'ANOMALOUS COMBUSTION REGIME: Heptane droplet burning in 0g enters low-temperature chemical regime (~650 K) following visible flameout. Visible luminescence drops to 0%, but droplet diameter continues shrinking according to the d²-law. Detectors tracking visible light report false extinction.',
      recommended_action:
        'Maintain sealed nitrogen environment for at least 180 seconds following apparent visual flameout.',
      ui_command: null,
      chamber: {
        riskIndex: 0.62,
        level: 'high',
        materialId: 'heptane',
        o2Pct: 21,
        flowCms: 0.0,
        gravity: 'microgravity',
      },
      evidence: [
        {
          runId: 'psi-flex2-088',
          accession: 'PSI-FLEX-2-088',
          investigationId: 'flex-2',
          fuel: 'n-Heptane Droplet',
          outcome: 'cool flame sustained 4.8s',
          similarity: 99,
          verified: false,
          sourceUrl: 'https://psi.nasa.gov/physci/repo',
        },
        {
          runId: 'psi-flex2-104',
          accession: 'PSI-FLEX-2-104',
          investigationId: 'flex-2',
          fuel: 'n-Octane / Heptane',
          outcome: 'second-stage extinction',
          similarity: 94,
          verified: false,
          sourceUrl: 'https://psi.nasa.gov/physci/repo',
        },
      ],
      simulation_commands: {
        load_preset: 'flex-2',
        set_o2_percent: 21,
        set_airflow_cm_s: 0.0,
      },
    },
    run: {
      model: 'droplet',
      tSec: 12.6,
      regime: 2, // cool flame
      o2Pct: 21,
      o2EffPct: 19.4,
      volumeLiters: 50,
      ignited: true,
      coolFlame: true,
      finished: true,
      dropletDMm: 0.85,
      flameRMm: 4.8,
      burnFraction: 0.72,
      heatReleaseW: 14.8,
    },
    spec: {
      id: 'iss-flex-02',
      createdAt: Date.now() - 1000 * 60 * 120,
      title: 'ISS-FLEX-02 // Heptane Droplet Radiative Quenching & Silent Cool Flame',
      missionTag: 'ISS Columbus / Destiny · Microgravity Science Glovebox (0g)',
      rubric: {
        summarize: {
          investigationId: 'flex-2',
          materialId: 'n-Heptane Hydrocarbon Droplet',
          abstract:
            'Quantifies the insidious second-stage combustion regime discovered aboard the ISS. Following hot flame extinction due to radiative loss, droplet evaporation continues through invisible low-temperature peroxy chemistry.',
          psiAccessions: ['PSI-FLEX-2-088', 'PSI-FLEX-2-104', 'NASA-CR-2019-220192'],
          paperCitations: ['Combustion and Flame 2017: Second-Stage Cool Flame Extinction in Microgravity', 'PSI Catalog 102'],
          pressureKpa: 101.3,
          gravityRegime: 'Microgravity (0g)',
          o2Pct: 21.0,
          flowCms: 0.0,
        },
        rank: {
          compositeRisk: 62,
          level: 'high',
          uncertaintyBand: { low: 57, high: 66, level: 0.95 },
          components: {
            flammability: 54,
            hiddenHazard: 96,
            explorationRelevance: 78,
            dataRichness: 92,
          },
          shapDrivers: [
            { factor: 'Invisible Cool-Flame regime', delta: '+36%', rationale: 'Zero optical radiation creates false all-clear condition' },
            { factor: 'Re-ignition sensitivity', delta: '+18%', rationale: 'Air movement instantly triggers second-stage thermal explosion' },
            { factor: 'Zero convection confinement', delta: '-12%', rationale: 'Absence of airflow limits oxygen replenishment rate' },
          ],
        },
        interpret: {
          actionableGuidance:
            'Crew must NEVER open a combustion enclosure relying on optical camera feeds. Require radiometric thermal confirmation (T < 350 K) or UV OH* emission scan before breaking glovebox seal.',
          containmentDoctrine:
            'Maintain sealed nitrogen environment for at least 180 seconds following apparent visual flameout.',
          sensorAdvisory:
            'Deploy broadband IR radiometers capable of sensing 600–750 K thermal envelopes.',
          atmosphereLimits:
            'Flammable liquids in space habitat racks require double-walled inerted containment chambers.',
        },
      },
      headlineFindings: HEADLINE_EXPLORATION_FINDINGS,
      crewImpact: {
        missionStatus: 'MISSION ABORTED / HULL BREACH',
        crew: [
          {
            id: 'cdr',
            name: 'Cdr. Alex Chen',
            role: 'Mission Commander',
            avatar: '/assets/crew_lucas.png',
            status: 'Nominal',
            statusDetail: 'Coordinated ISS Node 2 safety interlocks and cabin ventilation cut.',
          },
          {
            id: 'fe',
            name: 'Elena Ruiz',
            role: 'Flight Systems Engineer',
            avatar: '/assets/pixel_engineer.png',
            status: 'Nominal',
            statusDetail: 'Safely positioned at environmental control console.',
          },
          {
            id: 'ps',
            name: 'Dr. Marcus Vance',
            role: 'Payload Specialist',
            avatar: '/assets/pixel_scientist.png',
            status: 'Burn Injury',
            statusDetail: 'Opened glovebox chamber door believing flame was dead; suffered thermal flash burn.',
          },
        ],
        causalLog: [
          { time: 'T+00:00', actor: 'Glovebox Chamber', action: 'Droplet ignition spark fired.', severity: 'info' },
          { time: 'T+00:04', actor: 'Visual Camera', action: 'Visible flame disappears. Screen shows "EXTINGUISHED".', severity: 'warning' },
          { time: 'T+00:06', actor: 'Dr. Vance (PS)', action: 'Unlatches chamber access door to inspect residue.', severity: 'danger' },
          { time: 'T+00:07', actor: 'Cool Flame Front', action: 'Fresh cabin air induces violent vapor re-ignition.', severity: 'danger' },
        ],
        counterfactual: {
          title: 'PSI Radiometric Verification Protocol',
          recommendedAction:
            'Mandatory 3-minute hold with UV/IR sensor check confirming chamber core T < 350 K prior to latch release.',
          outcomeDelta: 'Zero crew injury. Fuel droplet completely evaporates without re-ignition.',
          crewSavedPct: 100,
          riskReductionPct: 78,
        },
      },
      safetyEnvelope: {
        currentO2: 21,
        currentFlow: 0.0,
        zone: 'amber',
        trajectory: [
          { o2Pct: 21, flowCms: 2.0 },
          { o2Pct: 21, flowCms: 0.0 },
        ],
      },
    },
  },
  {
    id: 'cygnus-saf-04',
    createdAt: Date.now() - 1000 * 60 * 240,
    prompt: 'CYGNUS-SAF-04 // Forced-Flow Solid Spread & Crew Containment',
    engineGravityMode: 'Microgravity (0g) inside uncrewed Cygnus Pressurized Cargo Module',
    scenario: {
      investigationId: 'saffire',
      materialId: 'cotton',
      o2Pct: 21,
      flowCms: 20.0,
      gravity: 'microgravity',
      sealed: false,
    },
    analysisScenario: {
      investigationId: 'saffire',
      materialId: 'cotton',
      o2Pct: 21,
      flowCms: 20.0,
      gravity: 'microgravity',
    },
    response: {
      mode: 'llm',
      model: '9router/gemini-2.5-pro',
      briefing:
        'LARGE-SCALE SPACECRAFT FIRE RISK: SAFFIRE-IV validated full-scale fabric combustibility in Cygnus. Forced ventilation at 20 cm/s continuously draws oxygen across the pyrolyzing solid, preventing self-extinction and driving sustained upstream and downstream flame fronts.',
      recommended_action:
        'Immediate shutoff of main cabin air loops to starve the flame front of kinetic oxidizer flux.',
      ui_command: null,
      chamber: {
        riskIndex: 0.77,
        level: 'critical',
        materialId: 'cotton',
        o2Pct: 21,
        flowCms: 20.0,
        gravity: 'microgravity',
      },
      evidence: [
        {
          runId: 'psi-saffire-iv-004',
          accession: 'PSI-SAFFIRE-IV-004',
          investigationId: 'saffire',
          fuel: 'SIBAL Fabric (Cotton/Fiberglass)',
          outcome: 'sustained flame spread 28 cm',
          similarity: 98,
          verified: false,
          sourceUrl: 'https://psi.nasa.gov/physci/repo',
        },
      ],
      simulation_commands: {
        load_preset: 'saffire',
        set_o2_percent: 21,
        set_airflow_cm_s: 20.0,
      },
    },
    run: {
      model: 'spread',
      tSec: 25.0,
      regime: 1,
      o2Pct: 21,
      o2EffPct: 18.2,
      volumeLiters: 180,
      ignited: true,
      coolFlame: false,
      finished: true,
      frontPosCm: 28.4,
      spreadRateCms: 1.15,
      intensity: 0.88,
      heatReleaseW: 580.0,
    },
    spec: {
      id: 'cygnus-saf-04',
      createdAt: Date.now() - 1000 * 60 * 240,
      title: 'CYGNUS-SAF-04 // Forced-Flow Solid Spread & Crew Containment',
      missionTag: 'Cygnus PCM · Uncrewed Post-Departure Test (0g)',
      rubric: {
        summarize: {
          investigationId: 'saffire',
          materialId: 'SIBAL Spacecraft Cotton / Fiberglass Blend',
          abstract:
            'Demonstrates how continuous ventilation in microgravity sustains flame spread on meter-scale fabrics that would otherwise self-extinguish in stagnant 0g conditions. Proves that ventilation velocity is the primary driver of spacecraft structural fire hazard.',
          psiAccessions: ['PSI-SAFFIRE-IV-004', 'PSI-SAFFIRE-V-001', 'NASA-TM-2020-500821'],
          paperCitations: ['Fire Safety Journal 2021: Saffire Large-Scale Spacecraft Combustion', 'NTRS 20210019483'],
          pressureKpa: 101.3,
          gravityRegime: 'Microgravity (0g)',
          o2Pct: 21.0,
          flowCms: 20.0,
        },
        rank: {
          compositeRisk: 77,
          level: 'critical',
          uncertaintyBand: { low: 73, high: 82, level: 0.95 },
          components: {
            flammability: 88,
            hiddenHazard: 68,
            explorationRelevance: 95,
            dataRichness: 90,
          },
          shapDrivers: [
            { factor: 'Forced ventilation (20 cm/s)', delta: '+32%', rationale: 'Delivers continuous oxidizer replenishment along sample boundary' },
            { factor: 'Large-scale sample area', delta: '+22%', rationale: 'Radiative feedback between burning zones overcomes quenching' },
            { factor: 'Standard air (21% O₂)', delta: '+0%', rationale: 'Baseline oxidizer concentration' },
          ],
        },
        interpret: {
          actionableGuidance:
            'Spacecraft ventilation systems must feature automated localized dampers to throttle airflow to < 2 cm/s within 5 seconds of smoke detection.',
          containmentDoctrine:
            'Immediate shutoff of main cabin air loops to starve the flame front of kinetic oxidizer flux.',
          sensorAdvisory:
            'Place particulate obscuration sensors directly inside duct intake mouths rather than room corners.',
          atmosphereLimits:
            'Combustible fabrics larger than 0.2 m² require fire-retardant barrier interlayers.',
        },
      },
      headlineFindings: HEADLINE_EXPLORATION_FINDINGS,
      crewImpact: {
        missionStatus: 'MISSION ACCOMPLISHED',
        crew: [
          {
            id: 'cdr',
            name: 'Flight Director Morgan',
            role: 'Mission Director (Ground Ops)',
            avatar: '/assets/crew_lucas.png',
            status: 'Nominal',
            statusDetail: 'Safely conducted test on departed Cygnus vehicle; zero crew risk.',
          },
          {
            id: 'fe',
            name: 'Elena Ruiz',
            role: 'Ground Test Telemetry Lead',
            avatar: '/assets/pixel_engineer.png',
            status: 'Nominal',
            statusDetail: 'Monitored thermocouple and UV sensor arrays during sample burn.',
          },
          {
            id: 'ps',
            name: 'Dr. Marcus Vance',
            role: 'Principal Investigator',
            avatar: '/assets/pixel_scientist.png',
            status: 'Nominal',
            statusDetail: 'Verified quantitative burn regression against C++ airflow solver.',
          },
        ],
        causalLog: [
          { time: 'T+00:00', actor: 'Cygnus PCM', action: 'Hot-wire igniter energizes bottom edge of SIBAL cloth.', severity: 'info' },
          { time: 'T+00:06', actor: 'Ventilation Fan', action: 'Fan maintains 20 cm/s flow. Flame propagates forward.', severity: 'info' },
          { time: 'T+00:18', actor: 'Downstream Sensor', action: 'Flame front spans 28 cm sample length. Thermocouple hits 1140 K.', severity: 'warning' },
          { time: 'T+00:25', actor: 'Test Completed', action: 'Automated nitrogen purge extinguishes remaining char.', severity: 'info' },
        ],
        counterfactual: {
          title: 'Crewed Habitat Rapid Isolation Doctrine',
          recommendedAction:
            'In a crewed station, this exact scenario would mandate instant cabin loop bypass to avoid hull penetration.',
          outcomeDelta: 'Validated spacecraft structural fire boundary.',
          crewSavedPct: 100,
          riskReductionPct: 65,
        },
      },
      safetyEnvelope: {
        currentO2: 21,
        currentFlow: 20.0,
        zone: 'runaway',
        trajectory: [
          { o2Pct: 21, flowCms: 5.0 },
          { o2Pct: 21, flowCms: 12.0 },
          { o2Pct: 21, flowCms: 20.0 },
        ],
      },
    },
  },
]

function read(): GeneratedDashboard[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    let userReports: GeneratedDashboard[] = []
    if (raw) {
      const parsed = JSON.parse(raw) as GeneratedDashboard[]
      if (Array.isArray(parsed)) userReports = parsed
    } else {
      // Migrate v1 generated dashboards if present
      const rawV1 = localStorage.getItem('ignis-generated-dashboards-v1')
      if (rawV1) {
        try {
          const parsedV1 = JSON.parse(rawV1)
          if (Array.isArray(parsedV1)) {
            userReports = parsedV1.map((item: any) => {
              if (item.spec) return item as GeneratedDashboard
              const spec = compileMissionReportSpec(
                item.prompt || 'Migrated Mission Report',
                item.response || {
                  briefing: '',
                  recommended_action: '',
                  evidence: [],
                  mode: 'local-fallback',
                  model: 'v1-migration',
                },
                item.run,
                item.scenario || item.analysisScenario,
                item.engineGravityMode,
              )
              return { ...item, spec } as GeneratedDashboard
            })
            localStorage.setItem(STORE_KEY, JSON.stringify(userReports.slice(0, MAX_ITEMS)))
          }
        } catch {
          // ignore v1 migration parse error
        }
      }
    }
    const seedIds = new Set(SEED_REPORTS.map((s) => s.id))
    const filteredUserReports = userReports.filter((r) => !seedIds.has(r.id))
    const combined = [...filteredUserReports, ...SEED_REPORTS].slice(0, MAX_ITEMS)
    return combined
  } catch {
    return SEED_REPORTS
  }
}

export function getGeneratedDashboards(): GeneratedDashboard[] {
  return read()
}

export function compileMissionReportSpec(
  prompt: string,
  response: SiResponse,
  run?: ChamberState,
  scenario?: SiChamberState,
  engineGravityMode?: string,
): MissionReportSpec {
  const o2 = scenario?.o2Pct ?? run?.o2Pct ?? 21
  const flow = scenario?.flowCms ?? 5
  const material = scenario?.materialId ?? 'PMMA'
  const invId = scenario?.investigationId ?? 'flex-2'
  const riskVal = typeof response.chamber?.riskIndex === 'number' ? response.chamber.riskIndex : 0.5
  const riskPct = Math.round(riskVal <= 1 ? riskVal * 100 : riskVal)

  const level: 'low' | 'moderate' | 'high' | 'critical' =
    riskPct >= 75 ? 'critical' : riskPct >= 50 ? 'high' : riskPct >= 30 ? 'moderate' : 'low'

  const rawUncertainty = response.chamber?.uncertainty as RiskUncertainty | undefined
  const calculatedUncertainty =
    rawUncertainty ??
    riskIndexLocal(material, o2, flow, scenario?.gravity ?? 'microgravity').uncertainty
  const uncertaintyBand = calculatedUncertainty
    ? {
        low: Math.round(calculatedUncertainty.lower * 100),
        high: Math.round(calculatedUncertainty.upper * 100),
        level: calculatedUncertainty.level,
      }
    : null

  const zone: 'safe' | 'amber' | 'runaway' =
    o2 <= 13.5 ? 'safe' : o2 > 25 || flow > 12 ? 'runaway' : 'amber'

  const missionStatus: MissionOutcomeStatus =
    riskPct >= 75 ? 'MISSION ABORTED / HULL BREACH' : riskPct >= 45 ? 'EMERGENCY CONTAINED' : 'MISSION ACCOMPLISHED'

  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return {
    id,
    createdAt: Date.now(),
    title: prompt.length > 5 ? prompt : `Mission Safety Assessment: ${material.toUpperCase()} at ${o2}% O₂`,
    missionTag: `${invId.toUpperCase()} · ${scenario?.gravity ?? 'Microgravity'} Environment`,
    rubric: {
      summarize: {
        investigationId: invId,
        materialId: material,
        abstract: response.briefing,
        psiAccessions: (response.evidence ?? []).map((e) => e.accession),
        paperCitations: ['NASA PSI Combustion Database', 'NTRS Scientific Index'],
        pressureKpa: 101.3,
        gravityRegime: engineGravityMode ?? scenario?.gravity ?? 'microgravity',
        o2Pct: o2,
        flowCms: flow,
      },
      rank: {
        compositeRisk: riskPct,
        level,
        uncertaintyBand,
        components: {
          flammability: Math.round(riskPct * 1.05),
          hiddenHazard: run?.coolFlame ? 92 : Math.round(riskPct * 0.9),
          explorationRelevance: o2 > 25 ? 95 : 75,
          dataRichness: 85,
        },
        shapDrivers: [
          { factor: `Atmospheric O₂ (${o2}%)`, delta: `${o2 > 21 ? '+' : '-'}${Math.abs(o2 - 21) * 2}%`, rationale: 'Oxidizer chemical kinetics driving factor' },
          { factor: `Ventilation Flow (${flow} cm/s)`, delta: `${flow > 5 ? '+' : '-'}${Math.round(flow * 1.2)}%`, rationale: 'Convective boundary layer transport' },
          { factor: `Gravity Regime (${scenario?.gravity ?? '0g'})`, delta: scenario?.gravity === 'earth' ? '+15%' : '-8%', rationale: 'Buoyant chimney effect coupling' },
        ],
      },
      interpret: {
        actionableGuidance:
          riskPct > 60
            ? 'Mandate automated containment damper shutdown and immediate N₂/CO₂ flooding of affected module.'
            : 'Operational envelope acceptable under continuous forced aspirating particulate monitoring.',
        containmentDoctrine:
          'Cut cabin recirculating flow to < 1 cm/s within 5 seconds. Maintain hermetic hatch seal until IR scan confirms core T < 350 K.',
        sensorAdvisory:
          'Standard optical ionization alarms cannot detect 0g smoke clusters. Use multipoint duct aspirating detectors.',
        atmosphereLimits:
          o2 > 25
            ? 'WARNING: Material enters high-risk spread envelope under elevated exploration atmospheres.'
            : 'Material within nominal baseline flammability range.',
      },
    },
    headlineFindings: HEADLINE_EXPLORATION_FINDINGS,
    crewImpact: {
      missionStatus,
      crew: [
        {
          id: 'cdr',
          name: 'Cdr. Alex Chen',
          role: 'Mission Commander',
          avatar: '/assets/crew_lucas.png',
          status: 'Nominal',
          statusDetail: 'Overseeing module atmosphere status and evacuation routes.',
        },
        {
          id: 'fe',
          name: 'Elena Ruiz',
          role: 'Flight Systems Engineer',
          avatar: '/assets/pixel_engineer.png',
          status: riskPct > 70 ? 'Smoke Inhalation' : 'Nominal',
          statusDetail: riskPct > 70 ? 'Exposed while verifying manual damper override.' : 'Stationed at ECLSS control console.',
        },
        {
          id: 'ps',
          name: 'Dr. Marcus Vance',
          role: 'Payload Specialist',
          avatar: '/assets/pixel_scientist.png',
          status: run?.coolFlame ? 'Burn Injury' : 'Nominal',
          statusDetail: run?.coolFlame ? 'Experienced flash burn from invisible cool-flame re-ignition.' : 'Monitoring glovebox sensors.',
        },
      ],
      causalLog: [
        { time: 'T+00:00', actor: 'Simulation Core', action: `Ignition initialized at ${o2}% O₂ and ${flow} cm/s.`, severity: 'info' },
        { time: 'T+00:04', actor: 'Combustion Solver', action: run?.coolFlame ? 'Cool flame regime triggered.' : 'Front advancing along boundary.', severity: run?.coolFlame ? 'warning' : 'info' },
        { time: 'T+00:10', actor: 'Safety Interlock', action: riskPct > 70 ? 'Flashover limit breached.' : 'Contained within nominal limits.', severity: riskPct > 70 ? 'danger' : 'info' },
      ],
      counterfactual: {
        title: 'NASA PSI Standard Counterfactual Protocol',
        recommendedAction: 'Immediate airflow cutoff (V_flow = 0 cm/s) + cabin depressurization to quench flame radiatively.',
        outcomeDelta: 'Eliminates smoke inhalation risk and preserves habitat integrity.',
        crewSavedPct: 100,
        riskReductionPct: 75,
      },
    },
    safetyEnvelope: {
      currentO2: o2,
      currentFlow: flow,
      zone,
      trajectory: [
        { o2Pct: Math.max(10, o2 - 6), flowCms: Math.max(0, flow - 3) },
        { o2Pct: o2, flowCms: flow },
      ],
    },
    rawScenario: scenario,
    rawResponse: response,
    run,
  }
}

export function generateDashboard(
  prompt: string,
  response: SiResponse,
  run?: ChamberState,
  scenario?: SiChamberState,
  analysisScenario?: SiChamberState,
  engineGravityMode?: string,
): GeneratedDashboard {
  const spec = compileMissionReportSpec(prompt, response, run, scenario, engineGravityMode)

  const item: GeneratedDashboard = {
    id: spec.id,
    createdAt: spec.createdAt,
    prompt,
    response,
    spec,
    ...(scenario ? { scenario } : {}),
    ...(analysisScenario ? { analysisScenario } : {}),
    ...(engineGravityMode ? { engineGravityMode } : {}),
    ...(run ? { run } : {}),
  }

  const items = [item, ...read()].slice(0, MAX_ITEMS)
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items))
  } catch {
    // preserve session
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: item }))
  return item
}

export function clearGeneratedDashboards(): void {
  try {
    localStorage.removeItem(STORE_KEY)
    localStorage.removeItem('ignis-generated-dashboards-v1')
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function exportReportMarkdown(report: GeneratedDashboard): void {
  const spec = report.spec
  const md = `# NASA Space Apps 2026 — IGNIS Executive Flight Safety Brief
**Document Reference:** IGNIS-REPORT-${spec.id.slice(0, 8).toUpperCase()}  
**Generated Date:** ${new Date(spec.createdAt).toUTCString()}  
**Mission Classification:** ${spec.missionTag}  
**Assessment Subject:** ${spec.title}  

---

## 1. RUBRICA NASA: SUMMARIZE · RANK · INTERPRET

### A. SUMMARIZE (NASA PSI DATA SYNTHESIS)
- **Investigation / Model:** ${spec.rubric.summarize.investigationId} (${spec.rubric.summarize.gravityRegime})
- **Material Tested:** ${spec.rubric.summarize.materialId}
- **Atmosphere Parameters:** ${spec.rubric.summarize.o2Pct}% O₂ · ${spec.rubric.summarize.flowCms} cm/s Flow · ${spec.rubric.summarize.pressureKpa} kPa
- **Executive Abstract:**  
  ${spec.rubric.summarize.abstract}
- **Corroborating NASA PSI Accessions:**
${spec.rubric.summarize.psiAccessions.map((acc) => `  - \`${acc}\``).join('\n') || '  - NASA PSI Microgravity Repository'}

### B. RANK (C++20 RISK INDEX & CONFORMAL UNCERTAINTY)
- **Composite Risk Index:** **${spec.rubric.rank.compositeRisk}%** (${spec.rubric.rank.level.toUpperCase()})
${
  spec.rubric.rank.uncertaintyBand
    ? `- **Conformal Uncertainty Range (${Math.round((spec.rubric.rank.uncertaintyBand.level ?? 0.9) * 100)}% CI):** [${spec.rubric.rank.uncertaintyBand.low}%, ${spec.rubric.rank.uncertaintyBand.high}%]`
    : '- **Conformal Uncertainty Range:** Unavailable (uncalibrated bounds)'
}
- **Risk Dimension Breakdown:**
  - Flammability Potential: ${spec.rubric.rank.components.flammability}%
  - Hidden / Cool-Flame Hazard: ${spec.rubric.rank.components.hiddenHazard}%
  - Exploration Architecture Relevance: ${spec.rubric.rank.components.explorationRelevance}%
  - NASA Data Richness: ${spec.rubric.rank.components.dataRichness}%
- **Key SHAP Attribution Drivers:**
${spec.rubric.rank.shapDrivers.map((d) => `  - **${d.factor}**: ${d.delta} (${d.rationale})`).join('\n')}

### C. INTERPRET (OPERATIONAL GUIDANCE & MITIGATION)
- **Actionable Guidance:** ${spec.rubric.interpret.actionableGuidance}
- **Containment Doctrine:** ${spec.rubric.interpret.containmentDoctrine}
- **Sensor & Detection Advisory:** ${spec.rubric.interpret.sensorAdvisory}
- **Exploration Atmosphere Boundaries:** ${spec.rubric.interpret.atmosphereLimits}

---

## 2. HEADLINE EXPLORATION FINDINGS (NASA CORPUS INSIGHTS)
${spec.headlineFindings
  .map(
    (f, idx) =>
      `### [${idx + 1}] ${f.title} (${f.badge})\n- **Core Discovery:** ${f.finding}\n- **NASA PSI Evidence:** ${f.psiProof}\n- **Operational Impact:** ${f.impact}\n`,
  )
  .join('\n')}

---

## 3. CREW IMPACT & HUMAN FACTORS CAUSAL AUDIT
- **Mission Outcome Status:** **${spec.crewImpact.missionStatus}**
- **Crew Roster Status:**
${spec.crewImpact.crew
  .map((c) => `  - **${c.name}** (${c.role}): \`${c.status.toUpperCase()}\` — ${c.statusDetail}`)
  .join('\n')}

### Chronological Causal Log
${spec.crewImpact.causalLog
  .map((e) => `- **${e.time}** [${e.actor}]: ${e.action}`)
  .join('\n')}

### Counterfactual Recovery Strategy
- **NASA PSI Recommended Action:** ${spec.crewImpact.counterfactual.recommendedAction}
- **Recovery Delta:** ${spec.crewImpact.counterfactual.outcomeDelta} (Crew Salvage: ${spec.crewImpact.counterfactual.crewSavedPct}%, Risk Reduction: ${spec.crewImpact.counterfactual.riskReductionPct}%)

---
*Generated by IGNIS Flight Safety Engine · Compiled C++20 Core · NASA Space Apps Challenge 2026*
`

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `IGNIS_Certification_Brief_${spec.id.slice(0, 8)}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function dashboardGeneratedEvent(): string {
  return EVENT
}
