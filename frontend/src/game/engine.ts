import { getInvestigations } from '../lib/data'
import { BALANCE, GRID_H, GRID_W, ROOM_SPECS, mulberry32 } from './config'
import { crewName } from './names'
import { findPath } from './pathfind'
import { isWalkable, igniteRoom, roomAt, updateFires, extinguishAt } from './fire'
import { musterPoint, pathTo, roomSpot, updateCrewMember } from './crew'
import { citation, rollsHidden, specFor } from './experiments'
import { applyScenario, SCENARIOS } from './scenarios'
import { buyTech as buyTechImpl } from './tech'
import type {
  Countermeasure,
  CrewMember,
  CrewRole,
  EventKind,
  GameState,
  Rect,
  Room,
  RoomType,
  Speed,
  Vec,
} from './types'
import { rectContains, rectTiles } from './types'

const investigations = getInvestigations()
export const invById = new Map(investigations.map((i) => [i.id, i]))
export { investigations }

type LogFn = (kind: EventKind, text: string, ref?: string) => void

export class Engine {
  state: GameState
  private rng: () => number
  private listeners = new Set<() => void>()
  private schedTimer = 0
  private emitAcc = 0

  constructor(seed = (Date.now() % 100000) | 0) {
    this.rng = mulberry32(seed)
    this.state = {
      seed,
      time: 0,
      credits: BALANCE.startCredits,
      science: BALANCE.startScience,
      safety: BALANCE.startSafety,
      shipProgress: 0,
      scienceSinceGrant: 0,
      rooms: [],
      crew: [],
      fires: new Map(),
      events: [],
      speed: 1,
      tech: [],
      gameOver: null,
      supply: { inSec: BALANCE.supplyEverySec },
      nextId: 1,
      version: 0,
      notice: null,
    }
    this.bootstrap()
  }

  private log: LogFn = (kind, text, ref) => {
    const e = this.state
    e.events.unshift({ id: e.nextId++, t: e.time, kind, text, ref })
    if (e.events.length > 80) e.events.length = 80
  }

  private notice(text: string) {
    this.state.notice = text
    setTimeout(() => {
      if (this.state.notice === text) this.state.notice = null
    }, 1800)
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.state.version++
    for (const fn of this.listeners) fn()
  }

  // ---------- setup ----------

  private bootstrap() {
    // dock pre-built on the upper-left edge; a small deck apron around it
    this.addRoomRaw('dock', { x: 3, y: 3, w: 3, h: 3 }, 'Docking Arm A')
    this.addRoomRaw('deck', { x: 6, y: 3, w: 3, h: 3 }, 'Deck apron')
    const dock = this.state.rooms[0]
    for (let i = 0; i < BALANCE.startCrew.engineers; i++)
      this.spawnCrew('engineer', dock)
    for (let i = 0; i < BALANCE.startCrew.scientists; i++)
      this.spawnCrew('scientist', dock)
    this.log('info', 'Shipyard deck initialized. Build modules adjacent to existing structure.')
    this.log('science', 'Experiment library loaded: NASA PSI microgravity combustion records.')
  }

  private addRoomRaw(type: RoomType, rect: Rect, label?: string): Room {
    const e = this.state
    const room: Room = {
      id: e.nextId++,
      type,
      rect,
      state: type === 'dock' || type === 'deck' ? 'active' : 'building',
      buildProgress: type === 'dock' || type === 'deck' ? 1 : 0,
      damage: 0,
      experiment: null,
      fabJob: null,
      countermeasures: [],
      label: label ?? `${ROOM_SPECS[type].label} ${e.nextId}`,
    }
    e.rooms.push(room)
    return room
  }

  private spawnCrew(role: CrewRole, room?: Room): CrewMember | null {
    const e = this.state
    if (e.crew.filter((c) => c.state !== 'dead').length >= BALANCE.crewCap) return null
    const dock = room ?? e.rooms.find((r) => r.type === 'dock') ?? e.rooms[0]
    const spot = roomSpot(dock)
    const c: CrewMember = {
      id: e.nextId++,
      name: crewName(this.rng),
      role,
      pos: { x: spot.x + (this.rng() - 0.5), y: spot.y + (this.rng() - 0.5) },
      path: [],
      state: 'idle',
      job: null,
      stamina: 70 + this.rng() * 30,
      morale: 80,
      health: 100,
      speed: BALANCE.crewSpeedTps * (0.9 + this.rng() * 0.2),
      taskTimer: 0,
    }
    e.crew.push(c)
    return c
  }

  // ---------- player actions ----------

  setSpeed(s: Speed) {
    this.state.speed = s
    this.emit()
  }

  canPlace(type: RoomType, rect: Rect): { ok: boolean; reason?: string } {
    const e = this.state
    const spec = ROOM_SPECS[type]
    if (rect.w < spec.minW || rect.h < spec.minH)
      return { ok: false, reason: `Min ${spec.minW}×${spec.minH}` }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > GRID_W || rect.y + rect.h > GRID_H)
      return { ok: false, reason: 'Outside deck frame' }
    for (const r of e.rooms)
      for (const t of rectTiles(rect))
        if (rectContains(r.rect, t.x, t.y)) return { ok: false, reason: 'Overlaps existing module' }
    const tiles = rect.w * rect.h
    if (e.credits < tiles * spec.costPerTile) return { ok: false, reason: 'Insufficient credits' }
    // must connect: at least one rect edge-adjacent tile belongs to a room
    let adjacent = false
    for (const t of rectTiles(rect)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = t.x + dx
        const ny = t.y + dy
        if (rectContains(rect, nx, ny)) continue
        if (roomAt(e, nx, ny)) {
          adjacent = true
          break
        }
      }
      if (adjacent) break
    }
    if (!adjacent) return { ok: false, reason: 'Must connect to existing structure' }
    return { ok: true }
  }

  placeRoom(type: RoomType, rect: Rect): boolean {
    const check = this.canPlace(type, rect)
    if (!check.ok) {
      this.notice(check.reason ?? 'Cannot build here')
      return false
    }
    const spec = ROOM_SPECS[type]
    this.state.credits -= rect.w * rect.h * spec.costPerTile
    this.addRoomRaw(type, rect)
    this.log('info', `${ROOM_SPECS[type].label} laid down — awaiting construction.`)
    this.emit()
    return true
  }

  startExperiment(
    roomId: number,
    invId: string,
    oxygenPct: number,
    flowCms = 0,
    ignitionPressure?: number,
  ): boolean {
    const e = this.state
    const room = e.rooms.find((r) => r.id === roomId)
    const inv = invById.get(invId)
    if (!room || room.type !== 'combustion' || room.state !== 'active' || !inv) return false
    if (room.experiment) return false
    const spec = specFor(inv, oxygenPct, flowCms, ignitionPressure)
    room.experiment = {
      id: e.nextId++,
      investigationId: inv.id,
      oxygenPct,
      flowCms,
      progress: 0,
      durationSec: spec.durationSec,
      riskPct: spec.riskPct,
      factors: spec.factors,
      scienceYield: spec.scienceYield,
      scientistId: null,
      state: 'running',
    }
    this.log(
      'science',
      `Experiment queued: ${inv.name} @ ${oxygenPct}% O₂ — risk ${spec.riskPct}%.`,
      citation(inv),
    )
    this.emit()
    return true
  }

  startFabrication(roomId: number): boolean {
    const e = this.state
    const room = e.rooms.find((r) => r.id === roomId)
    if (!room || room.type !== 'fab' || room.state !== 'active' || room.fabJob) return false
    if (e.science < BALANCE.fabCostScience || e.credits < BALANCE.fabCostCredits) {
      this.notice(`Needs ${BALANCE.fabCostScience} sci + ${BALANCE.fabCostCredits} cr`)
      return false
    }
    e.science -= BALANCE.fabCostScience
    e.credits -= BALANCE.fabCostCredits
    room.fabJob = { remaining: BALANCE.fabDurationSec }
    this.log('info', `Fabrication started in ${room.label} — ship section incoming.`)
    this.emit()
    return true
  }

  /** replay a documented NASA fire incident in the largest active module */
  triggerScenario(id: string): boolean {
    const s = SCENARIOS.find((x) => x.id === id)
    if (!s) return false
    const ok = applyScenario(this.state, id, this.rng, this.log)
    if (!ok) {
      this.notice('No active module to host the scenario')
      return false
    }
    this.emit()
    return true
  }

  /** one-click historical/experimental preset from the top selector */
  runPreset(id: string): boolean {
    if (id === 'free-shipyard') return true // default sandbox — nothing to seed
    // scenario presets (historical JSON) take precedence
    if (SCENARIOS.some((s) => s.id === id)) return this.triggerScenario(id)
    // experiment preset (e.g. 'flex-2'): auto-start in the first free
    // combustion chamber at the investigation's mid-range atmosphere
    const inv = invById.get(id)
    const room = this.state.rooms.find(
      (r) => r.type === 'combustion' && r.state === 'active' && !r.experiment,
    )
    if (!inv || !room) {
      this.notice('No free combustion chamber for the preset')
      return false
    }
    const [o2lo, o2hi] = inv.conditions.oxygenPct ?? [18, 24]
    const [flo, fhi] = inv.conditions.flowCms ?? [0, 0]
    return this.startExperiment(
      room.id, inv.id, (o2lo + o2hi) / 2, (flo + fhi) / 2,
    )
  }

  /** tactical countermeasure on a burning module (one-shot per kind) */
  countermeasure(roomId: number, kind: Countermeasure): boolean {
    const room = this.state.rooms.find((r) => r.id === roomId)
    if (!room || room.countermeasures.includes(kind)) return false
    const fires = [...this.state.fires.entries()].filter(([, f]) =>
      f.dormant <= 0 && rectContains(room.rect, f.x, f.y))
    if (!fires.length) {
      this.notice('No active fire in that module')
      return false
    }
    room.countermeasures.push(kind)
    if (kind === 'vent-cut') {
      if (room.experiment) room.experiment.flowCms = 0
      for (const [, f] of fires) f.spreadRate *= 0.22
      this.log('warn', `${room.label}: ventilation cut — opposed-flow drive removed (−78% spread).`)
    } else if (kind === 'depressurize') {
      if (room.experiment) room.experiment.oxygenPct = 14
      for (const [, f] of fires) {
        f.spreadRate *= 0.45
        f.intensity *= 0.8
      }
      this.log('warn', `${room.label}: depressurizing — O₂ below LOC margin (−55% spread).`)
    } else {
      // suppression burst: same knock-down path as crew extinguish
      for (const [k] of fires) extinguishAt(this.state, k, 1.5, this.rng)
      this.log('warn', `${room.label}: localized suppression discharged (−50% intensity).`)
    }
    this.emit()
    return true
  }

  /** spend science on a NASA spin-off upgrade */
  buyTech(id: string): boolean {
    if (buyTechImpl(this.state, id)) {
      const t = this.state.tech[this.state.tech.length - 1]
      this.log('science', `Unlocked ${t} — NASA spin-off technology fielded.`)
      this.emit()
      return true
    }
    this.notice('Insufficient science')
    return false
  }

  hire(role: CrewRole): boolean {
    const e = this.state
    const cost = BALANCE.hireCost[role]
    if (e.credits < cost) {
      this.notice('Insufficient credits')
      return false
    }
    const c = this.spawnCrew(role)
    if (!c) {
      this.notice('Crew cap reached')
      return false
    }
    e.credits -= cost
    this.log('info', `${c.name} (${role}) arrived via docking arm.`)
    this.emit()
    return true
  }

  // ---------- job scheduler ----------

  private assignJobs() {
    const e = this.state
    const activeFires = [...e.fires.values()].filter((f) => !f.hidden && f.dormant <= 0)
    const fireClaims = new Map<string, number>()

    for (const c of e.crew) {
      if (c.state === 'dead' || c.state === 'fleeing' || c.state === 'resting') continue
      // injured → forced rest
      if (c.health < 45 && c.job?.kind !== 'rest') {
        const q =
          e.rooms.find((r) => r.type === 'quarters' && r.state === 'active') ??
          e.rooms.find((r) => r.type === 'dock')
        if (q) {
          c.job = { kind: 'rest', roomId: q.id }
          c.state = 'injured'
        }
      }

      // engineers: nearest visible fire → extinguish (max 2 per tile)
      if (c.role === 'engineer' && activeFires.length && c.job?.kind !== 'extinguish' && c.state !== 'injured') {
        let bestF = null
        let bestD = Infinity
        for (const f of activeFires) {
          const claims = fireClaims.get(`${f.x},${f.y}`) ?? 0
          if (claims >= 2) continue
          const d = Math.abs(f.x - c.pos.x) + Math.abs(f.y - c.pos.y)
          if (d < bestD) {
            bestD = d
            bestF = f
          }
        }
        if (bestF) {
          c.job = { kind: 'extinguish', fireKey: `${bestF.x},${bestF.y}` }
          fireClaims.set(`${bestF.x},${bestF.y}`, (fireClaims.get(`${bestF.x},${bestF.y}`) ?? 0) + 1)
          continue
        }
      }

      if (c.job) continue // busy on an assigned job

      if (c.stamina < BALANCE.restThreshold || c.health < 60) {
        const q = e.rooms.find((r) => r.type === 'quarters' && r.state === 'active')
        if (q) {
          c.job = { kind: 'rest', roomId: q.id }
          continue
        }
      }

      if (c.role === 'engineer') {
        const build = e.rooms.find((r) => r.state === 'building')
        if (build) {
          c.job = { kind: 'build', roomId: build.id }
          continue
        }
        const damaged = e.rooms.find((r) => r.state === 'damaged' || r.damage > 0.05)
        if (damaged) {
          c.job = { kind: 'repair', roomId: damaged.id }
          continue
        }
        const fab = e.rooms.find((r) => r.type === 'fab' && r.fabJob && r.state === 'active')
        if (fab) {
          c.job = { kind: 'fabricate', roomId: fab.id }
          continue
        }
      } else {
        const exp = e.rooms.find(
          (r) => r.type === 'combustion' && r.state === 'active' && r.experiment?.state === 'running' && !r.experiment.scientistId,
        )
        if (exp) {
          exp.experiment!.scientistId = c.id
          c.job = { kind: 'experiment', roomId: exp.id }
          continue
        }
        const lab = e.rooms.find((r) => r.type === 'lab' && r.state === 'active')
        if (lab) {
          c.job = { kind: 'duty-lab', roomId: lab.id }
          continue
        }
      }

      // idle wander
      if (c.state === 'idle' && !c.path.length && this.rng() < 0.01) {
        const targets = e.rooms.filter((r) => r.state === 'active')
        if (targets.length) pathTo(e, c, roomSpot(targets[(this.rng() * targets.length) | 0]))
      }
    }
  }

  // ---------- experiment resolution ----------

  private resolveExperiments() {
    const e = this.state
    for (const room of e.rooms) {
      const exp = room.experiment
      if (!exp || exp.state !== 'running' || exp.progress < 1) continue
      const inv = invById.get(exp.investigationId)
      if (!inv) {
        room.experiment = null
        continue
      }
      if (this.rng() * 100 < exp.riskPct) {
        exp.state = 'failed'
        igniteRoom(e, room, inv, rollsHidden(inv, this.rng), exp.flowCms, this.rng, this.log)
        room.experiment = null
      } else {
        exp.state = 'done'
        room.experiment = null
        e.science += exp.scienceYield
        e.scienceSinceGrant += exp.scienceYield
        const finding = inv.keyFindings[(this.rng() * inv.keyFindings.length) | 0]
        this.log('success', `${inv.name} complete: +${exp.scienceYield} science. ${finding}`, citation(inv))
        if (e.safety < 100) e.safety = Math.min(100, e.safety + 1)
      }
    }
  }

  // ---------- economy / events ----------

  private economy(dt: number) {
    const e = this.state
    e.supply.inSec -= dt
    if (e.supply.inSec <= 0) {
      e.supply.inSec = BALANCE.supplyEverySec
      e.credits += BALANCE.supplyCredits
      this.log('info', `Supply ship docked: +${BALANCE.supplyCredits} credits.`)
    }
    if (e.scienceSinceGrant >= BALANCE.grantMilestone) {
      e.scienceSinceGrant -= BALANCE.grantMilestone
      e.credits += BALANCE.grantAmount
      this.log('success', `Research milestone reached — new grant awarded: +${BALANCE.grantAmount} credits.`)
    }
  }

  private checkEnd() {
    const e = this.state
    if (e.gameOver) return
    if (e.shipProgress >= 100) {
      e.shipProgress = 100
      e.gameOver = 'won'
      this.log('success', 'SSV hull complete — ship ready for launch.')
    }
    if (e.safety <= 0) {
      e.gameOver = 'lost'
      this.log('danger', 'Safety review board terminated the program.')
    }
    if (e.crew.length && e.crew.every((c) => c.state === 'dead')) {
      e.gameOver = 'lost'
      this.log('danger', 'No crew left alive. The yard drifts silent.')
    }
    if (e.gameOver) this.emit()
  }

  // ---------- main tick ----------

  step(dtReal: number) {
    const e = this.state
    // paused/ended: state changes are emitted by their own call sites
    // (setSpeed, checkEnd) — don't re-emit every tick
    if (e.gameOver || e.speed === 0) return
    const dt = dtReal * e.speed
    e.time += dt
    this.emitAcc += dtReal

    this.schedTimer -= dt
    if (this.schedTimer <= 0) {
      this.schedTimer = 0.25
      this.assignJobs()
    }

    for (const c of e.crew) updateCrewMember(e, c, dt, this.rng, this.log)
    updateFires(e, dt, this.rng, this.log)
    this.resolveExperiments()
    this.economy(dt)

    // fabrication completion
    for (const room of e.rooms) {
      if (room.fabJob && room.fabJob.remaining <= 0) {
        room.fabJob = null
        e.shipProgress += BALANCE.fabProgressPct
        this.log('success', `Ship section fitted — hull ${Math.min(100, Math.round(e.shipProgress))}% complete.`)
      }
    }

    this.checkEnd()
    // throttle React notifications to ~10 Hz; the Pixi layer reads
    // live state every frame anyway
    if (this.emitAcc >= 0.1) {
      this.emitAcc = 0
      this.emit()
    }
  }
}

/** helpers used by the renderer/UI */
export function tileWalkable(e: GameState, x: number, y: number) {
  return isWalkable(e, x, y)
}
export function crewAt(e: GameState, x: number, y: number): CrewMember | null {
  let best: CrewMember | null = null
  let bestD = 0.9
  for (const c of e.crew) {
    if (c.state === 'dead') continue
    const d = Math.hypot(c.pos.x - x, c.pos.y - y)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}
export { findPath, musterPoint }
export type { Vec }
