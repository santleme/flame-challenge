import { ignitionPressureLocal, limitingO2, specFor } from '../game/experiments'
import { INV_MATERIAL } from '../game/masterSheet'
import { riskIndexLocal } from '../sim-bridge/risk'
import type {
  DashConditions,
  EnvKey,
  Insight,
  Investigation,
  RankedInvestigation,
} from '../types'

const GRAVITY_FOR_ENV: Record<EnvKey, string> = {
  microgravity: 'microgravity',
  lunar: 'lunar',
  martian: 'martian',
  historical: 'microgravity',
  earth: 'earth',
}

const AVAIL_SCORE = { full: 80, partial: 55, 'metadata-only': 40 } as const

/**
 * Investigation ranking — the "ranks" pillar of the challenge brief.
 * Total score is a documented blend, not a black box:
 *   flammability  .35 — engine risk index of the mapped PSI material at the
 *                       current cabin dials (same P·F·H·G model as /api/risk)
 *   hiddenHazard  .30 — detection + persistence axes (cool flames, smolder)
 *   relevance     .20 — exploration-atmosphere applicability + hazard breadth
 *   dataRichness  .15 — PSI availability + parsed run count + publications
 */
const W = { flammability: 0.35, hiddenHazard: 0.3, relevance: 0.2, dataRichness: 0.15 }

function flammabilityScore(inv: Investigation, cond: DashConditions): number {
  const gravity = GRAVITY_FOR_ENV[cond.env]
  const matId = INV_MATERIAL[inv.id]
  if (matId) {
    return Math.round(riskIndexLocal(matId, cond.o2Pct, cond.flowCms, gravity).riskIndex * 100)
  }
  return Math.round(ignitionPressureLocal(inv, cond.o2Pct) * 100)
}

function hiddenHazardScore(inv: Investigation, cond: DashConditions): number {
  const f = specFor(inv, cond.o2Pct, cond.flowCms).factors
  return Math.round((f.detection + f.persistence) / 2)
}

function relevanceScore(inv: Investigation): number {
  const base = inv.conditions.explorationRelevant ? 55 : 30
  const breadth = Math.min(30, inv.hazards.length * 8)
  const grav = inv.gravity !== 'microgravity' ? 10 : 0
  return Math.min(100, base + breadth + grav)
}

function dataRichnessScore(inv: Investigation): number {
  const runs = Math.min(15, Math.floor((inv.psiRuns ?? 0) / 40))
  const pubs = Math.min(10, Math.floor(inv.publications / 4))
  return Math.min(100, AVAIL_SCORE[inv.data.availability] + runs + pubs)
}

function summarize(inv: Investigation, cond: DashConditions): string {
  const loc = limitingO2(inv)
  const margin = cond.o2Pct - loc
  if (inv.metrics.coolFlameObserved)
    return 'post-extinction cool-flame stage — persists invisibly past detector kill criteria'
  if (margin <= 0)
    return `cabin ${cond.o2Pct}% O₂ sits ${Math.abs(margin).toFixed(1)}pt under its LOC — quiescent regime`
  if (inv.metrics.flameSpreadRateCms)
    return 'propagation-limited — forced ventilation multiplies measured spread rate'
  return 'ignition-pressure limited — risk grows steeply above the oxygen limit'
}

export function rankInvestigations(
  invs: Investigation[],
  cond: DashConditions,
): RankedInvestigation[] {
  return invs
    .map((inv) => {
      const score = {
        flammability: flammabilityScore(inv, cond),
        hiddenHazard: hiddenHazardScore(inv, cond),
        relevance: relevanceScore(inv),
        dataRichness: dataRichnessScore(inv),
        total: 0,
      }
      score.total = Math.round(
        W.flammability * score.flammability +
          W.hiddenHazard * score.hiddenHazard +
          W.relevance * score.relevance +
          W.dataRichness * score.dataRichness,
      )
      return { inv, rank: 0, score, summary: summarize(inv, cond) }
    })
    .sort((a, b) => b.score.total - a.score.total)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/**
 * Interpretation layer — deterministic rules that turn the ranked data into
 * plain-language safety findings, each citing the records it derives from.
 * Mirrors what a fire-safety reviewer would flag for exploration cabins.
 */
export function buildInsights(
  invs: Investigation[],
  ranked: RankedInvestigation[],
  cond: DashConditions,
): Insight[] {
  const out: Insight[] = []
  const gravity = GRAVITY_FOR_ENV[cond.env]

  const cool = invs.filter((i) => i.metrics.coolFlameObserved)
  if (cool.length)
    out.push({
      id: 'cool-flame-detection',
      kind: 'detection',
      severity: 'critical',
      title: `${cool.length} investigation${cool.length > 1 ? 's show' : ' shows'} invisible cool-flame stages`,
      body:
        'FLEX/FLEX-2 droplets keep burning after the visible flame dies — below smoke-detector ' +
        'thresholds, with re-ignition energy still available. Post-extinction monitoring windows ' +
        'are a documented requirement, not a gameplay invention.',
      sources: cool.map((i) => i.name),
    })

  const top = ranked[0]
  if (top) {
    const matId = INV_MATERIAL[top.inv.id]
    const r = matId
      ? riskIndexLocal(matId, cond.o2Pct, cond.flowCms, gravity)
      : null
    out.push({
      id: 'top-risk',
      kind: 'materials',
      severity: r && r.riskIndex >= 0.5 ? 'high' : 'medium',
      title: `#1 under current dials: ${top.inv.name} (score ${top.score.total})`,
      body: r
        ? `${r.materialName} prices at ${(r.riskIndex * 100).toFixed(0)}% risk index ` +
          `(margin ${r.margin}pt over its ${r.locPct}% LOC) at ${cond.o2Pct}% O₂ / ` +
          `${cond.flowCms} cm/s — ${top.summary}.`
        : `${top.inv.name} leads on composite score — ${top.summary}.`,
      sources: [top.inv.name],
    })
  }

  const withMat = invs
    .map((i) => ({ i, m: INV_MATERIAL[i.id] }))
    .filter((x): x is { i: Investigation; m: string } => !!x.m)
  const ignitable = withMat.filter(
    ({ m }) => !riskIndexLocal(m, cond.o2Pct, cond.flowCms, gravity).flags.belowLoc,
  )
  // suppressing every ignitable material means getting below the LOWEST
  // LOC in that set — the max LOC is irrelevant to the guidance
  const bindingLoc = ignitable.length
    ? Math.min(
        ...ignitable.map(
          ({ m }) => riskIndexLocal(m, cond.o2Pct, cond.flowCms, gravity).locPct,
        ),
      )
    : null
  out.push({
    id: 'loc-margins',
    kind: 'atmosphere',
    severity: ignitable.length > withMat.length / 2 ? 'high' : 'medium',
    title: ignitable.length
      ? `${ignitable.length}/${withMat.length} mapped materials ignitable at ${cond.o2Pct}% O₂`
      : `No mapped material ignitable at ${cond.o2Pct}% O₂`,
    body: ignitable.length
      ? 'Materials whose limiting-oxygen index sits below cabin O₂ retain non-zero ignition ' +
        `pressure. The binding limit is the lowest LOC in that set (${bindingLoc}%) — ` +
        'dropping cabin O₂ below it suppresses every mapped ignition; NASA exploration ' +
        'targets ~16.5–18% for that reason.'
      : 'Every mapped material LOC sits above the cabin setting — ignition pressure is at ' +
        'its residual floor across the matrix.',
    sources: ignitable.map((x) => x.i.name),
  })

  if (cond.flowCms > 0) {
    const worst = withMat
      .map(({ m }) => ({
        m,
        now: riskIndexLocal(m, cond.o2Pct, cond.flowCms, gravity).riskIndex,
        still: riskIndexLocal(m, cond.o2Pct, 0, gravity).riskIndex,
      }))
      .sort((a, b) => b.now - b.still - (a.now - a.still))[0]
    if (worst && worst.now - worst.still > 0.02)
      out.push({
        id: 'ventilation-tradeoff',
        kind: 'operations',
        severity: 'medium',
        title: `Ventilation at ${cond.flowCms} cm/s adds ${Math.round((worst.now - worst.still) * 100)}pt to ${worst.m}`,
        body:
          `Killing forced flow drops ${worst.m} from ${(worst.now * 100).toFixed(0)}% to ` +
          `${(worst.still * 100).toFixed(0)}% — the SAFFIRE airflow vector in action. The same ` +
          'flow that feeds a fire also clears smoke; the decision is regime-dependent, which is ' +
          'why it is an operator choice, not a constant.',
        sources: ['SAFFIRE I–VI'],
      })
  }

  const verified = invs.filter((i) => i.verified)
  out.push({
    id: 'provenance',
    kind: 'atmosphere',
    severity: verified.length < invs.length / 2 ? 'high' : 'medium',
    title: `${verified.length}/${invs.length} investigations verified against parsed PSI runs`,
    body:
      `${verified.reduce((s, i) => s + (i.psiRuns ?? 0), 0).toLocaleString()} per-test runs ` +
      'ingested from psi.nasa.gov. Unverified cards still carry curated literature constants — ' +
      'treat their numeric edges as approximations until the ETL covers their file formats.',
    sources: verified.map((i) => i.name),
  })

  return out
}
