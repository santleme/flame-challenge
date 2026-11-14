export type Category =
  | 'solid-flame-spread'
  | 'droplet'
  | 'gaseous-diffusion'
  | 'large-scale-fire'
  | 'smoke-aerosol'
  | 'confined'
  | 'partial-gravity'

export type HazardTag =
  | 'low-oxygen-persistence'
  | 'cool-flames'
  | 'smolder-risk'
  | 'toxic-aerosol'
  | 'large-scale-spread'
  | 'detection-gap'
  | 'exploration-atmosphere'
  | 'partial-gravity'

export type DataAvailability = 'full' | 'partial' | 'metadata-only'

export interface Investigation {
  id: string
  name: string
  title: string
  agencies: string[]
  platform: string
  facility: string | null
  years: string
  status: 'completed' | 'ongoing'
  category: Category
  gravity: 'microgravity' | 'partial-gravity' | 'mixed'
  fuels: string[]
  conditions: {
    oxygenPct: [number, number] | null
    flowCms: [number, number] | null
    pressureKpa: number | null
    explorationRelevant: boolean
  }
  metrics: {
    limitingOxygenPct: number | null
    flameSpreadRateCms: { min: number; max: number } | null
    coolFlameObserved: boolean
    smolderObserved: boolean
  }
  keyFindings: string[]
  safetyImplications: string[]
  hazards: HazardTag[]
  data: { availability: DataAvailability; psiUrl: string | null }
  publications: number
  /** false = curated starter value pending verification against PSI files */
  verified: boolean
  /** injected by data/pipelines/build_dataset.py when PSI runs were merged */
  psiRuns?: number
  psiAccessions?: string[]
  psiFuels?: string[]
  psiO2RangePct?: [number, number]
  psiExtinctionLimitPct?: { min: number; max: number }
}

export interface Dataset {
  schemaVersion: number
  generated: string
  note: string
  investigations: Investigation[]
}

export interface ScoreBreakdown {
  flammability: number
  hiddenHazard: number
  relevance: number
  dataRichness: number
  total: number
}

export interface RankedInvestigation {
  inv: Investigation
  rank: number
  score: ScoreBreakdown
  summary: string
}

export type InsightKind = 'detection' | 'materials' | 'atmosphere' | 'operations'
export type Severity = 'critical' | 'high' | 'medium'

export interface Insight {
  id: string
  kind: InsightKind
  severity: Severity
  title: string
  body: string
  sources: string[]
}

// ---------- auditable master sheet (data/processed/nasa_combustion_master.csv) ----------

export type MasterRecordType = 'investigation' | 'material' | 'incident' | 'experiment_run'

/** one row of nasa_combustion_master.csv — fields mirror the CSV columns;
 *  range-bearing rows use *_min/*_max, point rows use the plain field */
export interface MasterRow {
  record_type: MasterRecordType
  id: string
  name: string
  investigation_id?: string
  material_id?: string
  fuel_or_material?: string
  o2_pct?: string | number
  o2_min?: string | number
  o2_max?: string | number
  flow_cms?: string | number
  flow_min?: string | number
  flow_max?: string | number
  pressure_kpa?: string | number
  gravity_g?: string | number
  loc_pct?: string | number
  spread_mm_s?: string
  droplet_d0_mm?: string | number
  burn_rate_mm2_s?: string | number
  extinction_d_mm?: string | number
  extinction_type?: string
  outcome?: string
  cool_flame?: string
  smolder?: string
  soot_index?: string | number
  hidden_factor?: string | number
  psi_runs?: string | number
  psi_cool_flame_runs?: string | number
  verified?: string
  source?: string
  source_url?: string
  notes?: string
}

// ---------- decision dashboard ----------

/** environment pill — feeds the risk engine's gravity factor + grid filter */
export type EnvKey = 'microgravity' | 'lunar' | 'martian' | 'historical' | 'earth'

/** shared cabin conditions across RiskBoard / PsiGrid / decision cards */
export interface DashConditions {
  env: EnvKey
  o2Pct: number
  flowCms: number
  /** grid/master-sheet filter tag (e.g. 'cool-flame', 'incident') */
  tag: string | null
}

export interface DecisionOption {
  label: string
  why: string
  /** engine-provided efficacy (0-100); when absent the UI scores the model locally */
  score?: number
  /** countermeasure identifier — lets a click actually apply the action
   *  to the replayed fire instead of only adopting its atmosphere */
  action?: string
  model: {
    materialId: string
    o2Pct: number
    flowCms: number
    gravity?: string
  }
}

/** one real PSI run returned by the KNN lookup (/api/neighbors) or the
 *  offline mirror over the master sheet */
export interface NeighborRef {
  runId: string
  accession: string
  investigationId: string
  fuel: string
  materialKey: string | null
  o2Pct: number | null
  flowCms: number | null
  outcome: string
  coolFlame: boolean
  similarity: number
  sourceUrl: string
  verified: boolean
}

export interface DecisionCard {
  id: string
  context: string
  question: string
  preset: string
  metric: string
  options: DecisionOption[]
  sources: string[]
  /** nearest real PSI runs behind this card's scores */
  neighbors?: NeighborRef[]
}

/** GET /api/decision-cards response */
export interface DecisionCardsPayload {
  engine: 'c++'
  chamber: {
    /** resolved material — may differ from the requested id (unknown ids
     *  fall back to the risk table's PMMA anchor) */
    materialId: string
    /** material id the caller asked for, before resolution */
    requestedMaterialId?: string
    o2Pct: number
    flowCms: number
    ignitionPressure: number
  }
  briefing: string
  neighbors: NeighborRef[]
  cards: DecisionCard[]
}
