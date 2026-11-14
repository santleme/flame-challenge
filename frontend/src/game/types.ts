import type { Investigation } from '../types'

export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type RoomType =
  | 'deck'
  | 'quarters'
  | 'lab'
  | 'combustion'
  | 'fab'
  | 'dock'

export type RoomState = 'building' | 'active' | 'damaged'

export interface Room {
  id: number
  type: RoomType
  rect: Rect
  state: RoomState
  /** 0..1 fit-out progress while state === 'building' */
  buildProgress: number
  /** 0..1 — >=0.5 marks room 'damaged' (offline) */
  damage: number
  experiment: Experiment | null
  /** fabrication run in progress (seconds remaining) */
  fabJob: { remaining: number } | null
  label: string
}

export type CrewRole = 'scientist' | 'engineer'

export type CrewState =
  | 'idle'
  | 'moving'
  | 'working'
  | 'resting'
  | 'fleeing'
  | 'extinguishing'
  | 'injured'
  | 'dead'

export type JobKind =
  | 'build'
  | 'repair'
  | 'experiment'
  | 'fabricate'
  | 'extinguish'
  | 'rest'
  | 'duty-lab'

export interface Job {
  kind: JobKind
  roomId?: number
  /** "x,y" fire tile for extinguish jobs */
  fireKey?: string
}

export interface CrewMember {
  id: number
  name: string
  role: CrewRole
  pos: Vec
  path: Vec[]
  state: CrewState
  job: Job | null
  stamina: number
  morale: number
  health: number
  speed: number
  /** seconds remaining on current stationary task */
  taskTimer: number
}

export type ExperimentState = 'running' | 'done' | 'failed'

/** decomposed risk axes shown in the UI + used to shape incidents */
export interface RiskFactors {
  ignition: number
  propagation: number
  detection: number
  persistence: number
}

export type RiskAxis = keyof RiskFactors

export interface Experiment {
  id: number
  investigationId: string
  /** chosen test condition within the investigation's tested range */
  oxygenPct: number
  /** chosen forced flow, cm/s (SAFFIRE ventilation vector) */
  flowCms: number
  progress: number
  durationSec: number
  riskPct: number
  factors: RiskFactors
  scienceYield: number
  scientistId: number | null
  state: ExperimentState
}

export interface FireTile {
  x: number
  y: number
  /** 0..1 flame size */
  intensity: number
  /** burns down; tile extinguishes at 0 */
  fuel: number
  /** cool-flame mode: invisible to crew/alarms until intensity ~0.6 */
  hidden: boolean
  /** cm/s scaled from the source investigation */
  spreadRate: number
  /** may leave a dormant smolder tile after being put out */
  smolder: boolean
  /** Mir-style chemical fire — carries its own oxidizer; knock-down always
   *  leaves a re-igniting pocket (ventilation cuts don't starve it) */
  selfOxidizing: boolean
  /** scenario smoke/toxicity pressure on crew burn damage (default 1) */
  burnMult: number
  /** seconds of dormancy before re-ignition (smolder) */
  dormant: number
  sourceInv: string
}

export type EventKind = 'info' | 'warn' | 'danger' | 'science' | 'success'

export interface GameEvent {
  id: number
  t: number
  kind: EventKind
  text: string
  /** citation, e.g. "SoFIE-GEL · NASA PSI" */
  ref?: string
}

export type Speed = 0 | 1 | 2 | 4

export interface SupplyDrop {
  inSec: number
}

export interface GameState {
  seed: number
  time: number
  credits: number
  science: number
  safety: number
  shipProgress: number
  scienceSinceGrant: number
  rooms: Room[]
  /** O(1) tile→room lookup, indexed y*GRID_W+x — maintained by addRoomRaw */
  roomByTile: (Room | null)[]
  crew: CrewMember[]
  fires: Map<string, FireTile>
  /** cached BFS distance-from-visible-fire field (see fire.ts fireDistance) */
  fireDist: { sig: string; dist: Int16Array } | null
  events: GameEvent[]
  speed: Speed
  /** purchased NASA spin-off tech ids (tech_spinoffs.json) */
  tech: string[]
  gameOver: 'won' | 'lost' | null
  supply: SupplyDrop
  nextId: number
  version: number
  /** transient hint for the HUD (e.g. invalid placement) */
  notice: string | null
}

export interface ExperimentSpec {
  inv: Investigation
  oxygenPct: number
  flowCms: number
  riskPct: number
  factors: RiskFactors
  dominant: RiskAxis
  scienceYield: number
  durationSec: number
}

export const tileKey = (x: number, y: number) => `${x},${y}`

export function rectTiles(r: Rect): Vec[] {
  const out: Vec[] = []
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y })
  return out
}

export function rectContains(r: Rect, x: number, y: number) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

export function rectCenter(r: Rect): Vec {
  return { x: r.x + r.w / 2 - 0.5, y: r.y + r.h / 2 - 0.5 }
}
