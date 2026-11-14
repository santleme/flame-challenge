import { Container, Graphics, Sprite } from 'pixi.js'
import type { Application } from 'pixi.js'
import { BALANCE, GRID_H, GRID_W, ROOM_SPECS, TILE_H, mulberry32 } from '../game/config'
import type { Engine } from '../game/engine'
import { isoToScreen } from '../game/iso'
import { roomAt } from '../game/fire'
import type { Rect, Room, Vec } from '../game/types'
import { makeTextures } from './textures'

export interface WorldUI {
  ghost: { rect: Rect; ok: boolean } | null
  hover: Vec | null
  selection: { kind: 'room' | 'crew'; id: number } | null
}

interface Smoke {
  s: Sprite
  life: number
  vy: number
}

export interface World {
  root: Container
  tick: (dtReal: number) => void
}

const roomTint = (r: Room) =>
  r.state === 'damaged' ? 0x5a2f2f : r.state === 'building' ? 0x8a7a4a : ROOM_SPECS[r.type].color

export function createWorld(app: Application, engine: Engine, ui: WorldUI): World {
  const tex = makeTextures(app)
  const root = new Container()

  const voidLayer = new Graphics()
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const p = isoToScreen(x, y)
      voidLayer.poly([p.x, p.y - TILE_H / 2, p.x + 32, p.y, p.x, p.y + TILE_H / 2, p.x - 32, p.y])
    }
  voidLayer.stroke({ width: 1, color: 0x16203a, alpha: 0.5 })
  root.addChild(voidLayer)

  const ground = new Container()
  const outlines = new Graphics()
  const props = new Container()
  const actors = new Container()
  actors.sortableChildren = true
  const fx = new Graphics()
  const smokeLayer = new Container()
  root.addChild(ground, outlines, props, actors, smokeLayer, fx)

  // ---------- static layers (rebuilt on room signature change) ----------

  let roomSig = ''
  const floorSprites = new Map<string, Sprite>()

  function roomSignature(): string {
    return engine.state.rooms
      .map((r) => `${r.id}:${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.h}:${r.state}:${r.damage > 0.5 ? 1 : 0}`)
      .join('|')
  }

  function rebuildStatic() {
    ground.removeChildren().forEach((c) => c.destroy())
    props.removeChildren().forEach((c) => c.destroy())
    floorSprites.clear()
    outlines.clear()

    for (const room of engine.state.rooms) {
      const tint = roomTint(room)
      for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
        for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
          const s = new Sprite(tex.floor)
          const p = isoToScreen(x, y)
          s.position.set(p.x, p.y)
          s.anchor.set(0.5)
          s.tint = tint
          ground.addChild(s)
          floorSprites.set(`${x},${y}`, s)
        }
      }
      // perimeter outline — true bounding diamond of the tile block:
      // top/right/bottom/left vertices of the corner tiles
      const top = isoToScreen(room.rect.x, room.rect.y)
      const right = isoToScreen(room.rect.x + room.rect.w - 1, room.rect.y)
      const bottom = isoToScreen(room.rect.x + room.rect.w - 1, room.rect.y + room.rect.h - 1)
      const left = isoToScreen(room.rect.x, room.rect.y + room.rect.h - 1)
      const edge = room.state === 'damaged' ? 0xff5555 : room.state === 'building' ? 0xd8a23a : 0x4a5f8a
      outlines
        .poly([
          top.x, top.y - TILE_H / 2,
          right.x + 32, right.y,
          bottom.x, bottom.y + TILE_H / 2,
          left.x - 32, left.y,
        ])
        .stroke({ width: 2, color: edge, alpha: 0.8 })

      // module prop at room center (skip big dock floor prop duplication)
      const ptex = tex.props[room.type]
      if (ptex && room.type !== 'deck') {
        const p = isoToScreen(room.rect.x + room.rect.w / 2 - 0.5, room.rect.y + room.rect.h / 2 - 0.5)
        const s = new Sprite(ptex)
        s.anchor.set(0.5, 0.55)
        s.position.set(p.x, p.y)
        props.addChild(s)
      }
    }
  }

  // ---------- dynamic pools ----------

  const crewSprites = new Map<number, Sprite>()
  const fireSprites = new Map<string, Sprite>()
  const smoke: Smoke[] = []
  let smokeAcc = 0
  // fx-only rng — seeded from the game seed so replays stay deterministic
  const fxRng = mulberry32(engine.state.seed ^ 0x5eed)

  function crewSprite(id: number): Sprite {
    let s = crewSprites.get(id)
    if (!s) {
      s = new Sprite(tex.crew.engineer)
      s.anchor.set(0.5, 1)
      actors.addChild(s)
      crewSprites.set(id, s)
    }
    return s
  }

  // ---------- per-frame sync ----------

  let t = 0

  function tick(dtReal: number) {
    t += dtReal
    const st = engine.state

    const sig = roomSignature()
    if (sig !== roomSig) {
      roomSig = sig
      rebuildStatic()
    }

    // crew
    const seen = new Set<number>()
    for (const c of st.crew) {
      seen.add(c.id)
      const s = crewSprite(c.id)
      const p = isoToScreen(c.pos.x - 0.5, c.pos.y - 0.5)
      s.position.set(p.x, p.y + TILE_H / 4)
      s.zIndex = c.pos.x + c.pos.y + 0.4
      if (c.state === 'dead') {
        s.texture = tex.dead
        s.alpha = 0.7
        continue
      }
      s.alpha = 1
      s.texture = tex.crew[c.role]
      const bob = c.path.length ? Math.sin(t * 12 + c.id) * 1.5 : 0
      s.position.y += bob
      s.tint = c.state === 'injured' ? 0xff8888 : c.state === 'resting' ? 0xaad4ff : 0xffffff
    }
    for (const [id, s] of crewSprites) {
      if (!seen.has(id)) {
        s.destroy()
        crewSprites.delete(id)
      }
    }

    // fires
    const seenF = new Set<string>()
    smokeAcc += dtReal
    for (const [k, f] of st.fires) {
      if (f.dormant > 0) continue
      seenF.add(k)
      let s = fireSprites.get(k)
      if (!s) {
        s = new Sprite(f.hidden ? tex.coolFlame : tex.flame)
        s.anchor.set(0.5, 1)
        actors.addChild(s)
        fireSprites.set(k, s)
      }
      const p = isoToScreen(f.x, f.y)
      s.position.set(p.x, p.y + TILE_H / 4)
      s.zIndex = f.x + f.y + 0.6
      const flicker = 0.8 + Math.sin(t * 14 + f.x * 7 + f.y * 3) * 0.2
      if (f.hidden) {
        // cool flame: near-invisible blue shimmer (FLEX-style)
        s.texture = tex.coolFlame
        s.alpha = 0.14 + f.intensity * 0.2
        s.scale.set(0.6 + f.intensity * 0.4, 0.6 + f.intensity * 0.5)
      } else {
        s.texture = tex.flame
        s.alpha = Math.min(1, 0.35 + f.intensity * 0.75)
        s.scale.set(flicker * (0.5 + f.intensity * 0.9), (0.55 + f.intensity) * flicker)
      }
      // char the floor while burning
      const fl = floorSprites.get(k)
      if (fl) fl.tint = f.hidden ? 0x2c3650 : 0x1a1410
      // smoke puffs
      if (!f.hidden && smokeAcc > 0.22 && f.intensity > 0.35) {
        const sp = new Sprite(tex.smoke)
        sp.anchor.set(0.5)
        sp.position.set(p.x + (fxRng() - 0.5) * 10, p.y - 18)
        smokeLayer.addChild(sp)
        smoke.push({ s: sp, life: 1, vy: 18 + fxRng() * 14 })
      }
    }
    if (smokeAcc > 0.22) smokeAcc = 0
    for (const [k, s] of fireSprites) {
      if (!seenF.has(k)) {
        s.destroy()
        fireSprites.delete(k)
        const fl = floorSprites.get(k)
        if (fl) {
          const [fx2, fy2] = k.split(',').map(Number)
          const room = roomAt(st, fx2, fy2)
          if (room) fl.tint = roomTint(room)
        }
      }
    }

    // smoke particles
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i]
      p.life -= dtReal * 0.9
      p.s.position.y -= p.vy * dtReal
      p.s.alpha = Math.max(0, p.life * 0.5)
      p.s.scale.set(1 + (1 - p.life) * 1.6)
      if (p.life <= 0) {
        p.s.destroy()
        smoke.splice(i, 1)
      }
    }

    // ---------- fx layer: hover, ghost, selection, progress bars ----------
    fx.clear()
    if (ui.hover && !ui.ghost) {
      const p = isoToScreen(ui.hover.x, ui.hover.y)
      fx.poly([p.x, p.y - TILE_H / 2, p.x + 32, p.y, p.x, p.y + TILE_H / 2, p.x - 32, p.y]).stroke({ width: 1.5, color: 0x67e8f9, alpha: 0.8 })
    }
    if (ui.ghost) {
      const { rect, ok } = ui.ghost
      const col = ok ? 0x67e8f9 : 0xff5555
      for (let y = rect.y; y < rect.y + rect.h; y++)
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue
          const p = isoToScreen(x, y)
          fx.poly([p.x, p.y - TILE_H / 2, p.x + 32, p.y, p.x, p.y + TILE_H / 2, p.x - 32, p.y]).fill({ color: col, alpha: 0.28 })
        }
    }
    // selection
    if (ui.selection) {
      if (ui.selection.kind === 'room') {
        const room = st.rooms.find((r) => r.id === ui.selection!.id)
        if (room) {
          const top = isoToScreen(room.rect.x, room.rect.y)
          const right = isoToScreen(room.rect.x + room.rect.w - 1, room.rect.y)
          const bottom = isoToScreen(room.rect.x + room.rect.w - 1, room.rect.y + room.rect.h - 1)
          const left = isoToScreen(room.rect.x, room.rect.y + room.rect.h - 1)
          fx.poly([top.x, top.y - TILE_H / 2, right.x + 32, right.y, bottom.x, bottom.y + TILE_H / 2, left.x - 32, left.y]).stroke({ width: 2.5, color: 0x67e8f9, alpha: 0.9 })
        }
      } else {
        const c = st.crew.find((cc) => cc.id === ui.selection!.id)
        if (c) {
          const p = isoToScreen(c.pos.x - 0.5, c.pos.y - 0.5)
          fx.ellipse(p.x, p.y + TILE_H / 4, 12, 6).stroke({ width: 2, color: 0x67e8f9, alpha: 0.9 })
        }
      }
    }
    // contagion warning: rooms adjacent to a burning room pulse amber
    if (st.fires.size) {
      const burning = new Set<Room>()
      for (const f of st.fires.values()) {
        if (f.dormant > 0) continue
        const r = roomAt(st, f.x, f.y)
        if (r) burning.add(r)
      }
      if (burning.size) {
        const pulse = 0.4 + 0.35 * Math.sin(t * 5)
        for (const room of st.rooms) {
          if (burning.has(room)) continue
          let near = false
          for (const b of burning) {
            if (
              room.rect.x < b.rect.x + b.rect.w + 1 &&
              room.rect.x + room.rect.w > b.rect.x - 1 &&
              room.rect.y < b.rect.y + b.rect.h + 1 &&
              room.rect.y + room.rect.h > b.rect.y - 1
            ) {
              near = true
              break
            }
          }
          if (!near) continue
          const top = isoToScreen(room.rect.x, room.rect.y)
          const right = isoToScreen(room.rect.x + room.rect.w - 1, room.rect.y)
          const bottom = isoToScreen(room.rect.x + room.rect.w - 1, room.rect.y + room.rect.h - 1)
          const left = isoToScreen(room.rect.x, room.rect.y + room.rect.h - 1)
          fx.poly([
            top.x, top.y - TILE_H / 2,
            right.x + 32, right.y,
            bottom.x, bottom.y + TILE_H / 2,
            left.x - 32, left.y,
          ]).stroke({
            width: 2,
            color: 0xffb347,
            alpha: pulse,
          })
        }
      }
    }
    // progress bars: construction, experiments, fabrication
    for (const room of st.rooms) {
      const ctr = isoToScreen(room.rect.x + room.rect.w / 2 - 0.5, room.rect.y + room.rect.h / 2 - 0.5)
      let prog = -1
      let col = 0x67e8f9
      if (room.state === 'building') {
        prog = room.buildProgress
        col = 0xd8a23a
      } else if (room.experiment?.state === 'running') {
        prog = room.experiment.progress
        col = 0x67e8f9
      } else if (room.fabJob) {
        prog = 1 - room.fabJob.remaining / BALANCE.fabDurationSec
        col = 0xb99fe0
      }
      if (prog >= 0) {
        const w = 34
        const y = ctr.y - 46
        fx.roundRect(ctr.x - w / 2, y, w, 5, 2).fill({ color: 0x101726, alpha: 0.85 })
        fx.roundRect(ctr.x - w / 2 + 1, y + 1, (w - 2) * Math.min(1, Math.max(0, prog)), 3, 1.5).fill({ color: col })
      }
    }
  }

  return { root, tick }
}
