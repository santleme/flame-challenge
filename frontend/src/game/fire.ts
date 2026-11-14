import { BALANCE, GRID_H, GRID_W } from './config'
import type { GameState, Room, FireTile } from './types'
import { tileKey } from './types'
import { citation, rollsSmolder, spreadSpeed } from './experiments'
import { techMult } from './tech'
import type { Investigation } from '../types'

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

export function roomAt(state: GameState, x: number, y: number): Room | null {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null
  return state.roomByTile[(y | 0) * GRID_W + (x | 0)]
}

export function isWalkable(state: GameState, x: number, y: number): boolean {
  return roomAt(state, x, y) !== null
}

/**
 * Multi-source BFS distance (in tiles) from every visible, non-dormant
 * fire — used by crew muster and panic checks. -1 = unreachable from any
 * fire (sealed pocket or no fires). Cached per fire signature on the
 * state so a wave of panicking crew shares one computation.
 */
export function fireDistance(state: GameState): Int16Array {
  let sig = ''
  for (const [k, f] of state.fires)
    sig += `${k}:${f.hidden ? 1 : 0}${f.dormant > 0 ? 1 : 0};`
  if (state.fireDist?.sig === sig) return state.fireDist.dist

  const dist = new Int16Array(GRID_W * GRID_H).fill(-1)
  const queue: number[] = []
  for (const f of state.fires.values()) {
    if (f.hidden || f.dormant > 0) continue
    const i = f.y * GRID_W + f.x
    if (dist[i] < 0) {
      dist[i] = 0
      queue.push(i)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]
    const x = i % GRID_W
    const y = (i / GRID_W) | 0
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue
      const ni = ny * GRID_W + nx
      if (dist[ni] >= 0 || !isWalkable(state, nx, ny)) continue
      dist[ni] = dist[i] + 1
      queue.push(ni)
    }
  }
  state.fireDist = { sig, dist }
  return dist
}

/** Seed a fire from a failed experiment. Anchored to the source record. */
export function igniteRoom(
  state: GameState,
  room: Room,
  inv: Investigation,
  hidden: boolean,
  flowCms: number,
  rng: () => number,
  log: (kind: 'danger' | 'warn', text: string, ref?: string) => void,
) {
  const tiles: [number, number][] = []
  for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++)
    for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) tiles.push([x, y])
  const speed = spreadSpeed(inv, flowCms)
  const seeds = 1 + Math.min(2, Math.floor(speed * 3))
  for (let i = 0; i < seeds && tiles.length; i++) {
    const [x, y] = tiles.splice((rng() * tiles.length) | 0, 1)[0]
    addFire(state, x, y, inv, hidden, speed)
  }
  if (hidden) {
    log(
      'warn',
      `Undetected combustion in ${room.label} — cool flames produce no visible signature.`,
      citation(inv),
    )
  } else {
    const imp = inv.safetyImplications[0]
    log(
      'danger',
      `IGNITION in ${room.label} (${inv.name} @ ${room.experiment?.oxygenPct ?? '?'}% O₂).` +
        (imp ? ` ${imp}` : ''),
      citation(inv),
    )
    state.safety = Math.max(0, state.safety - BALANCE.safetyLossIncident)
  }
}

function addFire(
  state: GameState,
  x: number,
  y: number,
  inv: Investigation,
  hidden: boolean,
  spreadRate: number,
) {
  const k = tileKey(x, y)
  if (state.fires.has(k)) return
  const room = roomAt(state, x, y)
  const fuel = room && room.type !== 'deck' ? BALANCE.fireFuelModule : BALANCE.fireFuelDeck
  state.fires.set(k, {
    x,
    y,
    intensity: 0.12,
    fuel,
    hidden,
    spreadRate,
    smolder: rollsSmolder(inv),
    selfOxidizing: false,
    burnMult: 1,
    dormant: 0,
    sourceInv: inv.name,
  })
}

/** damage a room; crossing 0.5 takes it offline */
function applyDamage(room: Room, amount: number, log: (k: 'warn', t: string) => void) {
  room.damage = Math.min(1, room.damage + amount)
  if (room.state === 'active' && room.damage >= 0.5) {
    room.state = 'damaged'
    if (room.experiment) room.experiment = null
    log('warn', `${room.label} knocked offline by fire damage.`)
  }
}

export function updateFires(
  state: GameState,
  dt: number,
  rng: () => number,
  log: (kind: 'warn' | 'danger' | 'info', text: string, ref?: string) => void,
) {
  const newIgnitions: [number, number, FireTile][] = []
  for (const [k, f] of state.fires) {
    if (f.dormant > 0) {
      // smoldering pocket — FLEX/BASS-style re-ignition risk
      f.dormant -= dt
      if (f.dormant <= 0) {
        f.intensity = 0.2
        f.hidden = true
        log('warn', `Re-ignition: smoldering material flashed back in a tile (${f.sourceInv}).`)
      }
      continue
    }
    f.intensity = Math.min(1, f.intensity + dt / BALANCE.fireGrowthSec)
    f.fuel -= (dt / 30) * f.intensity
    const room = roomAt(state, f.x, f.y)
    if (room) applyDamage(room, dt * 0.03 * f.intensity, log)

    // reveal hidden fires once they grow (fire-detector tech lowers the bar)
    if (f.hidden && f.intensity > 0.6 * techMult(state, 'hiddenRevealMult')) {
      f.hidden = false
      log('danger', `Hidden cool flame breached detection threshold!`, `${f.sourceInv} · NASA PSI`)
      state.safety = Math.max(0, state.safety - 4)
    }

    // spread: pressure ∝ intensity × real spread rate
    if (f.intensity > 0.4 && rng() < dt * f.spreadRate * f.intensity * 0.9) {
      const [dx, dy] = DIRS[(rng() * 4) | 0]
      const nx = f.x + dx
      const ny = f.y + dy
      if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && isWalkable(state, nx, ny) && !state.fires.has(tileKey(nx, ny))) {
        newIgnitions.push([nx, ny, f])
      }
    }
    if (f.fuel <= 0) state.fires.delete(k)
  }
  for (const [x, y, src] of newIgnitions) {
    const room = roomAt(state, x, y)
    const fuel = room && room.type !== 'deck' ? BALANCE.fireFuelModule : BALANCE.fireFuelDeck
    state.fires.set(tileKey(x, y), { ...src, x, y, fuel, intensity: 0.1, dormant: 0 })
  }
}

/** engineer extinguishing adjacent/at the tile */
export function extinguishAt(state: GameState, k: string, dt: number, rng: () => number) {
  const f = state.fires.get(k)
  if (!f) return
  f.intensity -= BALANCE.extinguishPerSec * techMult(state, 'extinguishRateMult') * dt
  if (f.intensity <= 0) {
    if (f.selfOxidizing || (f.smolder && rng() < BALANCE.smolderReigniteChance)) {
      // leaves a dormant pocket that may flash back later
      f.intensity = 0
      f.hidden = true
      f.dormant = 8 + rng() * 14
    } else {
      state.fires.delete(k)
    }
  }
}

export function fireNear(state: GameState, x: number, y: number, radius: number): FireTile | null {
  for (const f of state.fires.values()) {
    if (f.dormant > 0 || f.hidden) continue
    if (Math.abs(f.x - x) + Math.abs(f.y - y) <= radius) return f
  }
  return null
}
