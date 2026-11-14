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
  flags: { coolFlameCapable: boolean; smoldering: boolean; belowLoc: boolean }
}

const GRAVITY_FACTOR: Record<string, number> = {
  microgravity: 1.0,
  lunar: 0.92,
  martian: 0.95,
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

export function ignitionPressure(margin: number): number {
  const p = model.formula
  if (margin <= 0) return margin > -p.residualBand ? p.ignitionBase : 0
  return Math.min(1, p.ignitionBase + p.ignitionK * Math.pow(margin, p.ignitionExp))
}

export function riskLevel(risk: number): string {
  if (risk < 0.05) return 'minimal'
  if (risk < 0.25) return 'low'
  if (risk < 0.5) return 'moderate'
  if (risk < 0.75) return 'high'
  return 'critical'
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
  const p = ignitionPressure(margin)
  const f = flowFactor(flowCms)
  const h =
    m.hiddenFactor ??
    1 + 0.25 * Number(m.coolFlameCapable) + 0.15 * Number(m.smoldering) + 0.1 * m.sootIndex
  const g = GRAVITY_FACTOR[gravity] ?? 1
  const risk = Math.max(0, Math.min(1, p * f * h * g))
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
    breakdown: {
      ignitionPressure: Math.round(p * 1e4) / 1e4,
      flowFactor: Math.round(f * 1e4) / 1e4,
      hiddenFactor: Math.round(h * 1e4) / 1e4,
      gravityFactor: g,
    },
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
