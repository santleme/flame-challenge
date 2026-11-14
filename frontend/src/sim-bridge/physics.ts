import type { Investigation } from '../types'
import { ignitionPressureLocal, limitingO2 } from '../game/experiments'

/**
 * Physics client — prefers the compiled C++ engine behind the FastAPI
 * bridge (see backend/), degrades to the local TS model when the
 * backend is offline so the demo always runs standalone.
 */

export interface PhysicsPreview {
  ignitionPressure: number
  model: 'droplet' | 'spread'
  materialId: string
  loc: number | null
  engine: 'c++' | 'local'
}

let online: boolean | null = null
let lastCheck = 0
const previewCache = new Map<string, PhysicsPreview>()

async function ping(): Promise<boolean> {
  const now = Date.now()
  if (online !== null && now - lastCheck < 15000) return online
  lastCheck = now
  try {
    const r = await fetch('/health', { signal: AbortSignal.timeout(900) })
    const j = await r.json()
    online = j?.engine === 'c++'
  } catch {
    online = false
  }
  return online
}

export async function engineOnline(): Promise<boolean> {
  return ping()
}

export async function previewExperiment(
  inv: Investigation,
  o2: number,
  flowCms = 0,
): Promise<PhysicsPreview> {
  const key = `${inv.id}:${o2}:${flowCms}`
  const hit = previewCache.get(key)
  if (hit) return hit

  if (await ping()) {
    try {
      const r = await fetch('/api/chamber/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investigationId: inv.id, o2Pct: o2, flowCms }),
        signal: AbortSignal.timeout(1200),
      })
      if (r.ok) {
        const j = await r.json()
        const out: PhysicsPreview = {
          ignitionPressure: j.ignitionPressure,
          model: j.model,
          materialId: j.materialId,
          loc: j.loc,
          engine: 'c++',
        }
        previewCache.set(key, out)
        return out
      }
    } catch {
      online = false
    }
  }

  const out: PhysicsPreview = {
    ignitionPressure: ignitionPressureLocal(inv, o2),
    model: inv.category === 'droplet' ? 'droplet' : 'spread',
    materialId: 'local',
    loc: limitingO2(inv),
    engine: 'local',
  }
  previewCache.set(key, out)
  return out
}
