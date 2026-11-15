import { useEffect, useRef } from 'react'

export interface FlameParameters {
  gravityG: number
  o2Pct: number
  airflowCms: number
  coolFlame: boolean
}

export function parseFlameParameters(
  text: string,
  defaults?: FlameParameters,
): FlameParameters {
  const lower = (text ?? '').toLowerCase()
  let gravityG = defaults?.gravityG ?? 0
  let o2Pct = defaults?.o2Pct ?? 21
  let airflowCms = defaults?.airflowCms ?? 0.5

  const oxygen = lower.match(/(?:o2|oxygen|oxig[eê]nio)?\s*(\d{1,2}(?:\.\d+)?)\s*%/i)
  if (oxygen) o2Pct = Math.min(85, Math.max(8, Number(oxygen[1])))

  const explicitG = lower.match(/(\d+(?:\.\d+)?)\s*g\b/i)
  if (/\b(0g|zero[- ]?g|microgravity|micro[- ]?gravity|iss|weightless)\b/i.test(lower)) gravityG = 0
  else if (/\blunar|moon|lua\b/i.test(lower)) gravityG = 0.16
  else if (/\bmars|martian|marte\b/i.test(lower)) gravityG = 0.38
  else if (explicitG) gravityG = Math.min(1.5, Number(explicitG[1]))
  else if (/\bearth|terrestrial|terra\b/i.test(lower)) gravityG = 1

  const unitFlow = lower.match(/(\d+(?:\.\d+)?)\s*(?:cm\/?s\b|cm\/sec\b)/i)
  const keywordFlow = lower.match(/(?:airflow|flow|ventila(?:tion|ção|cao)?|fluxo|\bwind)\D{0,8}(\d+(?:\.\d+)?)/i)
  if (unitFlow) airflowCms = Math.min(80, Math.max(0, Number(unitFlow[1])))
  else if (keywordFlow) airflowCms = Math.min(80, Math.max(0, Number(keywordFlow[1])))
  else if (/\b(?:airflow|ventila(?:tion|ção|cao)?|fluxo|wind)\b/i.test(lower)) airflowCms = Math.max(8, airflowCms)

  return {
    gravityG: Math.min(1.5, Math.max(0, gravityG)),
    o2Pct,
    airflowCms,
    coolFlame: /cool[- ]?flame|chama fria/i.test(lower),
  }
}

interface EdgePulse {
  /** Angular position on the perimeter where the keystroke ignited. */
  angle: number
  at: number
  power: number
}

interface Ember {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  seed: number
}

interface MathematicalFlameFieldProps {
  parameters: FlameParameters
  pulse: { id: number; position: number }
  /** The pill the flame conforms to — measured every frame for the SDF. */
  barRef: React.RefObject<HTMLElement | null>
  /** Element that receives the dynamic thermal box-shadow. */
  glowRef: React.RefObject<HTMLElement | null>
}

const CELL = 4 // CSS px per simulation cell
const MAX_W = 240
const MAX_H = 96
const MAX_EMBERS = 40

const TAU = Math.PI * 2

function hash2(x: number, y: number) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return h - Math.floor(h)
}

function vnoise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/** 2-octave FBM in [0,1]. */
function fbm(x: number, y: number) {
  return (
    vnoise(x, y) * 0.62 +
    vnoise(x * 2.13 + 17.7, y * 2.13 - 9.2) * 0.38
  )
}

/**
 * Flame sheath conformal to the typing bar: per-pixel we evaluate
 * d = sdRoundedBox(p + warp(p, t), barSize, radius) — the warp is animated
 * curl-FBM — and map the signed distance to a thermal ramp. The canvas is
 * a 36px margin around the pill and sits *behind* it, so the inner band
 * (d < 0) reads as an inset glow through the translucent white surface.
 */
export default function MathematicalFlameField({
  parameters,
  pulse,
  barRef,
  glowRef,
}: MathematicalFlameFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const emberCanvasRef = useRef<HTMLCanvasElement>(null)
  const paramsRef = useRef(parameters)
  const pulseRef = useRef(pulse)
  const lastPulseRef = useRef(pulse)
  const pointerRef = useRef({ x: -9999, y: -9999, vx: 0, vy: 0, proximity: 0 })

  paramsRef.current = parameters
  pulseRef.current = pulse

  useEffect(() => {
    const canvas = canvasRef.current
    const emberCanvas = emberCanvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: true })
    const emberCtx = emberCanvas?.getContext('2d', { alpha: true })
    if (!canvas || !ctx || !emberCanvas || !emberCtx) return

    let Wg = 0
    let Hg = 0
    let image: ImageData | null = null
    let imageData: Uint8ClampedArray | null = null
    let raf = 0
    let last = 0
    let simTime = 0
    let visible = true
    let glowLevel = 0
    const active = {
      gravityG: parameters.gravityG,
      o2Pct: parameters.o2Pct,
      airflowCms: parameters.airflowCms,
      coolFlame: parameters.coolFlame ? 1 : 0,
    }
    const pulses: EdgePulse[] = []
    const embers: Ember[] = []
    const reducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : { matches: false }

    const rawPointer = { x: 0, y: 0, t: 0, has: false }
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const now = performance.now()
      const dt = Math.max(16, now - rawPointer.t) / 1000
      const ivx = rawPointer.has ? (event.clientX - rawPointer.x) / dt : 0
      const ivy = rawPointer.has ? (event.clientY - rawPointer.y) / dt : 0
      rawPointer.x = event.clientX
      rawPointer.y = event.clientY
      rawPointer.t = now
      rawPointer.has = true
      const p = pointerRef.current
      const mx = event.clientX - rect.left
      const my = event.clientY - rect.top
      const outsideX = Math.max(-mx, 0, mx - rect.width)
      const outsideY = Math.max(-my, 0, my - rect.height)
      const distance = Math.hypot(outsideX, outsideY)
      const ease = 0.3
      p.x += (mx - p.x) * ease
      p.y += (my - p.y) * ease
      p.vx += (ivx - p.vx) * ease
      p.vy += (ivy - p.vy) * ease
      p.proximity = Math.max(0, 1 - distance / 140)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', onPointer, { passive: true })
    }

    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => {
        const wasVisible = visible
        visible = entry.isIntersecting
        if (!wasVisible && visible && !reducedMotion.matches) {
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(draw)
        }
      })
      observer.observe(canvas)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const w = Math.min(MAX_W, Math.max(8, Math.round(rect.width / CELL)))
      const h = Math.min(MAX_H, Math.max(8, Math.round(rect.height / CELL)))
      if (w !== Wg || h !== Hg) {
        Wg = w
        Hg = h
        canvas.width = Wg
        canvas.height = Hg
        image = ctx.createImageData(Wg, Hg)
        imageData = image.data
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      emberCanvas.width = Math.max(1, Math.round(rect.width * dpr))
      emberCanvas.height = Math.max(1, Math.round(rect.height * dpr))
      emberCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)
    }

    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }

    // Bar rect in canvas CSS px (recomputed per frame — cheap).
    const bar = { l: 0, t: 0, w: 0, h: 0, cx: 0, cy: 0, cr: 26 }
    const measureBar = () => {
      const el = barRef.current
      const rect = canvas.getBoundingClientRect()
      if (!el || !rect.width || !rect.height) return false
      const b = el.getBoundingClientRect()
      bar.l = b.left - rect.left
      bar.t = b.top - rect.top
      bar.w = b.width
      bar.h = b.height
      bar.cx = bar.l + bar.w / 2
      bar.cy = bar.t + bar.h / 2
      bar.cr = Math.min(26, bar.h / 2)
      return true
    }

    const sdBar = (px: number, py: number) => {
      const qx = Math.abs(px - bar.cx) - (bar.w / 2 - bar.cr)
      const qy = Math.abs(py - bar.cy) - (bar.h / 2 - bar.cr)
      const ax = Math.max(qx, 0)
      const ay = Math.max(qy, 0)
      return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - bar.cr
    }

    const spawnEmber = (x: number, y: number, kickX: number, kickY: number) => {
      if (embers.length >= MAX_EMBERS) return
      const a = Math.random() * TAU
      embers.push({
        x,
        y,
        vx: kickX * 0.12 + Math.cos(a) * 30,
        vy: kickY * 0.12 + Math.sin(a) * 30 - 45,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.9,
        size: 1.2 + Math.random() * 1.6,
        seed: Math.random() * 1000,
      })
    }

    const setGlow = (intensity: number, micro: number, cool: number) => {
      const glow = glowRef.current
      if (!glow) return
      const i = Math.max(0, Math.min(1, intensity))
      if (i < 0.02) {
        glow.style.boxShadow = 'none'
        return
      }
      if (micro > 0.5) {
        glow.style.boxShadow = `0 0 ${14 + 30 * i}px rgba(56,189,248,${0.25 + 0.35 * i}), inset 0 0 ${10 + 16 * i}px rgba(2,132,199,${0.15 + 0.25 * i})`
      } else if (cool > 0.5) {
        glow.style.boxShadow = `0 0 ${16 + 32 * i}px rgba(129,140,248,${0.25 + 0.32 * i}), inset 0 0 ${10 + 16 * i}px rgba(79,70,229,${0.14 + 0.22 * i})`
      } else {
        glow.style.boxShadow = `0 0 ${14 + 30 * i}px rgba(249,115,22,${0.28 + 0.38 * i}), 0 -3px ${18 + 26 * i}px rgba(220,38,38,${0.18 + 0.26 * i}), inset 0 0 ${8 + 14 * i}px rgba(245,158,11,${0.18 + 0.3 * i})`
      }
    }

    const draw = (now: number) => {
      if (!visible || !image || !imageData) return
      if (now - last < 30 && !reducedMotion.matches) {
        raf = requestAnimationFrame(draw)
        return
      }
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 30)
      last = now
      simTime += reducedMotion.matches ? 0 : dt
      const hasBar = measureBar()

      const target = paramsRef.current
      const easing = 1 - Math.exp(-dt * 5)
      active.gravityG += (target.gravityG - active.gravityG) * easing
      active.o2Pct += (target.o2Pct - active.o2Pct) * easing
      active.airflowCms += (target.airflowCms - active.airflowCms) * easing
      active.coolFlame += ((target.coolFlame ? 1 : 0) - active.coolFlame) * easing
      const micro = 1 - smooth(0.02, 0.3, active.gravityG)
      const cool = active.coolFlame
      const o2Gain = 0.7 + Math.min(0.6, active.o2Pct / 70)

      const pointer = pointerRef.current
      const decay = Math.exp(-dt * 4)
      pointer.vx *= decay
      pointer.vy *= decay
      const pointerSpeed = Math.hypot(pointer.vx, pointer.vy)
      const pointerNear =
        pointer.proximity > 0 &&
        pointer.x > -999 &&
        pointer.x > bar.l - 40 &&
        pointer.x < bar.l + bar.w + 40 &&
        pointer.y > bar.t - 40 &&
        pointer.y < bar.t + bar.h + 40

      // Keystroke → a wave that travels around the perimeter from the caret.
      const pulseNow = pulseRef.current
      if (pulseNow.id !== lastPulseRef.current.id && hasBar) {
        lastPulseRef.current = pulseNow
        const px = bar.l + (0.12 + pulseNow.position * 0.76) * bar.w
        pulses.push({
          angle: Math.atan2(bar.t - bar.cy, px - bar.cx),
          at: simTime,
          power: 0.8 + Math.min(0.4, active.o2Pct / 120),
        })
        for (let k = 0; k < 5; k++) {
          spawnEmber(px + (Math.random() - 0.5) * 8, bar.t, 0, -60)
        }
      }
      while (pulses.length > 8) pulses.shift()

      // Cursor scraping the sheath sheds a short spark trail.
      if (pointerNear && pointerSpeed > 250) {
        const dAtPointer = hasBar ? sdBar(pointer.x, pointer.y) : 99
        if (dAtPointer < 30 && Math.random() < 0.75) {
          spawnEmber(pointer.x, pointer.y, pointer.vx, pointer.vy)
        }
      }

      const warpScale = 0.055
      const tongueBase = 20 * (1 - micro * 0.55) + cool * 6 // tongue reach, px
      let edgeHeat = 0
      let edgeN = 0

      for (let y = 0; y < Hg; y++) {
        const py = (y + 0.5) * CELL
        for (let x = 0; x < Wg; x++) {
          const px = (x + 0.5) * CELL
          const o = (y * Wg + x) * 4

          // --- domain warp: curl-ish FBM, animated, + mouse attraction ---
          let wx =
            (fbm(px * warpScale + simTime * 0.7, py * warpScale - simTime * 0.31) - 0.5) * 2
          let wy =
            (fbm(px * warpScale - simTime * 0.42 + 40.2, py * warpScale + simTime * 0.66) - 0.5) * 2
          const md = Math.hypot(px - pointer.x, py - pointer.y)
          const mouseG = pointerNear ? Math.exp(-(md * md) / (2 * 68 * 68)) : 0
          const warpAmp = (5 + 9 * mouseG) * (1 - micro * 0.4)
          wx *= warpAmp
          wy *= warpAmp
          // Cursor attraction: displace the domain toward the pointer so the
          // flame stretches toward it.
          if (mouseG > 0.003) {
            const inv = 1 / Math.max(8, md)
            wx += (pointer.x - px) * inv * mouseG * 7
            wy += (pointer.y - py) * inv * mouseG * 7
          }
          let d = sdBar(px + wx, py + wy)

          // Perimeter coordinate (angle) + outward normal estimate.
          const nx = px - bar.cx
          const ny = (py - bar.cy) * 1.9
          const ang = Math.atan2(ny, nx)
          const topness = 0.5 + 0.5 * -Math.sin(ang) // 1 at top, 0 at bottom
          // Organic tongues licking along the rim; stronger on top in 1g.
          const tongueN = fbm(ang * 2.4 + simTime * 1.15, d * 0.05 - simTime * 0.8)
          const tongueBias = micro > 0.5 ? 0.55 : 0.35 + 0.65 * topness
          const thickness =
            (6 + tongueBase * tongueN * tongueBias) * o2Gain + mouseG * 14 * (1 - micro * 0.5)
          d -= Math.max(0, tongueN - 0.45) * thickness

          // Keystroke waves propagating around the rim from the caret angle.
          let wave = 0
          for (const p of pulses) {
            const age = simTime - p.at
            if (age > 1.6) continue
            let ds = Math.abs(ang - p.angle)
            if (ds > Math.PI) ds = TAU - ds
            const front = age * 3.4
            const w1 = Math.exp(-((ds - front) * (ds - front)) / 0.09)
            const w0 = Math.exp(-(ds * ds) / 0.05) * Math.exp(-age * 4)
            wave += p.power * Math.exp(-age * 1.4) * (w1 * 0.8 + w0)
          }

          const sheath = Math.exp(-(d * d) / (2 * 13 * 13)) // main body |d|<~26
          const contact = Math.exp(-(d * d) / (2 * 4.5 * 4.5)) // white-hot rim
          const inset = d < 0 ? Math.exp(-((d + 7) * (d + 7)) / (2 * 5 * 5)) : 0
          const flicker = 0.8 + 0.2 * Math.sin(simTime * (cool > 0.5 ? 5.2 : 8.4) + ang * 5)
          let heat = (sheath * 0.85 + contact * 0.6 + wave * 0.9) * flicker * o2Gain
          heat = Math.min(1.4, heat)

          if (d > -2 && d < 14) {
            edgeHeat += heat
            edgeN++
          }

          const u = Math.max(0, Math.min(1, d / 26)) // 0 rim → 1 outer tip
          let r = 0
          let g = 0
          let b = 0
          let alpha = 0
          if (cool > 0.5) {
            const pulseA = 0.55 + 0.45 * Math.sin(simTime * 4.6)
            r = 79 + (129 - 79) * u + wave * 60
            g = 70 + (140 - 70) * u + wave * 40
            b = 229 + (248 - 229) * u
            alpha = Math.min(190, (heat * 150 + inset * 60) * pulseA)
          } else if (micro > 0.5) {
            // #0284C7 → #38BDF8 → #E0F2FE (contact inverted: hottest at rim)
            r = 224 - 222 * u
            g = 242 - 53 * u - contact * 40
            b = 254 - 55 * u
            alpha = Math.min(220, heat * 185 + inset * 70)
          } else {
            // contact → amber/white, body → orange, tip → crimson fading out
            const cb = Math.min(1, contact + wave * 0.5)
            r = 153 + (254 - 153) * Math.pow(1 - u, 2.2)
            g = 27 + (240 - 27) * Math.pow(1 - u, 2.6)
            b = 27 + (138 - 27) * Math.pow(1 - u, 3.4)
            if (u < 0.55) {
              const f = u / 0.55
              r = 249 - 15 * f + (254 - 249) * cb
              g = 115 - 60 * f + (240 - 115) * cb
              b = 22 + 16 * f + (138 - 22) * cb
            }
            alpha = Math.min(245, heat * 200 + contact * 90 + inset * 90)
          }
          // Inset glow bleeding through the translucent pill.
          alpha = Math.max(alpha, inset * (cool > 0.5 ? 70 : micro > 0.5 ? 80 : 110))
          imageData[o] = r
          imageData[o + 1] = g
          imageData[o + 2] = b
          imageData[o + 3] = alpha
        }
      }
      ctx.putImageData(image, 0, 0)

      const heatAvg = edgeN > 0 ? edgeHeat / edgeN : 0
      const targetGlow = Math.min(1, heatAvg * 1.35 + (pointerNear ? 0.12 : 0))
      glowLevel += (targetGlow - glowLevel) * (1 - Math.exp(-dt * 5))
      setGlow(glowLevel * (0.85 + 0.15 * Math.sin(simTime * 6.1)), micro, cool)

      // ---- short-lived sparks, crisp overlay ----
      const cw = canvas.clientWidth || 1
      const ch = canvas.clientHeight || 1
      emberCtx.clearRect(0, 0, cw, ch)
      for (let k = embers.length - 1; k >= 0; k--) {
        const e = embers[k]
        e.life += dt
        if (e.life >= e.maxLife) {
          embers.splice(k, 1)
          continue
        }
        const swirl = Math.sin(e.seed + e.life * 9) * 30
        e.vx += swirl * dt - e.vx * 2.2 * dt
        e.vy += (-50 * (1 - micro) - e.vy * 1.8) * dt
        e.x += e.vx * dt
        e.y += e.vy * dt
        const lifeT = e.life / e.maxLife
        const size = e.size * (1 - lifeT * 0.85)
        const alpha = 1 - lifeT
        if (size <= 0.15) continue
        emberCtx.fillStyle =
          micro > 0.5
            ? `rgba(125,211,252,${(alpha * 0.9).toFixed(3)})`
            : cool > 0.5
              ? `rgba(165,180,252,${(alpha * 0.75).toFixed(3)})`
              : `rgba(255,${Math.round(170 + 70 * (1 - lifeT))},60,${(alpha * 0.95).toFixed(3)})`
        emberCtx.beginPath()
        emberCtx.arc(e.x, e.y, size, 0, TAU)
        emberCtx.fill()
      }

      if (!reducedMotion.matches) raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      resizeObserver?.disconnect()
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onPointer)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-9 mix-blend-normal"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full blur-[1.5px]"
        style={{ imageRendering: 'auto' }}
      />
      <canvas ref={emberCanvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
