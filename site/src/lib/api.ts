/**
 * Live API client with deterministic local fallback.
 * Online:  /api/risk, /api/risk/curve hit the C++-calibrated FastAPI.
 * Offline: the bundled mirror in lib/risk.ts (same formula, same JSON).
 */
import { riskCurveLocal, riskIndexLocal, type RiskResult } from './risk'

const TIMEOUT_MS = 1200

async function probe<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

export type EngineStatus = 'checking' | 'cpp' | 'local'

export async function engineStatus(): Promise<EngineStatus> {
  const health = await probe<{ engine?: string }>('/health')
  return health?.engine === 'c++' ? 'cpp' : 'local'
}

export async function riskIndex(
  materialId: string,
  o2Pct: number,
  flowCms: number,
  gravity: string,
): Promise<RiskResult> {
  const live = await probe<RiskResult>(
    `/api/risk?materialId=${materialId}&o2Pct=${o2Pct}&flowCms=${flowCms}&gravity=${gravity}`,
  )
  return live ?? riskIndexLocal(materialId, o2Pct, flowCms, gravity)
}

export interface CurvePoint {
  o2Pct: number
  riskIndex: number
  level: string
}

export async function riskCurve(
  materialId: string,
  flowCms: number,
  gravity: string,
): Promise<CurvePoint[]> {
  const live = await probe<{ points: CurvePoint[] }>(
    `/api/risk/curve?materialId=${materialId}&flowCms=${flowCms}&gravity=${gravity}&o2Min=8&o2Max=40&step=0.5`,
  )
  return live?.points ?? riskCurveLocal(materialId, flowCms, gravity)
}
