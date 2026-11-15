import { useEffect, useRef } from 'react'

export interface FlameParameters {
  gravityG: number
  o2Pct: number
  airflowCms: number
  coolFlame: boolean
  /** Extra spectral regimes parsed from free text. */
  enriched?: boolean
  suppressed?: boolean
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
  else if (/\b(lunar|moon|lua)\b/i.test(lower)) gravityG = 0.16
  else if (/\b(mars|martian|marte)\b/i.test(lower)) gravityG = 0.38
  else if (explicitG) gravityG = Math.min(1.5, Number(explicitG[1]))
  else if (/\b(earth|terrestrial|terra)\b/i.test(lower)) gravityG = 1

  const unitFlow = lower.match(/(\d+(?:\.\d+)?)\s*(?:cm\/?s\b|cm\/sec\b)/i)
  const keywordFlow = lower.match(/(?:airflow|flow|ventila(?:tion|ção|cao)?|fluxo|\bwind)\D{0,8}(\d+(?:\.\d+)?)/i)
  if (unitFlow) airflowCms = Math.min(80, Math.max(0, Number(unitFlow[1])))
  else if (keywordFlow) airflowCms = Math.min(80, Math.max(0, Number(keywordFlow[1])))
  else if (/\b(?:airflow|ventila(?:tion|ção|cao)?|fluxo|wind)\b/i.test(lower)) airflowCms = Math.max(8, airflowCms)

  return {
    gravityG: Math.min(1.5, Math.max(0, gravityG)),
    o2Pct,
    airflowCms,
    coolFlame: /cool[- ]?flame|chama fria|quench|720\s?k|invisible|\buv\b/i.test(lower),
    enriched:
      o2Pct >= 34 ||
      /\b(o2|oxygen|oxig[eê]nio|artemis|apollo|mir|flashover|hypergolic)\b/i.test(lower),
    suppressed: /\b(co2|helium|\bhe\b|suppress|extinguish|cut ventilation|diluent|halon)\b/i.test(
      lower,
    ),
  }
}

interface EdgePulse {
  x: number
  y: number
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
  /** The pill the flame feeds on — measured every frame for emission geometry. */
  barRef: React.RefObject<HTMLElement | null>
  /** Element that receives the dynamic thermal box-shadow. */
  glowRef: React.RefObject<HTMLElement | null>
}

const CELL = 4 // CSS px per simulation cell
const MAX_W = 260
const MAX_H = 140
const MAX_COUNT = MAX_W * MAX_H
const MAX_EMBERS = 100
const BASE_EMBERS = 60
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

/** 3-octave FBM in [0,1]. */
function fbm3(x: number, y: number) {
  return (
    vnoise(x, y) * 0.5 +
    vnoise(x * 2.07 + 13.7, y * 2.07 - 7.9) * 0.3 +
    vnoise(x * 4.31 - 31.1, y * 4.31 + 17.3) * 0.2
  )
}

type Stop = [number, number, number, number]

/** Palette stops per regime, u = 0 (hottest core) → 1 (coolest tip). */
const STOPS: { rich: Stop[]; clean: Stop[]; cool: Stop[]; enriched: Stop[]; suppressed: Stop[] } = {
  rich: [
    [0, 254, 249, 195],
    [0.25, 250, 204, 21],
    [0.55, 249, 115, 22],
    [0.8, 220, 38, 38],
    [1, 153, 27, 27],
  ],
  clean: [
    [0, 224, 242, 254],
    [0.4, 56, 189, 248],
    [0.7, 14, 165, 233],
    [1, 3, 105, 161],
  ],
  cool: [
    [0, 167, 139, 250],
    [0.5, 124, 58, 237],
    [1, 67, 56, 202],
  ],
  enriched: [
    [0, 239, 246, 255],
    [0.2, 96, 165, 250],
    [0.45, 250, 204, 21],
    [0.75, 249, 115, 22],
    [1, 220, 38, 38],
  ],
  suppressed: [
    [0, 204, 251, 241],
    [0.4, 45, 212, 191],
    [0.75, 15, 118, 110],
    [1, 19, 78, 74],
  ],
}

function ramp(stops: Stop[], u: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, u))
  for (let s = 1; s < stops.length; s++) {
    if (x <= stops[s][0]) {
      const a = stops[s - 1]
      const b = stops[s]
      const f = (x - a[0]) / Math.max(1e-6, b[0] - a[0])
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]
    }
  }
  const last = stops[stops.length - 1]
  return [last[1], last[2], last[3]]
}

/**
 * Free-flame field: the bar's top edge and side curves are only an emission
 * line. A low-res temperature field is advected upward by 3-octave curl-FBM
 * velocities + buoyancy, so tongues escape in asymmetric 15–110px peaks and
 * wisps detach. Color is a continuous 5-regime spectral blend.
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
    let count = 0
    let image: ImageData | null = null
    let imageData: Uint8ClampedArray | null = null
    const temperature = new Float32Array(MAX_COUNT)
    const nextTemperature = new Float32Array(MAX_COUNT)
    const vx = new Float32Array(MAX_COUNT)
    const vy = new Float32Array(MAX_COUNT)
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
      enriched: parameters.enriched ? 1 : 0,
      suppressed: parameters.suppressed ? 1 : 0,
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
      if (p.x < -900) {
        p.x = mx
        p.y = my
      } else {
        p.x += (mx - p.x) * ease
        p.y += (my - p.y) * ease
      }
      p.vx += (ivx - p.vx) * ease
      p.vy += (ivy - p.vy) * ease
      p.proximity = Math.max(0, 1 - distance / 150)
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

    const onMotionChange = () => {
      if (!reducedMotion.matches && visible) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(draw)
      }
    }
    if ('addEventListener' in reducedMotion) {
      reducedMotion.addEventListener('change', onMotionChange)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const w = Math.min(MAX_W, Math.max(8, Math.round(rect.width / CELL)))
      const h = Math.min(MAX_H, Math.max(8, Math.round(rect.height / CELL)))
      if (w !== Wg || h !== Hg) {
        Wg = w
        Hg = h
        count = w * h
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
    const bar = { l: 0, t: 0, w: 0, h: 0, cx: 0, cy: 0 }
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
      return true
    }

    const at = (x: number, y: number) => y * Wg + x
    const sample = (field: Float32Array, x: number, y: number) => {
      const xx = Math.max(0, Math.min(Wg - 1.001, x))
      const yy = Math.max(0, Math.min(Hg - 1.001, y))
      const x0 = xx | 0
      const y0 = yy | 0
      const fx = xx - x0
      const fy = yy - y0
      const a = field[at(x0, y0)]
      const b = field[at(Math.min(Wg - 1, x0 + 1), y0)]
      const c = field[at(x0, Math.min(Hg - 1, y0 + 1))]
      const d = field[at(Math.min(Wg - 1, x0 + 1), Math.min(Hg - 1, y0 + 1))]
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
    }

    const spawnEmber = (x: number, y: number, kickX: number, kickY: number, micro: number) => {
      if (embers.length >= MAX_EMBERS) embers.shift()
      const a = Math.random() * TAU
      embers.push({
        x,
        y,
        vx: kickX * 0.12 + Math.cos(a) * 24,
        vy: kickY * 0.12 + Math.sin(a) * 24 - (micro > 0.5 ? 0 : 40),
        life: 0,
        maxLife: 0.9 + Math.random() * 1.7,
        size: 1.1 + Math.random() * 1.7,
        seed: Math.random() * 1000,
      })
    }

    const setGlow = (intensity: number, wClean: number, wCool: number, wSupp: number) => {
      const glow = glowRef.current
      if (!glow) return
      const i = Math.max(0, Math.min(1, intensity))
      if (i < 0.02) {
        glow.style.boxShadow = 'none'
        return
      }
      if (wSupp > 0.5) {
        glow.style.boxShadow = `0 0 ${12 + 22 * i}px rgba(45,212,191,${0.2 + 0.3 * i}), inset 0 0 ${8 + 12 * i}px rgba(15,118,110,${0.14 + 0.2 * i})`
      } else if (wCool > 0.5) {
        glow.style.boxShadow = `0 0 ${16 + 32 * i}px rgba(139,92,246,${0.25 + 0.32 * i}), inset 0 0 ${10 + 16 * i}px rgba(67,56,202,${0.14 + 0.22 * i})`
      } else if (wClean > 0.5) {
        glow.style.boxShadow = `0 0 ${14 + 30 * i}px rgba(56,189,248,${0.25 + 0.35 * i}), inset 0 0 ${10 + 16 * i}px rgba(2,132,199,${0.15 + 0.25 * i})`
      } else {
        glow.style.boxShadow = `0 -6px ${18 + 34 * i}px rgba(249,115,22,${0.26 + 0.38 * i}), 0 4px ${10 + 18 * i}px rgba(245,158,11,${0.16 + 0.24 * i}), inset 0 0 ${8 + 14 * i}px rgba(245,158,11,${0.16 + 0.28 * i})`
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
      active.enriched += ((target.enriched ? 1 : 0) - active.enriched) * easing
      active.suppressed += ((target.suppressed ? 1 : 0) - active.suppressed) * easing

      const micro = 1 - smooth(0.02, 0.3, active.gravityG)
      // Spectral weights, normalized partition of unity (suppression dominates, then cool).
      const rawSupp = active.suppressed
      const rawCool = active.coolFlame * (1 - rawSupp)
      const rawEnr = active.enriched * (1 - rawSupp) * (1 - active.coolFlame * 0.5)
      const rawClean = micro * (1 - rawSupp) * (1 - rawCool)
      const rawRich = Math.max(0, 1 - rawSupp - rawCool - rawEnr - rawClean)
      const sumW = rawSupp + rawCool + rawEnr + rawClean + rawRich
      const invW = sumW > 1e-4 ? 1 / sumW : 1
      const wSupp = rawSupp * invW
      const wCool = rawCool * invW
      const wEnr = rawEnr * invW
      const wClean = rawClean * invW
      const wRich = rawRich * invW

      const o2Gain = 0.7 + Math.min(0.6, active.o2Pct / 70)
      const turbulence = (0.55 + (1 - micro) * 0.45) * (1 + 0.4 * wEnr) * (1 - wCool * 0.5)
      const heightScale = (1 - 0.55 * wSupp) * (micro > 0.5 ? 0.55 : 1)
      const buoyK = (0.9 * (1 - micro) + 0.12) * heightScale
      const windX = active.airflowCms * 0.012

      const pointer = pointerRef.current
      const decay = Math.exp(-dt * 4)
      pointer.vx *= decay
      pointer.vy *= decay
      const pointerSpeed = Math.hypot(pointer.vx, pointer.vy)
      const pointerNear =
        hasBar &&
        pointer.proximity > 0 &&
        pointer.x > bar.l - 60 &&
        pointer.x < bar.l + bar.w + 60 &&
        pointer.y > bar.t - 140 &&
        pointer.y < bar.t + bar.h + 40
      const gridPx = pointer.x / CELL
      const gridPy = pointer.y / CELL

      // Keystroke → localized flare rising just above the caret.
      const pulseNow = pulseRef.current
      if (pulseNow.id !== lastPulseRef.current.id && hasBar) {
        lastPulseRef.current = pulseNow
        const px = bar.l + (0.1 + pulseNow.position * 0.8) * bar.w
        pulses.push({ x: px / CELL, y: (bar.t - 3) / CELL, at: simTime, power: 0.9 })
        for (let k = 0; k < 6; k++) {
          spawnEmber(px + (Math.random() - 0.5) * 10, bar.t, 0, -80, micro)
        }
      }
      while (pulses.length > 8) pulses.shift()

      if (pointerNear && pointerSpeed > 300 && embers.length > 4 && Math.random() < 0.6) {
        spawnEmber(pointer.x, pointer.y, pointer.vx, pointer.vy, micro)
      }

      // ---- velocity field: 3-octave curl-FBM + buoyancy + wind + cursor wake ----
      const ns = 0.09 // noise spatial frequency, grid units
      for (let y = 0; y < Hg; y++) {
        for (let x = 0; x < Wg; x++) {
          const i = at(x, y)
          const nx = x * ns
          const ny = y * ns
          const cx =
            (fbm3(nx + simTime * 0.5, ny - simTime * 0.34) - 0.5) * 2 +
            0.6 * Math.sin(nx * 6 + ny * 2 - simTime * 1.7)
          const cy =
            (fbm3(nx - simTime * 0.28 + 47.3, ny + simTime * 0.44) - 0.5) * 2 +
            0.4 * Math.sin(nx * 3 - ny * 5 + simTime * 1.3)
          const dx = x - gridPx
          const dy = y - gridPy
          const r2 = dx * dx + dy * dy + 16
          const wake = pointerNear ? Math.exp(-r2 / 260) : 0
          const gvx = pointerNear ? (pointer.vx / CELL) * 0.02 : 0
          const gvy = pointerNear ? (pointer.vy / CELL) * 0.02 : 0
          const thermal = temperature[i]
          const buoy = thermal * buoyK * 2.6
          // Microgravity: weak radial outflow from the bar centre instead of rise.
          const radial = micro * 0.25 * Math.max(0, thermal - 0.05)
          const rdx = x - bar.cx / CELL
          const rdy = y - bar.cy / CELL
          const rl = Math.hypot(rdx, rdy) + 8
          vx[i] =
            cx * turbulence * 1.4 + windX + gvx * wake - (dy * wake * pointerSpeed) / CELL / 60 +
            (rdx / rl) * radial
          vy[i] =
            cy * turbulence * 1.1 - buoy + gvy * wake + (dx * wake * pointerSpeed) / CELL / 60 +
            (rdy / rl) * radial
        }
      }

      // ---- advect + diffuse + emit ----
      const diffuse = 0.16 + micro * 0.12
      const coolDecay = 0.3 + 0.25 * wSupp + 0.15 * wCool
      for (let y = 0; y < Hg; y++) {
        for (let x = 0; x < Wg; x++) {
          const i = at(x, y)
          const advected = sample(temperature, x - vx[i] * dt * 6, y - vy[i] * dt * 6)
          const l = temperature[at(Math.max(0, x - 1), y)]
          const r = temperature[at(Math.min(Wg - 1, x + 1), y)]
          const u = temperature[at(x, Math.max(0, y - 1))]
          const d = temperature[at(x, Math.min(Hg - 1, y + 1))]
          const lap = l + r + u + d - 4 * temperature[i]

          // Emission along the top edge + upper side curves only.
          let emit = 0
          if (hasBar) {
            const px = x * CELL
            const py = y * CELL
            const onTop = Math.exp(-((py - bar.t) * (py - bar.t)) / (2 * 5 * 5)) * (px > bar.l && px < bar.l + bar.w ? 1 : 0)
            const cr = Math.min(26, bar.h / 2)
            const clx = bar.l + cr
            const crx = bar.l + bar.w - cr
            const cornerL = Math.exp(-((Math.hypot(px - clx, py - (bar.t + cr)) - cr) ** 2) / 18) * (px <= clx ? 1 : 0)
            const cornerR = Math.exp(-((Math.hypot(px - crx, py - (bar.t + cr)) - cr) ** 2) / 18) * (px >= crx ? 1 : 0)
            const edge = Math.min(1, onTop + cornerL * 0.8 + cornerR * 0.8)
            const flick = 0.7 + 0.3 * fbm3(px * 0.02, simTime * 0.9)
            emit = edge * o2Gain * flick * (1 - wSupp * 0.4)
          }
          for (const p of pulses) {
            const age = simTime - p.at
            if (age > 1.3) continue
            const px = (x - p.x) / 4.5
            const py = (y - p.y) / 4
            emit += p.power * Math.exp(-(px * px + py * py)) * Math.exp(-age * 2.2)
          }
          // Cursor oxygen injection: local heat + brightness boost.
          const dx = x - gridPx
          const dy = y - gridPy
          const o2inject = pointerNear
            ? Math.exp(-(dx * dx + dy * dy) / 320) * (0.4 + Math.min(1.2, pointerSpeed / 600))
            : 0
          nextTemperature[i] = Math.max(
            0,
            Math.min(
              1.6,
              advected + lap * diffuse * dt * 8 + (emit + o2inject * 0.5) * dt * 3.4 - coolDecay * dt,
            ),
          )
        }
      }
      temperature.set(nextTemperature.subarray(0, count))

      // ---- embers spawning at hot crests ----
      const targetEmbers = Math.round(BASE_EMBERS + (MAX_EMBERS - BASE_EMBERS) * glowLevel)
      let spawnBudget = 5
      while (embers.length < targetEmbers && spawnBudget-- > 0 && hasBar) {
        const sx = bar.l + Math.random() * bar.w
        const gy = Math.max(0, Math.floor((bar.t - 4) / CELL))
        const gx = Math.floor(sx / CELL)
        if (gx > 0 && gx < Wg && temperature[at(gx, gy)] > 0.35) {
          spawnEmber(sx, bar.t + (Math.random() - 0.5) * 4, 0, -60, micro)
        }
      }

      // ---- render ----
      const pulseA = 0.55 + 0.45 * Math.sin(simTime * 4.6)
      const alphaScale = 1 - wCool * 0.4 - wSupp * 0.3
      let edgeHeat = 0
      let edgeN = 0
      for (let y = 0; y < Hg; y++) {
        const py = (y + 0.5) * CELL
        for (let x = 0; x < Wg; x++) {
          const i = at(x, y)
          const o = i * 4
          const t = Math.max(0, Math.min(1.4, temperature[i]))
          const hot = Math.min(1, t)
          const u = 1 - Math.min(1, t * 1.15)
          // Blend all five palettes by active weight — continuous lerp.
          let r = 0
          let g = 0
          let b = 0
          if (wRich > 0.01) {
            const c = ramp(STOPS.rich, u)
            r += c[0] * wRich
            g += c[1] * wRich
            b += c[2] * wRich
          }
          if (wClean > 0.01) {
            const c = ramp(STOPS.clean, u)
            r += c[0] * wClean
            g += c[1] * wClean
            b += c[2] * wClean
          }
          if (wCool > 0.01) {
            const c = ramp(STOPS.cool, u)
            r += c[0] * wCool
            g += c[1] * wCool
            b += c[2] * wCool
          }
          if (wEnr > 0.01) {
            const c = ramp(STOPS.enriched, u)
            r += c[0] * wEnr
            g += c[1] * wEnr
            b += c[2] * wEnr
          }
          if (wSupp > 0.01) {
            const c = ramp(STOPS.suppressed, u)
            r += c[0] * wSupp
            g += c[1] * wSupp
            b += c[2] * wSupp
          }
          // Cursor heats → whiter/hotter locally (fresh O₂).
          const dx = x - gridPx
          const dy = y - gridPy
          const o2glow = pointerNear ? Math.exp(-(dx * dx + dy * dy) / 240) : 0
          r += (255 - r) * o2glow * 0.55
          g += (248 - g) * o2glow * 0.45
          b += (220 - b) * o2glow * 0.3
          // Subtle inset/bottom glow bleeding through the translucent pill.
          let inset = 0
          if (hasBar && py > bar.t && py < bar.t + bar.h + 10) {
            const insideY = Math.exp(-((py - bar.t - 6) * (py - bar.t - 6)) / 200)
            inset = insideY * 0.25
          }
          let alpha = hot * 230 * alphaScale + o2glow * 90 + inset * 90
          if (wCool > 0.5) alpha *= 0.6 + 0.4 * pulseA
          imageData[o] = r
          imageData[o + 1] = g
          imageData[o + 2] = b
          imageData[o + 3] = Math.min(245, alpha)
          if (py > bar.t - 30 && py < bar.t + 10) {
            edgeHeat += hot
            edgeN++
          }
        }
      }
      ctx.putImageData(image, 0, 0)

      const heatAvg = edgeN > 0 ? edgeHeat / edgeN : 0
      const targetGlow = Math.min(1, heatAvg * 1.3 + (pointerNear ? 0.12 : 0))
      glowLevel += (targetGlow - glowLevel) * (1 - Math.exp(-dt * 5))
      setGlow(glowLevel * (0.85 + 0.15 * Math.sin(simTime * 6.1)), wClean, wCool, wSupp)

      // ---- ember overlay ----
      const cw = canvas.clientWidth || 1
      const ch = canvas.clientHeight || 1
      emberCtx.clearRect(0, 0, cw, ch)
      const dominant = wSupp > 0.4 ? 'supp' : wCool > 0.4 ? 'cool' : wClean > 0.4 ? 'clean' : 'rich'
      for (let k = embers.length - 1; k >= 0; k--) {
        const e = embers[k]
        e.life += dt
        if (e.life >= e.maxLife) {
          embers.splice(k, 1)
          continue
        }
        const swirl = Math.sin(e.seed + e.life * 7 + e.y * 0.04) * (26 + 14 * turbulence)
        e.vx += (swirl + windX * 40 - e.vx * 1.6) * dt
        e.vy += (-60 * (1 - micro) * heightScale - e.vy * 1.4) * dt * (micro > 0.5 ? 0.4 : 1)
        e.x += e.vx * dt
        e.y += e.vy * dt
        const lifeT = e.life / e.maxLife
        const size = e.size * (1 - lifeT * 0.85)
        const alpha = 1 - lifeT
        if (size <= 0.15) continue
        emberCtx.fillStyle =
          dominant === 'supp'
            ? `rgba(94,234,212,${(alpha * 0.8).toFixed(3)})`
            : dominant === 'cool'
              ? `rgba(167,139,250,${(alpha * 0.75).toFixed(3)})`
              : dominant === 'clean'
                ? `rgba(125,211,252,${(alpha * 0.9).toFixed(3)})`
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
      if ('removeEventListener' in reducedMotion) {
        reducedMotion.removeEventListener('change', onMotionChange)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onPointer)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-12 -left-12 -right-12 -top-[130px] mix-blend-normal"
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
