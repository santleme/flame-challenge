import { BALANCE, GRID_H, GRID_W } from './config'
import { findPath } from './pathfind'
import { extinguishAt, fireDistance, fireNear, isWalkable } from './fire'
import { techMult } from './tech'
import type { CrewMember, GameState, Room, Vec } from './types'
import { rectContains, tileKey } from './types'

export function moveAlongPath(c: CrewMember, dt: number): boolean {
  // one distance budget per tick — each waypoint consumes from it; a
  // non-positive budget (dt=0, paused) must not teleport or move backwards
  let allowance = c.speed * dt * (c.state === 'injured' ? 0.45 : 1)
  if (allowance <= 0) return c.path.length === 0
  while (c.path.length) {
    const t = c.path[0]
    const dx = t.x - c.pos.x
    const dy = t.y - c.pos.y
    const d = Math.hypot(dx, dy)
    if (d <= allowance) {
      c.pos.x = t.x
      c.pos.y = t.y
      c.path.shift()
      allowance -= d
      continue
    }
    c.pos.x += (dx / d) * allowance
    c.pos.y += (dy / d) * allowance
    return false
  }
  return true
}

export function pathTo(state: GameState, c: CrewMember, target: Vec): boolean {
  const p = findPath(c.pos, target, (x, y) => isWalkable(state, x, y), GRID_W, GRID_H)
  if (p === null) return false
  c.path = p
  return true
}

/** center of a room in pos-space (tile areas are [x, x+1)) */
export function roomSpot(room: Room): Vec {
  return { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 }
}

/** free the run's scientist reservation when its experiment job is abandoned */
export function releaseExperiment(state: GameState, c: CrewMember) {
  if (c.job?.kind !== 'experiment') return
  for (const r of state.rooms)
    if (r.experiment?.scientistId === c.id) r.experiment.scientistId = null
}

/**
 * Pick the walkable tile furthest from all visible fires — a muster
 * point. Distance is the BFS path distance (fire.ts fireDistance), so a
 * sealed pocket the fire cannot reach (-1) outranks any burning-side
 * tile; the field is shared by every panicking member in a tick.
 */
export function musterPoint(state: GameState): Vec {
  const dist = fireDistance(state)
  let best: Vec = { x: 1.5, y: 1.5 }
  let bestScore = -2
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!isWalkable(state, x, y)) continue
      const d = dist[y * GRID_W + x]
      const score = d < 0 ? Number.MAX_SAFE_INTEGER : d
      if (score > bestScore) {
        bestScore = score
        best = { x: x + 0.5, y: y + 0.5 }
      }
    }
  }
  return best
}

function nearestTileAdjacentTo(state: GameState, c: CrewMember, fx: number, fy: number): Vec | null {
  // stand on the fire tile itself is allowed when extinguishing? keep adjacent
  let best: Vec | null = null
  let bestD = Infinity
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = fx + dx
    const y = fy + dy
    if (!isWalkable(state, x, y)) continue
    const d = Math.abs(x - c.pos.x) + Math.abs(y - c.pos.y)
    if (d < bestD) {
      bestD = d
      best = { x: x + 0.5, y: y + 0.5 }
    }
  }
  return best
}

export function updateCrewMember(
  state: GameState,
  c: CrewMember,
  dt: number,
  rng: () => number,
  log: (kind: 'info' | 'warn' | 'danger', text: string, ref?: string) => void,
) {
  if (c.state === 'dead') return

  // fire damage on the tile the member stands on
  const here = state.fires.get(tileKey(Math.floor(c.pos.x), Math.floor(c.pos.y)))
  if (here && here.dormant <= 0 && here.intensity > 0.15) {
    c.health -= BALANCE.burnDmgPerSec * here.intensity * here.burnMult * techMult(state, 'crewBurnMult') * dt
    if (c.health <= 0) {
      c.health = 0
      c.state = 'dead'
      releaseExperiment(state, c)
      c.job = null
      c.path = []
      state.safety = Math.max(0, state.safety - BALANCE.safetyLossDeath)
      for (const o of state.crew) if (o !== c) o.morale = Math.max(10, o.morale - 25)
      log('danger', `${c.name} (${c.role}) lost their life to the fire.`, `${here.sourceInv} · NASA PSI`)
      return
    }
  }

  // panic check — anyone (non-extinguishing engineer) near visible fire flees
  const threat = fireNear(state, Math.floor(c.pos.x), Math.floor(c.pos.y), 2)
  if (threat && c.state !== 'fleeing' && !(c.role === 'engineer' && c.job?.kind === 'extinguish')) {
    releaseExperiment(state, c)
    c.job = null
    c.state = 'fleeing'
    pathTo(state, c, musterPoint(state))
    if (!c.path.length) c.state = 'idle'
  }
  if (c.state === 'fleeing') {
    moveAlongPath(c, dt)
    if (!threat && (!c.path.length || rng() < dt * 0.5)) {
      c.state = 'idle'
      c.path = []
    }
    return
  }

  // stamina / morale drift
  if (c.state !== 'resting') c.stamina = Math.max(0, c.stamina - BALANCE.staminaDrainPerSec * dt)
  if (state.fires.size) c.morale = Math.max(0, c.morale - 0.4 * dt)

  // movement
  if (c.path.length) {
    c.state = c.state === 'injured' ? 'injured' : 'moving'
    moveAlongPath(c, dt)
    if (c.path.length) return
  }

  // arrived — resolve job
  if (!c.job) {
    if (c.state === 'moving' || c.state === 'working') c.state = 'idle'
    return
  }
  const job = c.job
  const fx = Math.floor(c.pos.x)
  const fy = Math.floor(c.pos.y)

  const clearJob = () => {
    releaseExperiment(state, c)
    c.job = null
    c.state = 'idle'
  }
  /** true when the member stands inside the room; otherwise walks there */
  const inRoom = (room: Room | undefined | null): room is Room => {
    if (!room) {
      clearJob()
      return false
    }
    if (!rectContains(room.rect, fx, fy)) {
      if (!pathTo(state, c, roomSpot(room))) clearJob()
      return false
    }
    return true
  }

  switch (job.kind) {
    case 'build': {
      const room = state.rooms.find((r) => r.id === job.roomId)
      if (room && room.state !== 'building') {
        clearJob()
        break
      }
      if (!inRoom(room)) break
      c.state = 'working'
      const tiles = room.rect.w * room.rect.h
      const moraleMult = 0.6 + (c.morale / 100) * 0.6
      room.buildProgress += (dt / (tiles * 1.1)) * moraleMult
      if (room.buildProgress >= 1) {
        room.buildProgress = 1
        room.state = 'active'
        clearJob()
        log('info', `${room.label} online.`)
      }
      break
    }
    case 'repair': {
      const room = state.rooms.find((r) => r.id === job.roomId)
      if (room && room.damage <= 0) {
        clearJob()
        break
      }
      if (!inRoom(room)) break
      c.state = 'working'
      room.damage = Math.max(0, room.damage - dt * 0.05)
      if (room.damage < 0.2 && room.state === 'damaged') room.state = 'active'
      if (room.damage === 0) clearJob()
      break
    }
    case 'experiment': {
      const room = state.rooms.find((r) => r.id === job.roomId)
      const exp = room?.experiment
      if (room && (!exp || exp.state !== 'running')) {
        clearJob()
        break
      }
      if (!inRoom(room)) break
      c.state = 'working'
      exp!.progress += dt / exp!.durationSec
      break
    }
    case 'fabricate': {
      const room = state.rooms.find((r) => r.id === job.roomId)
      if (room && (!room.fabJob || room.state !== 'active')) {
        clearJob()
        break
      }
      if (!inRoom(room)) break
      c.state = 'working'
      room.fabJob!.remaining -= dt
      break
    }
    case 'extinguish': {
      const f = job.fireKey ? state.fires.get(job.fireKey) : undefined
      if (!f || f.dormant > 0) {
        clearJob()
        break
      }
      const dist = Math.abs(f.x - fx) + Math.abs(f.y - fy)
      if (dist > 1) {
        const spot = nearestTileAdjacentTo(state, c, f.x, f.y)
        if (!spot || !pathTo(state, c, spot)) clearJob()
        break
      }
      c.state = 'extinguishing'
      extinguishAt(state, job.fireKey!, dt, rng)
      break
    }
    case 'rest': {
      const room = state.rooms.find((r) => r.id === job.roomId)
      if (!inRoom(room)) break
      c.state = 'resting'
      c.stamina = Math.min(100, c.stamina + BALANCE.staminaRestPerSec * dt)
      c.health = Math.min(100, c.health + BALANCE.healPerSec * dt)
      c.morale = Math.min(100, c.morale + 1.2 * dt)
      if (c.stamina > 88 && c.health > 60) clearJob()
      break
    }
    case 'duty-lab': {
      const room = state.rooms.find((r) => r.id === job.roomId)
      if (room && room.state !== 'active') {
        clearJob()
        break
      }
      if (!inRoom(room)) break
      c.state = 'working'
      state.science += 0.22 * dt
      state.scienceSinceGrant += 0.22 * dt
      break
    }
  }
}
