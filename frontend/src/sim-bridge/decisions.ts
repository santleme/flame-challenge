import { MASTER_ROWS } from '../game/masterSheet'
import { riskIndexLocal } from './risk'
import type {
  DashConditions,
  DecisionCard,
  DecisionCardsPayload,
  DecisionOption,
  EnvKey,
  NeighborRef,
} from '../types'

/**
 * Decision-cards client — prefers the FastAPI `/api/decision-cards`
 * synthesizer (C++ ignition pressure + KNN evidence + counterfactual
 * scores), degrades to the static card deck + a local KNN mirror over
 * the master sheet so the SI layer never goes dark offline.
 */

const GRAVITY_FOR_ENV: Record<EnvKey, string> = {
  microgravity: 'microgravity',
  lunar: 'lunar',
  martian: 'martian',
  historical: 'microgravity',
  earth: 'earth',
}

export async function fetchDecisionCards(
  materialId: string,
  cond: DashConditions,
): Promise<DecisionCardsPayload | null> {
  try {
    const params = new URLSearchParams({
      materialId,
      o2Pct: String(cond.o2Pct),
      flowCms: String(cond.flowCms),
      gravity: GRAVITY_FOR_ENV[cond.env],
    })
    const r = await fetch(`/api/decision-cards?${params}`, {
      signal: AbortSignal.timeout(1500),
    })
    if (r.ok) return (await r.json()) as DecisionCardsPayload
  } catch {
    /* backend offline — static deck + local KNN */
  }
  return null
}

// ---------- local KNN mirror over master-sheet experiment_run rows ----------
// same weighted-Euclidean contract as backend/services/neighbors.py

const O2_SCALE = 5.0
const FLOW_SCALE = 20.0
const O2_MISSING_PENALTY = 1.0

const AFFINITY = { exact: 0, alias: 0.15, cls: 0.5, unknown: 1.05, other: 1.5 }

const MATERIAL_ALIASES: Record<string, string[]> = {
  cotton: ['sibal', 'cotton', 'fiberglass'],
  pmma: ['pmma', 'acrylic'],
  'pmma-sphere': ['pmma', 'sphere'],
  nomex: ['nomex'],
  kapton: ['kapton'],
  teflon: ['teflon', 'ptfe'],
  silicone: ['silicone'],
  heptane: ['heptane'],
  'iso-octane': ['isooctane', 'iso-octane'],
  jp8: ['jp8', 'jp-8'],
  decanol: ['decanol'],
  methanol: ['methanol', 'meoh'],
  ethylene: ['ethylene', 'c2h4'],
  ethane: ['ethane', 'c2h6'],
  methane: ['methane', 'ch4'],
  propane: ['propane', 'c3h8'],
  butane: ['butane', 'c4h10'],
}

const SOLID = new Set([
  'pmma', 'pmma-sphere', 'cotton', 'nomex', 'kapton', 'polycarbonate',
  'cellulose', 'pyrell', 'teflon', 'thin-sheet', 'panels', 'silicone',
  '2-cm-sphere', '1-cm-sphere',
])
const GAS = new Set(['ethylene', 'ethane', 'methane', 'propane', 'butane'])
const LIQUID = new Set([
  'heptane', 'methanol', 'ethanol', 'decanol', 'iso-octane', 'jp8',
  'dodecane', 'japan-wax-candle-wake',
])

function num(v: string | number | undefined): number | null {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function classOf(key: string): Set<string> {
  if (SOLID.has(key)) return SOLID
  if (GAS.has(key)) return GAS
  return LIQUID
}

interface Row {
  runId: string
  accession: string
  investigationId: string
  fuel: string
  materialKey: string | null
  o2: number | null
  flow: number | null
  outcome: string
  coolFlame: boolean
  sourceUrl: string
  verified: boolean
}

function norm(text: string): string {
  // space-padded canonical form — 'iso-octane', 'iso octane' and
  // 'Iso-Octane' all collapse to ' iso octane '; a padded contains()
  // keeps 'ethane' out of 'methane' while hyphenated aliases still match
  return ` ${text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ')} `
}

function hasAlias(textNorm: string, alias: string): boolean {
  const a = norm(alias)
  return a.length > 2 && textNorm.includes(a)
}

const RUNS: Row[] = MASTER_ROWS.filter((r) => r.record_type === 'experiment_run').map((r) => {
  const matId = (r.material_id ?? '').toLowerCase()
  const fuel = r.fuel_or_material ?? ''
  let materialKey: string | null = matId || null
  if (!materialKey) {
    const fuelNorm = norm(fuel)
    for (const [key, aliases] of Object.entries(MATERIAL_ALIASES)) {
      // whole-phrase match only — 'ethane' must not catch inside 'methane'
      if (aliases.some((a) => hasAlias(fuelNorm, a))) {
        materialKey = key
        break
      }
    }
  }
  return {
    runId: r.id,
    accession: (r.source ?? '').match(/PSI-\d+/)?.[0] ?? r.investigation_id ?? '',
    investigationId: r.investigation_id ?? '',
    fuel,
    materialKey,
    o2: num(r.o2_pct),
    flow: num(r.flow_cms),
    outcome: r.outcome ?? 'unknown',
    coolFlame: r.cool_flame === 'true',
    sourceUrl: r.source_url ?? '',
    verified: r.verified === 'true',
  }
})

function affinity(queryMat: string, rowMat: string | null, fuel: string): number {
  if (!queryMat) return AFFINITY.cls
  if (rowMat === null) return AFFINITY.unknown
  const q = queryMat.toLowerCase()
  if (rowMat === q) return AFFINITY.exact
  const aliases = MATERIAL_ALIASES[q] ?? [q]
  // alias = same substance under another name; whole-phrase matching keeps
  // distinct chemicals apart ('ethane' ≠ 'methane', 'ethanol' ≠ 'methanol')
  const hay = norm(`${fuel} ${rowMat}`)
  if (aliases.some((a) => hasAlias(hay, a))) return AFFINITY.alias
  if (classOf(q).has(rowMat)) return AFFINITY.cls
  return AFFINITY.other
}

export function localNeighbors(
  materialId: string,
  o2Pct: number,
  flowCms = 0,
  k = 3,
): NeighborRef[] {
  return RUNS.map((row) => {
    const o2Term = row.o2 === null ? O2_MISSING_PENALTY : (row.o2 - o2Pct) / O2_SCALE
    const flowTerm = ((row.flow ?? 0) - flowCms) / FLOW_SCALE
    const aff = affinity(materialId, row.materialKey, row.fuel)
    const d = Math.sqrt(o2Term * o2Term + flowTerm * flowTerm + aff * aff)
    return { row, d }
  })
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(1, Math.min(k, 10)))
    .map(({ row, d }) => ({
      runId: row.runId,
      accession: row.accession,
      investigationId: row.investigationId,
      fuel: row.fuel,
      materialKey: row.materialKey,
      o2Pct: row.o2,
      flowCms: row.flow,
      outcome: row.outcome,
      coolFlame: row.coolFlame,
      similarity: Math.round((1000 / (1 + d))) / 10,
      sourceUrl: row.sourceUrl,
      verified: row.verified,
    }))
}

// ---------- local tactical synthesizer ----------
// mirror of backend/services/tactics.py — same counterfactual scoring
// (1 - risk at the option's model point) and the same suppression priors,
// so the offline deck dispatches identical action ids to the live one.

const INERT_GAS_BASE = 0.8
const MIST_BASE = 0.85

const DISPLAY_NAME: Record<string, string> = {
  saffire: 'SAFFIRE',
  'flex-2': 'FLEX-2',
  acme: 'ACME',
  'bass-ii': 'BASS-II',
  'sofie-gel': 'SoFIE-GEL',
  same: 'SAME',
  'confined-combustion': 'Confined Combustion',
  flare: 'FLARE',
}

const pct = (x: number) => Math.max(0, Math.min(100, Math.round(x)))

function regimeClause(
  flags: { belowLoc: boolean; coolFlameCapable: boolean; smoldering: boolean },
  flowCms: number,
): string {
  if (flags.belowLoc)
    return "Cabin sits below the material's limiting-oxygen index — quiescent regime; ventilation is free to clear smoke."
  if (flags.coolFlameCapable)
    return "FLEX-class fuel: cool flames persist below detector thresholds after the hot flame dies — 'out' is a monitoring window, not safety."
  if (flowCms >= 8)
    return 'Forced flow is in the SAFFIRE propagation regime — cutting ventilation is the strongest single lever.'
  if (flags.smoldering)
    return 'Smolder-capable polymer — knock-down can leave re-igniting pockets; water-mist beats gas-only suppression.'
  return 'Ignition-pressure limited regime — O₂ margin is the lever.'
}

/** Full offline decision surface — the AGENTS.md-required local fallback:
 *  every option carries the same `action` id the backend emits, so
 *  suppression countermeasures stay clickable without the API. */
export function localDecisionCards(
  materialId: string,
  cond: DashConditions,
): { briefing: string; neighbors: NeighborRef[]; cards: DecisionCard[] } {
  const gravity = GRAVITY_FOR_ENV[cond.env]
  const r = riskIndexLocal(materialId, cond.o2Pct, cond.flowCms, gravity)
  const mat = r.materialId
  const loc = r.locPct
  const { coolFlameCapable: cool, smoldering: smolder } = r.flags
  const hidden = r.breakdown.hiddenFactor
  const o2 = cond.o2Pct
  const flow = cond.flowCms

  const nb = localNeighbors(mat, o2, flow, 3)
  const sources = [...new Set(nb.map((n) => DISPLAY_NAME[n.investigationId] ?? n.accession))]

  const opt = (
    label: string,
    why: string,
    o2m: number,
    flowm: number,
    action: string,
    score?: number,
  ): DecisionOption => ({
    label,
    why,
    score: pct(score ?? (1 - riskIndexLocal(mat, o2m, flowm, gravity).riskIndex) * 100),
    action,
    model: {
      materialId: mat,
      o2Pct: Math.round(o2m * 100) / 100,
      flowCms: Math.round(flowm * 100) / 100,
      gravity,
    },
  })

  const inert = pct(((INERT_GAS_BASE - 0.25 * +smolder - 0.1 * +cool) / hidden) * 100)
  const mist = pct(((MIST_BASE - 0.05 * +smolder) / hidden) * 100)
  // monitor-only scores detection adequacy, not knock-down — it can never
  // outrank a real countermeasure on a dangerous regime
  const detect = Math.max(0, 1 - 0.5 * hidden - 0.3 * +cool - 0.25 * +smolder)
  const monitor = pct(detect * (1 - 0.5 * r.riskIndex) * 100)

  const top = nb[0]
  const briefing =
    `${r.materialName} at ${r.o2Pct}% O₂ / ${r.flowCms} cm/s (${gravity}): ` +
    `risk index ${Math.round(r.riskIndex * 100)}% (${r.level}) — margin ${r.margin} pt vs LOC ${loc}%. ` +
    regimeClause(r.flags, flow) +
    (top
      ? ` Nearest real test: ${top.accession} run ${top.runId} (${
          top.fuel || top.materialKey
        }, ${top.similarity}% match, outcome ${top.outcome}).`
      : '')

  return {
    briefing,
    neighbors: nb,
    cards: [
      {
        id: 'containment',
        context: 'CONTAINMENT · CABIN AIRFLOW',
        question: `Fire signature in ${r.materialName} — how should the ventilation loop be operated right now?`,
        preset: 'saffire',
        metric: 'containment efficacy',
        options: [
          opt(
            'Cut ventilation to 0 cm/s',
            flow >= 8
              ? 'starves oxidizer diffusion — SAFFIRE forced-flow regime collapses'
              : 'drops the flame to its quiescent rate',
            o2, 0, 'cut-vent',
          ),
          opt(
            `Halve the flow (${Math.round(flow / 2)} cm/s)`,
            'slow-propagation regime — smoke clearing retained',
            o2, flow / 2, 'halve-flow',
          ),
          opt(
            `Keep forced flow (${Math.round(flow)} cm/s)`,
            flow >= 8 ? 'duct-propagation speed — highest spread risk' : 'current operating point',
            o2, flow, 'keep-flow',
          ),
        ],
        sources,
        neighbors: nb,
      },
      {
        id: 'atmosphere',
        context: 'ATMOSPHERE · O₂ MARGIN',
        question: `Where should cabin O₂ be set against the ${loc}% LOC?`,
        preset: 'apollo-1',
        metric: 'safe margin',
        options: [
          opt(`Hold ${o2}% O₂`, 'current margin — no action', o2, flow, 'hold-o2'),
          opt(
            `Reduce toward LOC (${Math.round((loc + 1) * 10) / 10}% O₂)`,
            'exploration-atmosphere target — margin shrinks to ~1 pt',
            loc + 1, flow, 'reduce-o2',
          ),
          opt(
            `Drop below LOC (${Math.round((loc - 0.5) * 10) / 10}% O₂)`,
            'ignition pressure collapses — the Apollo-1 lesson in reverse',
            loc - 0.5, flow, 'below-loc',
          ),
        ],
        sources,
        neighbors: nb,
      },
      {
        id: 'suppression',
        context: 'SUPPRESSION & DETECTION',
        question: 'Which response actually ends the event — and which only hides it?',
        preset: 'mir',
        metric: 'knock-down efficacy',
        options: [
          opt(
            'Inert-gas flood (N₂/CO₂)',
            smolder
              ? 'smolder-capable material — knock-down risks re-ignition'
              : 'displaces oxidizer at the seat',
            o2, flow, 'inert-gas', inert,
          ),
          opt(
            'Water-mist cool',
            smolder
              ? 'penetrates the polymer — best against smolder pockets'
              : 'cools below re-ignition temperature',
            o2, flow, 'water-mist', mist,
          ),
          opt(
            'Monitor-only protocol',
            cool
              ? 'cool-flame fuels defeat optical clear — documented FLEX hazard'
              : 'accept the burn and watch it',
            o2, flow, 'monitor', monitor,
          ),
        ],
        sources,
        neighbors: nb,
      },
    ],
  }
}
