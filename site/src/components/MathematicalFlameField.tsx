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

  const flow = lower.match(/(?:airflow|flow|ventila(?:tion|ção|cao)?|fluxo|\bwind)\D{0,16}(\d+(?:\.\d+)?)\s*(?:cm\/?s|cm\/sec)?/i)
  if (flow) airflowCms = Math.min(80, Number(flow[1]))
  else if (/\bairflow|ventila(?:tion|ção|cao)|fluxo\b/i.test(lower)) airflowCms = Math.max(8, airflowCms)

  return {
    gravityG: Math.min(1.5, Math.max(0, gravityG)),
    o2Pct,
    airflowCms,
    coolFlame: /cool[- ]?flame|chama fria/i.test(lower),
  }
}

interface FlamePulse {
  x: number
  y: number
  power: number
  at: number
}

interface MathematicalFlameFieldProps {
  parameters: FlameParameters
  pulse: { id: number; position: number }
}

const W = 112
const H = 58
const count = W * H
const BLACKBODY_RGB = Array.from({ length: 256 }, (_, i) => {
  const temperature = (300 + (i / 255) * 2700) / 100
  const red = temperature <= 66 ? 255 : 329.6987 * (temperature - 60) ** -0.1332
  const green = temperature <= 66
    ? 99.4708 * Math.log(temperature) - 161.1196
    : 288.1222 * (temperature - 60) ** -0.0755
  const blue = temperature >= 66
    ? 255
    : temperature <= 19
      ? 0
      : 138.5177 * Math.log(temperature - 10) - 305.0448
  return [red, green, blue].map((channel) => Math.max(0, Math.min(255, channel)))
})

/** Low-resolution Eulerian temperature field, upscaled by the browser. */
export default function MathematicalFlameField({
  parameters,
  pulse,
}: MathematicalFlameFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paramsRef = useRef(parameters)
  const initialParamsRef = useRef(parameters)
  const pulseRef = useRef(pulse)
  const pointerRef = useRef({ x: 0.5, y: 0.58, proximity: 0 })
  const lastPulseRef = useRef(pulse)

  paramsRef.current = parameters
  pulseRef.current = pulse

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: true })
    if (!canvas || !ctx) return

    canvas.width = W
    canvas.height = H
    const image = ctx.createImageData(W, H)
    const temperature = new Float32Array(count)
    const nextTemperature = new Float32Array(count)
    const vx = new Float32Array(count)
    const vy = new Float32Array(count)
    const curl = new Float32Array(count)
    const curlMagnitude = new Float32Array(count)
    const imageData = image.data
    let raf = 0
    let last = 0
    let simTime = 0
    let visible = true
    const active = {
      gravityG: initialParamsRef.current.gravityG,
      o2Pct: initialParamsRef.current.o2Pct,
      airflowCms: initialParamsRef.current.airflowCms,
      coolFlame: initialParamsRef.current.coolFlame ? 1 : 0,
    }
    const pulses: FlamePulse[] = []
    const reducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : { matches: false }

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width && rect.height) {
        const outsideX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right)
        const outsideY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom)
        const distance = Math.hypot(outsideX, outsideY)
        pointerRef.current = {
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
          proximity: Math.max(0, 1 - distance / 190),
        }
      }
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

    const at = (x: number, y: number) => y * W + x
    const sample = (field: Float32Array, x: number, y: number) => {
      const xx = Math.max(0, Math.min(W - 1.001, x))
      const yy = Math.max(0, Math.min(H - 1.001, y))
      const x0 = xx | 0
      const y0 = yy | 0
      const fx = xx - x0
      const fy = yy - y0
      const a = field[at(x0, y0)]
      const b = field[at(Math.min(W - 1, x0 + 1), y0)]
      const c = field[at(x0, Math.min(H - 1, y0 + 1))]
      const d = field[at(Math.min(W - 1, x0 + 1), Math.min(H - 1, y0 + 1))]
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
    }
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    const draw = (now: number) => {
      if (!visible) return
      if (now - last < 30 && !reducedMotion.matches) {
        raf = requestAnimationFrame(draw)
        return
      }
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 30)
      last = now
      simTime += reducedMotion.matches ? 0 : dt

      const target = paramsRef.current
      const easing = 1 - Math.exp(-dt * 5)
      active.gravityG += (target.gravityG - active.gravityG) * easing
      active.o2Pct += (target.o2Pct - active.o2Pct) * easing
      active.airflowCms += (target.airflowCms - active.airflowCms) * easing
      active.coolFlame += ((target.coolFlame ? 1 : 0) - active.coolFlame) * easing
      const gravity = active.gravityG
      const micro = 1 - smooth(0.02, 0.3, gravity)
      const turbulence = 0.025 + (1 - micro) * 0.975
      const sourceX = W * 0.5
      const sourceY = H * 0.76
      const pointer = pointerRef.current
      const vortexX = pointer.x * W
      const vortexY = pointer.y * H
      const pulseNow = pulseRef.current
      if (pulseNow.id !== lastPulseRef.current.id) {
        lastPulseRef.current = pulseNow
        pulses.push({
          x: W * (0.22 + pulseNow.position * 0.56),
          y: sourceY - 5,
          power: 0.52 + Math.min(0.38, active.o2Pct / 120),
          at: simTime,
        })
      }
      while (pulses.length > 12) pulses.shift()

      // Streamfunction curl field plus a localized cursor vortex.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = at(x, y)
          const nx = x / W
          const ny = y / H
          const phase = simTime * 1.1
          const dPsiDy =
            0.9 * Math.cos(ny * 13 + phase + Math.sin(nx * 8 + phase) * 0.7) +
            0.36 * Math.cos(ny * 27 - phase * 0.8 + nx * 5)
          const dPsiDx =
            -0.63 * Math.cos(nx * 8 + phase) * Math.sin(ny * 13 + phase + Math.sin(nx * 8 + phase) * 0.7) +
            0.18 * Math.sin(nx * 5 + ny * 27 - phase * 0.8)
          const dx = x - vortexX
          const dy = y - vortexY
          const r2 = dx * dx + dy * dy + 20
          const cursorCurl = Math.exp(-r2 / 290) * 3.8 * pointer.proximity
          const thermal = temperature[i]
          const buoyancy = gravity * Math.max(0, thermal - 0.1) * 0.32
          vx[i] = dPsiDy * 0.62 * turbulence - dy * cursorCurl / 22
          vy[i] = -dPsiDx * 0.62 * turbulence - buoyancy + dx * cursorCurl / 22
        }
      }
      // Vorticity confinement restores small eddies lost to semi-Lagrangian
      // interpolation: f = epsilon (N × omega), with omega = curl(u).
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = at(x, y)
          curl[i] = (vy[at(x + 1, y)] - vy[at(x - 1, y)] - vx[at(x, y + 1)] + vx[at(x, y - 1)]) * 0.5
          curlMagnitude[i] = Math.abs(curl[i])
        }
      }
      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          const i = at(x, y)
          const gradX = (curlMagnitude[at(x + 1, y)] - curlMagnitude[at(x - 1, y)]) * 0.5
          const gradY = (curlMagnitude[at(x, y + 1)] - curlMagnitude[at(x, y - 1)]) * 0.5
          const norm = Math.hypot(gradX, gradY) + 1e-5
          const epsilon = 0.11 * turbulence
          vx[i] += (gradY / norm) * curl[i] * epsilon
          vy[i] -= (gradX / norm) * curl[i] * epsilon
        }
      }

      // Semi-Lagrangian Eulerian advection, isotropic diffusion and a hot source.
      const diffusion = 0.12 + micro * 0.2
      const oxygenGain = 0.72 + Math.min(0.7, active.o2Pct / 60)
      const flowX = active.airflowCms * 0.014
      const displayAspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
      const isotropicXScale = Math.max(0.08, Math.min(1, (W / H) / displayAspect))
      const sourceRadiusX = (micro > 0.5 ? 18 : 11) * isotropicXScale
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = at(x, y)
          const backX = x - (vx[i] + flowX) * dt * 8
          const backY = y - vy[i] * dt * 8
          const advected = sample(temperature, backX, backY)
          const left = temperature[at(Math.max(0, x - 1), y)]
          const right = temperature[at(Math.min(W - 1, x + 1), y)]
          const up = temperature[at(x, Math.max(0, y - 1))]
          const down = temperature[at(x, Math.min(H - 1, y + 1))]
          const laplacian = left + right + up + down - 4 * temperature[i]
          const rx = (x - sourceX) / sourceRadiusX
          const ry = (y - sourceY) / (micro > 0.5 ? 15 : 18)
          const sourceShape = Math.exp(-(rx * rx + ry * ry) * 1.35)
          let ignition = sourceShape * oxygenGain * (0.22 + 0.035 * Math.sin(simTime * 3))
          for (const pulse of pulses) {
            const age = simTime - pulse.at
            const px = (x - pulse.x) / 5.5
            const py = (y - pulse.y) / 4
            ignition += age < 1.2 ? pulse.power * Math.exp(-(px * px + py * py)) * Math.exp(-age * 2.4) : 0
          }
          nextTemperature[i] = Math.max(
            0,
            Math.min(1.5, advected + laplacian * diffusion * dt * 8 + ignition * dt * 3 - 0.18 * dt),
          )
        }
      }
      temperature.set(nextTemperature)

      const cool = active.coolFlame
      const pulsePhase = simTime * (cool ? 6 : 3)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = at(x, y)
          const t = Math.max(0, Math.min(1, temperature[i]))
          const edgeNoise = 0.84 + 0.16 * Math.sin(x * 0.37 + y * 0.21 + pulsePhase)
          const kelvin = 300 + t * 2700
          const coolBand = smooth(620, 720, kelvin) * (1 - smooth(720, 850, kelvin)) * edgeNoise * cool
          const hot = smooth(0.12, 0.85, t)
          const blue = micro * hot
          const blackbody = BLACKBODY_RGB[Math.round(t * 255)]
          let r = blackbody[0] * (1 - blue) + 51 * blue
          let g = blackbody[1] * (1 - blue) + 212 * blue
          let b = blackbody[2] * (1 - blue) + 255 * blue
          const core = smooth(0.72, 0.98, t)
          r = r + (255 - r) * core * 0.78
          g = g + (242 - g) * core * 0.7
          b = b + (194 - b) * core * 0.55
          r = r * (1 - coolBand) + 114 * coolBand
          g = g * (1 - coolBand) + 90 * coolBand
          b = b * (1 - coolBand) + 221 * coolBand
          const alpha = Math.min(178, (hot * 105 + coolBand * 56) * edgeNoise)
          const o = i * 4
          imageData[o] = r
          imageData[o + 1] = g
          imageData[o + 2] = b
          imageData[o + 3] = alpha
        }
      }
      ctx.putImageData(image, 0, 0)
      if (!reducedMotion.matches) raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onPointer)
      }
    }
  }, [])

  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-3 -inset-y-2 overflow-hidden rounded-[30px] opacity-70 mix-blend-multiply">
      <canvas ref={canvasRef} className="h-full w-full blur-[1.5px]" style={{ imageRendering: 'auto' }} />
      <div className="absolute inset-0 bg-gradient-to-r from-[#F4F3EE]/60 via-transparent to-[#F4F3EE]/60" />
    </div>
  )
}
