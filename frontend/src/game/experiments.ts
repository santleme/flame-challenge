import type { Investigation } from '../types'
import { BALANCE } from './config'
import { INV_LOC } from './masterSheet'
import profiles from '../data/risk_profiles.json'
import type { ExperimentSpec, RiskAxis, RiskFactors } from './types'

const AVAIL_MULT = { full: 1.3, partial: 1.0, 'metadata-only': 0.7 } as const
const PROFILES = profiles as {
  baseRisk: number
  pressureWeight: number
  hazardAdds: Record<string, number>
  factors: {
    propagationNormCms: number
    flowBoostPerCms: number
    detectionCoolFlame: number
    detectionGapAdd: number
    persistenceSmolder: number
    persistenceLowO2: number
  }
}

/** tested O₂ range an experiment can be dialed into — the parsed PSI
 *  envelope wins over the curated conditions when runs were ingested */
export function o2Range(inv: Investigation): [number, number] {
  return inv.psiO2RangePct ?? inv.conditions.oxygenPct ?? [18, 24]
}

/** tested forced-flow range, cm/s (SAFFIRE ventilation vector) */
export function flowRange(inv: Investigation): [number, number] {
  return inv.psiFlowRangeCms ?? inv.conditions.flowCms ?? [0, 10]
}

export function limitingO2(inv: Investigation): number {
  // canonical engine LOC first (calibration.json effectiveLoc — what the
  // C++ chamber burns with), then the dataset's own limit, then the
  // tested envelope edge as a last resort
  return INV_LOC[inv.id] ?? inv.metrics.limitingOxygenPct ?? o2Range(inv)[0]
}

/** mirror of MaterialRisk::ignitionPressure for offline parity */
export function ignitionPressureLocal(inv: Investigation, o2: number): number {
  const margin = o2 - limitingO2(inv)
  if (margin <= 0) return margin > -3 ? 0.04 : 0
  return Math.min(1, 0.04 + 0.055 * Math.pow(margin, 1.35))
}

function midSpreadCms(inv: Investigation): number {
  const r = inv.metrics.flameSpreadRateCms
  return r ? (r.min + r.max) / 2 : 1
}

/**
 * Multifactor risk decomposition (weights from risk_profiles.json —
 * shared contract between the C++ core and this fallback):
 *  - ignition:    O₂ margin above the material LOC (C++ pressure curve)
 *  - propagation: measured spread rate × forced-flow boost (SAFFIRE)
 *  - detection:   cool-flame capability / detection-gap hazards (FLEX)
 *  - persistence: smolder + low-O₂ persistence → re-ignition windows
 * Total riskPct still governs the failure roll; factors shape the
 * incident (hidden fire, spread speed, dormant pockets) and tell the
 * player WHICH dial to turn down.
 */
export function specFor(
  inv: Investigation,
  oxygenPct: number,
  flowCms = 0,
  ignitionPressure?: number,
): ExperimentSpec {
  const pressure = ignitionPressure ?? ignitionPressureLocal(inv, oxygenPct)
  const F = PROFILES.factors

  const factors: RiskFactors = {
    ignition: Math.round(Math.min(100, pressure * 100)),
    propagation: Math.round(
      Math.min(100, (midSpreadCms(inv) * (1 + flowCms * F.flowBoostPerCms) / F.propagationNormCms) * 100),
    ),
    detection: Math.round(
      Math.min(
        100,
        10 +
          (inv.metrics.coolFlameObserved ? F.detectionCoolFlame : 0) +
          (inv.hazards.includes('detection-gap') ? F.detectionGapAdd : 0),
      ),
    ),
    persistence: Math.round(
      Math.min(
        100,
        10 +
          (inv.metrics.smolderObserved ? F.persistenceSmolder : 0) +
          (inv.hazards.includes('low-oxygen-persistence') ? F.persistenceLowO2 : 0),
      ),
    ),
  }
  const dominant = (Object.keys(factors) as RiskAxis[]).reduce((a, b) =>
    factors[a] >= factors[b] ? a : b,
  )

  let risk = PROFILES.baseRisk + PROFILES.pressureWeight * pressure
  for (const h of inv.hazards) risk += PROFILES.hazardAdds[h] ?? 0
  risk = Math.min(92, Math.round(risk))

  const margin = Math.max(0, oxygenPct - limitingO2(inv))
  const availMult = AVAIL_MULT[inv.data.availability]
  const pushMult = 1 + margin * 0.07
  const exploreBonus = inv.conditions.explorationRelevant ? 1.25 : 1
  const scienceYield = Math.round(
    (16 + inv.publications * 0.35) * availMult * pushMult * exploreBonus,
  )

  return {
    inv,
    oxygenPct,
    flowCms,
    riskPct: risk,
    factors,
    dominant,
    scienceYield,
    durationSec: BALANCE.experimentDurationSec,
  }
}

/** hidden cool-flame fire — FLEX-style combustion that evades detection */
export function rollsHidden(inv: Investigation, rng: () => number): boolean {
  return inv.metrics.coolFlameObserved && rng() < BALANCE.coolFlameHiddenChance
}

export function rollsSmolder(inv: Investigation): boolean {
  return inv.metrics.smolderObserved
}

/** tile-to-tile ignition pressure scaled from the real flame spread rate */
export function spreadSpeed(inv: Investigation, flowCms = 0): number {
  const cms = midSpreadCms(inv) * (1 + flowCms * PROFILES.factors.flowBoostPerCms)
  return Math.min(1, Math.max(0.15, cms / 4))
}

export function citation(inv: Investigation): string {
  return `${inv.name} · NASA PSI`
}
