/**
 * Local mirror of backend/services/risk.py — same formula, same inputs,
 * reads the same canonical shared/calibrated-data/risk_model.json.
 *
 *   risk = clamp01( P_ign(o2 - loc) * F_flow(flow) * H(material) * G(gravity) )
 */
import riskModel from '../../../shared/calibrated-data/risk_model.json'

export interface RiskMaterial {
  id: string
  name: string
  locPct: number
  locSource?: string
  sootIndex: number
  coolFlameCapable?: boolean
  smoldering?: boolean
  hiddenFactor?: number
  psiRuns?: number
  ignitionLogitA?: number
  ignitionLogitB?: number
  ignitionFitN?: number
  ignitionFitScope?: string
}

export interface RiskUncertainty {
  level: number
  halfwidth: number
  effectiveHalfwidth: number
  lower: number
  upper: number
  scaled: boolean
  regime: 'interpolation' | 'extrapolation'
  extrapolationScore: number
  scope: string
  calibrationN: number | null
  empiricalCoverage: number | null
}

export interface RiskContribution {
  factor: string
  label: string
  value: number
  baseline: number
  phi: number
  share: number
}

export interface RiskExplanation {
  method: string
  baseline: Record<string, number>
  baselineRisk: number
  deviation: number
  unclamped: boolean
  contributions: RiskContribution[]
}

export interface RiskResult {
  materialId: string
  materialName: string
  o2Pct: number
  flowCms: number
  gravity: string
  locPct: number
  margin: number
  riskIndex: number
  level: string
  breakdown: {
    ignitionPressure: number
    flowFactor: number
    hiddenFactor: number
    gravityFactor: number
  }
  uncertainty?: RiskUncertainty | null
  explanation?: RiskExplanation
  flags: { coolFlameCapable: boolean; smoldering: boolean; belowLoc: boolean }
}

const GRAVITY_FACTOR: Record<string, number> = {
  microgravity: 1.0,
  lunar: 0.92,
  martian: 0.95,
  mars: 0.95, // preset vocabulary spells it "mars" — same gravity
  'partial-gravity': 0.94,
  earth: 0.85,
}

const model = riskModel as unknown as {
  formula: {
    ignitionBase: number
    ignitionK: number
    ignitionExp: number
    residualBand: number
  }
  flowAnchors: [number, number][]
  materials: Record<string, RiskMaterial>
  uncertainty?: {
    levels: number[]
    defaultLevel: number
    global: UncertaintyScope
    families: Record<string, UncertaintyScope>
    materials: Record<string, UncertaintyScope>
    materialFamily: Record<string, string>
  }
}

interface UncertaintyScope {
  n: number
  qhat: Record<string, number>
  empiricalCoverage: Record<string, number>
  envelope: { marginMin: number; marginMax: number; flowMin: number; flowMax: number }
}

export const MATERIALS: RiskMaterial[] = Object.values(model.materials).sort(
  (a, b) => a.id.localeCompare(b.id),
)

export function flowFactor(flowCms: number): number {
  const anchors = model.flowAnchors
  const f = Math.max(0, flowCms)
  if (f <= anchors[0][0]) return anchors[0][1]
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i]
    const [x1, y1] = anchors[i + 1]
    if (f <= x1) return y0 + ((y1 - y0) * (f - x0)) / (x1 - x0)
  }
  return anchors[anchors.length - 1][1]
}

export function ignitionPressure(margin: number, material?: RiskMaterial): number {
  // PSI logistic fit when the material carries one — mirrors
  // MaterialRisk::ignitionPressure (C++) and risk.py. The hard dead band
  // ~3pp below LOC holds regardless of the fitted curve.
  if (margin <= -3) return 0
  if (material && (material.ignitionFitN ?? 0) > 0) {
    const z = (material.ignitionLogitA ?? 0) + (material.ignitionLogitB ?? 0) * margin
    return 1 / (1 + Math.exp(-Math.min(30, Math.max(-30, z))))
  }
  const p = model.formula
  if (margin <= 0) return p.ignitionBase
  return Math.min(1, p.ignitionBase + p.ignitionK * Math.pow(margin, p.ignitionExp))
}

export function riskLevel(risk: number): string {
  if (risk < 0.05) return 'minimal'
  if (risk < 0.25) return 'low'
  if (risk < 0.5) return 'moderate'
  if (risk < 0.75) return 'high'
  return 'critical'
}

/* ---------- conformal interval mirror (services/risk.uncertainty) ---------- */

export function uncertaintyLocal(
  materialId: string,
  margin: number,
  flowCms: number,
  gravity: string,
  riskVal: number,
  level?: number,
): RiskUncertainty | null {
  const u = model.uncertainty
  if (!u?.global) return null
  const lvl = level ?? u.defaultLevel ?? 0.9
  const key = lvl.toFixed(2)
  const me = u.materials?.[materialId]
  const fam = u.materialFamily?.[materialId]
  let entry: UncertaintyScope | undefined
  let scope: string
  if (me) {
    entry = me
    scope = `material:${materialId}`
  } else if (fam && u.families?.[fam]) {
    entry = u.families[fam]
    scope = `family:${fam}`
  } else {
    entry = u.global
    scope = 'global'
  }
  const q = entry.qhat[key] ?? entry.qhat['0.90'] ?? Math.max(...Object.values(entry.qhat))
  const env = entry.envelope
  const mspan = Math.max(env.marginMax - env.marginMin, 1)
  const fspan = Math.max(env.flowMax - env.flowMin, 20)
  const dMargin = Math.max(0, margin - env.marginMax, env.marginMin - margin) / mspan
  const dFlow = Math.max(0, flowCms - env.flowMax, env.flowMin - flowCms) / fspan
  const dGrav = gravity.toLowerCase() !== 'microgravity' ? 0.5 : 0
  const score = Math.max(dMargin, dFlow, dGrav)
  const hw = q * (1 + 1.5 * score)
  return {
    level: lvl,
    halfwidth: Math.round(q * 1e4) / 1e4,
    effectiveHalfwidth: Math.round(hw * 1e4) / 1e4,
    lower: Math.round(Math.max(0, riskVal - hw) * 1e4) / 1e4,
    upper: Math.round(Math.min(1, riskVal + hw) * 1e4) / 1e4,
    scaled: score > 0,
    regime: score > 0 ? 'extrapolation' : 'interpolation',
    extrapolationScore: Math.round(score * 1e3) / 1e3,
    scope,
    calibrationN: entry.n,
    empiricalCoverage: entry.empiricalCoverage?.[key] ?? null,
  }
}

/* ---------- exact Shapley mirror (services/explain.py) ---------- */

const FACTOR_KEYS = ['o2Margin', 'airflow', 'materialHazard', 'gravity'] as const
const FACTOR_LABEL: Record<(typeof FACTOR_KEYS)[number], string> = {
  o2Margin: 'o₂ margin vs loc',
  airflow: 'ventilation factor',
  materialHazard: 'material hazard',
  gravity: 'gravity regime',
}
const FACTOR_BASELINE: Record<(typeof FACTOR_KEYS)[number], number> = {
  o2Margin: 0.04,
  airflow: 1.0,
  materialHazard: 1.0,
  gravity: 1.0,
}

const _fact = [1, 1, 2, 6, 24] // factorials 0..4

export function explainLocal(breakdown: RiskResult['breakdown'], risk?: number): RiskExplanation {
  const values: Record<(typeof FACTOR_KEYS)[number], number> = {
    o2Margin: breakdown.ignitionPressure,
    airflow: breakdown.flowFactor,
    materialHazard: breakdown.hiddenFactor,
    gravity: breakdown.gravityFactor,
  }
  const n = FACTOR_KEYS.length
  const x = FACTOR_KEYS.map((k) => values[k])
  const b = FACTOR_KEYS.map((k) => FACTOR_BASELINE[k])
  const phi: number[] = []
  for (let i = 0; i < n; i++) {
    const others = FACTOR_KEYS.map((_, j) => j).filter((j) => j !== i)
    let acc = 0
    // every subset S of the other factors — n=4, so 8 subsets
    for (let mask = 0; mask < 1 << others.length; mask++) {
      let prod = x[i] - b[i]
      let s = 0
      others.forEach((j, idx) => {
        if (mask & (1 << idx)) {
          prod *= x[j]
          s++
        } else {
          prod *= b[j]
        }
      })
      acc += (_fact[s] * _fact[n - s - 1] * prod) / _fact[n]
    }
    phi.push(acc)
  }
  const prod = (arr: number[]) => arr.reduce((a, v) => a * v, 1)
  const deviation = prod(x) - prod(b)
  const total = phi.reduce((a, p) => a + Math.abs(p), 0)
  const contributions: RiskContribution[] = FACTOR_KEYS.map((k, i) => ({
    factor: k,
    label: FACTOR_LABEL[k],
    value: Math.round(values[k] * 1e4) / 1e4,
    baseline: FACTOR_BASELINE[k],
    phi: Math.round(phi[i] * 1e4) / 1e4,
    share: total > 0 ? Math.round((phi[i] / total) * 1e4) / 1e4 : 0,
  })).sort((a2, b2) => Math.abs(b2.share) - Math.abs(a2.share))
  return {
    method: 'exact-shapley-multiplicative',
    baseline: { ...FACTOR_BASELINE },
    baselineRisk: Math.round(prod(b) * 1e4) / 1e4,
    deviation: Math.round(deviation * 1e4) / 1e4,
    unclamped: risk !== undefined && prod(x) > 1,
    contributions,
  }
}

export function riskIndexLocal(
  materialId: string,
  o2Pct: number,
  flowCms = 0,
  gravity = 'microgravity',
): RiskResult {
  const m = model.materials[materialId] ?? model.materials.pmma ?? MATERIALS[0]
  const loc = m.locPct ?? 17
  const margin = o2Pct - loc
  const p = ignitionPressure(margin, m)
  const f = flowFactor(flowCms)
  const h =
    m.hiddenFactor ??
    1 + 0.25 * Number(m.coolFlameCapable) + 0.15 * Number(m.smoldering) + 0.1 * m.sootIndex
  const g = GRAVITY_FACTOR[gravity] ?? 1
  const risk = Math.max(0, Math.min(1, p * f * h * g))
  const breakdown = {
    ignitionPressure: Math.round(p * 1e4) / 1e4,
    flowFactor: Math.round(f * 1e4) / 1e4,
    hiddenFactor: Math.round(h * 1e4) / 1e4,
    gravityFactor: g,
  }
  return {
    materialId: m.id,
    materialName: m.name,
    o2Pct,
    flowCms,
    gravity,
    locPct: loc,
    margin: Math.round(margin * 100) / 100,
    riskIndex: Math.round(risk * 1e4) / 1e4,
    level: riskLevel(risk),
    breakdown,
    uncertainty: uncertaintyLocal(m.id, margin, flowCms, gravity, risk),
    explanation: explainLocal(breakdown, risk),
    flags: {
      coolFlameCapable: Boolean(m.coolFlameCapable),
      smoldering: Boolean(m.smoldering),
      belowLoc: margin <= 0,
    },
  }
}

export function riskCurveLocal(
  materialId: string,
  flowCms = 0,
  gravity = 'microgravity',
  o2Min = 8,
  o2Max = 40,
  step = 0.5,
) {
  const pts = []
  for (let o2 = o2Min; o2 <= o2Max + 1e-9; o2 += step) {
    const r = riskIndexLocal(materialId, o2, flowCms, gravity)
    pts.push({ o2Pct: Math.round(o2 * 100) / 100, riskIndex: r.riskIndex, level: r.level })
  }
  return pts
}
