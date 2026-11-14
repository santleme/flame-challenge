import { MASTER_ROWS } from '../game/masterSheet'
import type { DashConditions, DecisionCardsPayload, EnvKey, NeighborRef } from '../types'

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

const AFFINITY = { exact: 0, alias: 0.15, cls: 0.5, unknown: 0.75, other: 1.5 }

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

const RUNS: Row[] = MASTER_ROWS.filter((r) => r.record_type === 'experiment_run').map((r) => {
  const matId = (r.material_id ?? '').toLowerCase()
  const fuel = r.fuel_or_material ?? ''
  let materialKey: string | null = matId || null
  if (!materialKey) {
    const low = fuel.toLowerCase()
    for (const [key, aliases] of Object.entries(MATERIAL_ALIASES)) {
      if (aliases.some((a) => low.includes(a))) {
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
  const low = fuel.toLowerCase()
  if (aliases.some((a) => low.includes(a)) || aliases.some((a) => rowMat.includes(a)))
    return AFFINITY.alias
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
