/**
 * Live API client with deterministic local fallback.
 * Online:  /api/risk, /api/risk/curve hit the C++-calibrated FastAPI.
 * Offline: the bundled mirror in lib/risk.ts (same formula, same JSON).
 */
import { riskCurveLocal, riskIndexLocal, type RiskResult, type RiskUncertainty } from './risk'
import { blobToWavPcm16 } from './voice'
import { apiUrl } from './apiBase'
import snapshot from '../data/psi_snapshot.json'

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

/**
 * Fire-and-forget wake-up ping. Free-tier backends (Render/Koyeb) sleep
 * on idle and take ~30-60 s to cold-start, so hit /health the moment the
 * page loads — the request itself boots the container while the user is
 * still on the hero. The tight-probe engineStatus() keeps reporting
 * 'local' until the service is warm; every call site already falls back
 * to the bundled physics mirror in the meantime.
 */
export function warmBackend(): void {
  const base = apiUrl('/health')
  try {
    void fetch(base, { mode: 'cors', cache: 'no-store' }).catch(() => {})
  } catch {
    // offline / blocked — local fallback covers everything anyway
  }
}

export async function engineStatus(): Promise<EngineStatus> {
  const health = await probe<{ engine?: string }>(apiUrl('/health'))
  return health?.engine === 'c++' ? 'cpp' : 'local'
}

export async function riskIndex(
  materialId: string,
  o2Pct: number,
  flowCms: number,
  gravity: string,
): Promise<RiskResult> {
  const live = await probe<RiskResult>(
    apiUrl(`/api/risk?materialId=${materialId}&o2Pct=${o2Pct}&flowCms=${flowCms}&gravity=${gravity}`),
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
    apiUrl(`/api/risk/curve?materialId=${materialId}&flowCms=${flowCms}&gravity=${gravity}&o2Min=8&o2Max=40&step=0.5`),
  )
  return live?.points ?? riskCurveLocal(materialId, flowCms, gravity)
}

/** Chamber settings shared by simulation and dashboard interactions. */
export interface ChamberUiCommand {
  set_o2_percent?: number | null
  set_airflow_cm_s?: number | null
  load_preset?: string | null
  __investigation?: string | null
  __presetId?: string | null
  __origin?: string
  __run?: boolean
  set_gravity_g?: number | null
  trigger_containment?: string | null
}

export interface SiChamberState {
  investigationId?: string | null
  materialId?: string | null
  o2Pct: number
  flowCms: number
  gravity: string
  sealed?: boolean
  module?: string | null
}

export interface SiEvidence {
  runId: string
  accession: string
  investigationId: string
  fuel: string
  outcome: string
  similarity: number
  verified: boolean
  sourceUrl: string
  o2Pct?: number | null
  flowCms?: number | null
  materialKey?: string | null
  coolFlame?: boolean
}

export interface SiSimulationCommands {
  load_preset?: string | null
  set_o2_percent?: number | null
  set_airflow_cm_s?: number | null
  set_gravity_g?: number | null
  trigger_containment?: string | null
}

export interface SiResponse {
  briefing: string
  recommended_action: string
  ui_command: ChamberUiCommand | null
  navigation?: { scroll_to_section?: string | null; active_filter_tag?: string | null } | null
  simulation_commands?: SiSimulationCommands | null
  mode: 'llm' | 'offline-fallback' | 'local-fallback'
  model: string
  engine?: string
  chamber?: Record<string, unknown>
  evidence: SiEvidence[]
  transcript?: string | null
  stt?: 'whisper.cpp' | 'offline'
}

export async function siChat(message: string, state: SiChamberState): Promise<SiResponse | null> {
  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 25000)
    const response = await fetch(apiUrl('/api/si/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, current_chamber_state: state }),
      signal: controller.signal,
    })
    window.clearTimeout(timeout)
    if (response.ok) return (await response.json()) as SiResponse
    return synthesizeLocalSiResponse(message, state)
  } catch {
    return synthesizeLocalSiResponse(message, state)
  }
}

export async function siVoice(audio: Blob, state: SiChamberState): Promise<SiResponse | null> {
  try {
    const wav = await blobToWavPcm16(audio)
    const form = new FormData()
    form.append('audio', wav, 'clip.wav')
    form.append('state', JSON.stringify(state))
    // free-tier backends sleep — an abort/reset during cold boot gets one
    // retry before we report the uplink unreachable
    let response: Response | null = null
    for (let attempt = 0; attempt < 2 && !response; attempt++) {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 70000)
      try {
        response = await fetch(apiUrl('/api/si/voice-command'), { method: 'POST', body: form, signal: controller.signal })
      } catch (err) {
        if (attempt === 1) throw err
        await new Promise((r) => setTimeout(r, 1500))
      } finally {
        window.clearTimeout(timeout)
      }
    }
    if (response && response.ok) return (await response.json()) as SiResponse
    return {
      briefing: 'Voice command service is currently unavailable or speech could not be transcribed.',
      recommended_action: 'Use manual controls or retry voice input.',
      ui_command: null,
      simulation_commands: null,
      mode: 'offline-fallback',
      model: 'none',
      evidence: [],
      transcript: null,
      stt: 'offline',
    }
  } catch {
    return {
      briefing: 'Voice command service is currently unreachable.',
      recommended_action: 'Check backend connection or use manual controls.',
      ui_command: null,
      simulation_commands: null,
      mode: 'offline-fallback',
      model: 'none',
      evidence: [],
      transcript: null,
      stt: 'offline',
    }
  }
}

export function synthesizeLocalSiResponse(message: string, state: SiChamberState): SiResponse {
  const q = message.toLowerCase()
  let invId = state.investigationId ?? 'flex-2'
  let materialId = state.materialId ?? (FALLBACK_INVESTIGATIONS[invId]?.materialId ?? 'heptane')
  let o2Pct = state.o2Pct ?? 21
  let flowCms = state.flowCms ?? 2.0
  const gravity = state.gravity ?? 'microgravity'
  let briefing = ''
  let action = ''

  // 1. Parse oxygen dynamically (target 'to X%' takes priority over 'from X%')
  const toO2Match = q.match(/(?:to|->|→)\s*(\d+(?:\.\d+)?)\s*%/i)
  const plainO2Match = q.match(/(\d+(?:\.\d+)?)\s*%/i)
  if (toO2Match) {
    o2Pct = parseFloat(toO2Match[1])
  } else if (plainO2Match) {
    o2Pct = parseFloat(plainO2Match[1])
  } else if (q.includes('oxygen drops') || q.includes('drops to') || q.includes('o2 drops')) {
    o2Pct = 18
  }

  // 2. Parse airflow dynamically (target 'to X cm/s' takes priority over source)
  const toFlowMatch = q.match(/(?:to|->|→)\s*(\d+(?:\.\d+)?)\s*cm\/s/i)
  const plainFlowMatch = q.match(/(\d+(?:\.\d+)?)\s*cm\/s/i)
  const flowCut = !toFlowMatch && !plainFlowMatch &&
    (q.includes('cut airflow') || q.includes('stop airflow') || q.includes('cut ventilation') || q.includes('stagnant'))
  if (toFlowMatch) {
    flowCms = parseFloat(toFlowMatch[1])
  } else if (plainFlowMatch) {
    flowCms = parseFloat(plainFlowMatch[1])
  } else if (flowCut) {
    flowCms = 0.0
  }
  // numeric match or an explicit shutdown — the mission defaults below
  // must not resurrect airflow the operator asked to kill
  const flowExplicit = Boolean(toFlowMatch || plainFlowMatch || flowCut)

  // 3. Resolve investigation & material:
  // First, check for explicit queries. Word boundaries on the ambiguous
  // tokens — "the same conditions" is not the SAME rig and "atmosphere"
  // is not a BASS-II sphere.
  if (q.includes('cotton') || q.includes('saffire') || q.includes('sibal')) {
    invId = 'saffire'
    materialId = 'cotton'
    if (!flowExplicit && (state.flowCms == null || state.flowCms <= 2.0)) flowCms = 20.0
  } else if (q.includes('hidden flame') || q.includes('cool flame') || q.includes('heptane') || q.includes('droplet')) {
    invId = 'flex-2'
    materialId = 'heptane'
    if (!flowExplicit) flowCms = 0.5
  } else if (q.includes('sofie') || q.includes('acrylic') || q.includes('pmma slab')) {
    invId = 'sofie-gel'
    materialId = 'pmma'
  } else if (q.includes('flare') || q.includes('airlock') || q.includes('artemis')) {
    invId = 'flare'
    materialId = 'pmma'
  } else if (/\bsame[-_\s]?r\b/i.test(q) || q.includes('teflon')) {
    invId = 'same'
    materialId = 'teflon'
  } else if (q.includes('acme') || q.includes('ethylene')) {
    invId = 'acme'
    materialId = 'ethylene'
  } else if (/\bbass\b/i.test(q) || /\bsphere\b/i.test(q)) {
    invId = 'bass-ii'
    materialId = 'pmma-sphere'
  } else if (/\bpmma\b/i.test(q)) {
    // bare "PMMA" (a SimDeck starter) → the flat-slab rig
    invId = 'sofie-gel'
    materialId = 'pmma'
  } else if (state.investigationId && FALLBACK_INVESTIGATIONS[state.investigationId]) {
    // Preserve incoming mission state if no explicit investigation in query
    invId = state.investigationId
    materialId = state.materialId ?? FALLBACK_INVESTIGATIONS[invId].materialId
  }

  // 4. Construct grounded technical briefing
  if (invId === 'saffire' || materialId === 'cotton') {
    briefing =
      'LOCAL ENGINE GROUNDED ANALYSIS (NASA SAFFIRE vs Earth 1g): In Earth 1g, natural buoyancy causes rapid vertical convective flame acceleration with a tall teardrop plume. In microgravity, buoyancy is absent; however, forced cabin airflow continuously sweeps oxidizer across the SIBAL cotton fabric, creating sustained steady spread with thick char formation.'
    action = 'Isolate compartment air ducts immediately to cut forced convective flow.'
  } else if (invId === 'flex-2' || materialId === 'heptane') {
    briefing =
      'LOCAL ENGINE GROUNDED ANALYSIS (NASA FLEX-2 Cool-Flame Catalog): In 53 documented NASA PSI runs, hydrocarbon droplets exhibited radiative extinction of the visible hot flame, followed by sustained low-temperature (~600–720 K) invisible burning. Premature atmosphere replenishment causes violent explosive flashover.'
    action =
      'Maintain nitrogen purge hold for at least 180 seconds; verify thermal core temperature with IR sensors before hatch release.'
  } else if (invId === 'flare') {
    briefing = `LOCAL ENGINE GROUNDED ANALYSIS (NASA FLARE Partial Gravity): Under ${gravity} (${o2Pct}% O₂ at ${flowCms} cm/s), partial buoyancy creates a steady chimney updraft along solid PMMA conduits without inducing blowout, causing rapid boundary-layer flame propagation.`
    action = 'Seal airlock bulkhead and throttle recirculating airflow below 1 cm/s.'
  } else if (invId === 'sofie-gel') {
    briefing = `LOCAL ENGINE GROUNDED ANALYSIS (NASA PSI SoFIE-GEL): Modulating atmospheric oxygen to ${o2Pct}% O₂ shifts PMMA solid combustion relative to the microgravity Limiting Oxygen Concentration (LOC ≈ 15.0%). Flame spread rate scales with oxidizer availability while sustaining low-speed diffusion kinetics.`
    action = 'Throttle cabin ventilation to < 1 cm/s to induce radiative extinction below LOC.'
  } else {
    briefing = `LOCAL ENGINE GROUNDED ANALYSIS (${invId.toUpperCase()}): Scenario evaluated under ${o2Pct}% O₂ at ${flowCms} cm/s (${gravity}). Physical solver bounds confirm stable boundary layer reaction with microgravity diffusion kinetics.`
    action = 'Monitor exhaust particulates via multi-point duct sensors.'
  }

  const riskRes = riskIndexLocal(materialId, o2Pct, flowCms, gravity)

  const evidence: SiEvidence[] = [
    {
      runId: `psi-${invId}-local`,
      accession: `PSI-${invId.toUpperCase()}-SYNTH`,
      investigationId: invId,
      fuel: materialId,
      outcome: 'grounded physical solver calculation',
      similarity: 88,
      verified: false,
      sourceUrl: 'https://psi.nasa.gov/physci/repo',
      o2Pct,
      flowCms,
    },
  ]

  return {
    briefing,
    recommended_action: action,
    ui_command: {
      load_preset: invId,
      set_o2_percent: o2Pct,
      set_airflow_cm_s: flowCms,
    },
    simulation_commands: {
      load_preset: invId,
      set_o2_percent: o2Pct,
      set_airflow_cm_s: flowCms,
    },
    mode: 'local-fallback',
    model: 'ignis-local-physics-head',
    chamber: {
      riskIndex: riskRes.riskIndex,
      level: riskRes.level,
      materialId,
      o2Pct,
      flowCms,
      gravity,
      uncertainty: riskRes.uncertainty,
    },
    evidence,
  }
}

export function gravityRegime(g: number): string {
  if (g <= 0.02) return 'microgravity'
  if (g < 0.3) return 'lunar'
  if (g < 0.7) return 'martian'
  return 'earth'
}

/* ---------- materials index ---------- */

export interface InvestigationSpec {
  model: string
  materialId: string
  o2Range: [number, number]
  flowRangeCms: [number, number]
  pressureKpa?: number
  loc?: number
  partialGravity?: boolean
}

export function investigationDefaultFlow(id: string, specs: Record<string, InvestigationSpec> = FALLBACK_INVESTIGATIONS): number {
  const range = specs[id]?.flowRangeCms ?? [0, 0]
  return (range[0] + range[1]) / 2
}

export async function materialsIndex(): Promise<Record<string, InvestigationSpec>> {
  const live = await probe<{ investigations: Record<string, InvestigationSpec> }>(apiUrl('/api/materials'))
  return live?.investigations ?? FALLBACK_INVESTIGATIONS
}

/** Embedded copy of shared/calibrated-data/calibration.json investigation
 *  shells — used only when the API is unreachable so presets still load. */
export const FALLBACK_INVESTIGATIONS: Record<string, InvestigationSpec> = {
  'sofie-gel': { model: 'spread', materialId: 'pmma', o2Range: [15, 24], flowRangeCms: [0, 25], loc: 15 },
  'bass-ii': { model: 'spread', materialId: 'pmma-sphere', o2Range: [17, 40], flowRangeCms: [0, 20], loc: 17 },
  'flex-2': { model: 'droplet', materialId: 'heptane', o2Range: [12, 34], flowRangeCms: [0, 2.55] },
  acme: { model: 'spread', materialId: 'ethylene', o2Range: [12, 85], flowRangeCms: [0, 70] },
  saffire: { model: 'spread', materialId: 'cotton', o2Range: [21.5, 22.1], flowRangeCms: [20, 30] },
  same: { model: 'spread', materialId: 'teflon', o2Range: [21, 21], flowRangeCms: [0, 10] },
  'confined-combustion': { model: 'spread', materialId: 'thin-sheet', o2Range: [19, 40], flowRangeCms: [0, 15] },
  flare: { model: 'spread', materialId: 'pmma', o2Range: [15, 40], flowRangeCms: [0, 30], partialGravity: true },
}

export async function siNeighbors(materialId: string, o2Pct: number, flowCms: number): Promise<SiEvidence[] | null> {
  const live = await probe<{ neighbors: SiEvidence[] }>(
    apiUrl(`/api/neighbors?materialId=${encodeURIComponent(materialId)}&o2Pct=${o2Pct}&flowCms=${flowCms}&k=3`),
  )
  return live?.neighbors ?? null
}

/** Rank pillar — /api/risk/rank when the backend is up (same model the
 *  local rankMaterials mirrors). `rank` is assigned client-side. */
export async function riskRank(
  o2Pct: number,
  flowCms: number,
  gravity: string,
  top = 8,
): Promise<{ ranked: RiskResult[]; engine: string } | null> {
  const live = await probe<{ ranked?: RiskResult[]; engine?: string }>(
    apiUrl(`/api/risk/rank?o2Pct=${o2Pct}&flowCms=${flowCms}&gravity=${gravity}&top=${top}`),
  )
  return live?.ranked
    ? { ranked: live.ranked, engine: live.engine ?? 'api' }
    : null
}

export interface DecisionOption {
  label: string
  why: string
  score: number
  action: string
  /** conformal band on the counterfactual point (MAPIE-fitted) */
  uncertainty?: RiskUncertainty | null
  /** counterfactual chamber point the score was evaluated at */
  model?: { materialId: string; o2Pct: number; flowCms: number; gravity: string }
}

export interface DecisionCard {
  id: string
  context: string
  question: string
  metric: string
  options: DecisionOption[]
  sources: string[]
}

export interface DecisionPayload {
  engine: string
  briefing: string
  cards: DecisionCard[]
  neighbors: { runId: string; accession: string; fuel: string; similarity: number; outcome: string }[]
  material: { materialId: string }
  chamber?: {
    materialId: string
    requestedMaterialId?: string
    o2Pct: number
    flowCms: number
    ignitionPressure: number
  }
}

/** Interpret pillar — live tactical synthesis from the backend; the
 *  caller falls back to lib/dashboard's localTactics when null. */
export async function decisionCards(
  materialId: string,
  o2Pct: number,
  flowCms: number,
  gravity: string,
): Promise<DecisionPayload | null> {
  return probe<DecisionPayload>(
    apiUrl(`/api/decision-cards?materialId=${materialId}&o2Pct=${o2Pct}&flowCms=${flowCms}&gravity=${gravity}`),
  )
}

// ---------- investigation intelligence (live API → baked snapshot) ----------

export interface InvestigationStats {
  nRuns: number
  nLabeled: number
  burnFrac: number | null
  extinctFrac: number | null
  coolFlameRuns: number
  hiddenExtinctRuns: number
  o2Measured: [number, number] | null
  burnRateMedianMm2s: number | null
}

export interface InvestigationCard {
  id: string
  name: string
  rank: number
  score: number
  breakdown: Record<'flammability' | 'hiddenHazard' | 'explorationRelevance' | 'dataRichness', number>
  model: string | null
  materialId: string | null
  hazards: string[]
  o2Range: [number, number] | null
  flowRangeCms: [number, number] | null
  pressureKpa: number | null
  partialGravity: boolean
  effectiveLoc: number | null
  stats: InvestigationStats
  summary: string
  psiUrl: string
  engineFidelity?: { scoredRuns: number; accuracy: number }
}

export interface InvestigationDetail extends InvestigationCard {
  material?: {
    id: string
    name: string
    locPct: number
    locSource: string
    ignitionFitScope: string | null
    psiRuns: number
  }
  sampleRuns: {
    runId: string
    accession: string
    fuel: string
    o2Pct: number | null
    outcome: string
    extinctionType: string
    sourceUrl: string
    verified: string
  }[]
}

export interface Insight {
  id: string
  severity: 'high' | 'medium' | 'info'
  title: string
  body: string
  evidence: Record<string, unknown>
  sources: string[]
}

const snap = snapshot as unknown as {
  leaderboard: { weights: Record<string, number>; items: InvestigationCard[] }
  details: Record<string, InvestigationDetail>
  insights: { labeledRuns: number; items: Insight[] }
}

export async function investigations(): Promise<{
  weights: Record<string, number>
  items: InvestigationCard[]
  live: boolean
}> {
  const live = await probe<{ weights: Record<string, number>; items: InvestigationCard[] }>(
    apiUrl('/api/investigations'),
  )
  return live ? { ...live, live: true } : { ...snap.leaderboard, live: false }
}

export async function investigationDetail(
  id: string,
): Promise<InvestigationDetail | null> {
  const live = await probe<InvestigationDetail>(apiUrl(`/api/investigations/${id}`))
  return live ?? snap.details[id] ?? null
}

export async function insights(): Promise<{
  labeledRuns: number
  items: Insight[]
  live: boolean
}> {
  const live = await probe<{ labeledRuns: number; items: Insight[] }>(apiUrl('/api/insights'))
  return live ? { ...live, live: true } : { ...snap.insights, live: false }
}
