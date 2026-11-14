/**
 * Hero backdrop — isometric thermal mesh + starfield, canvas 2D.
 *
 * Mesh: CELLS_W×CELLS_H quads spanning min(vw*0.85,1300) × vh*0.55.
 * Vertex heights come from the harmonic wave field plus a gaussian
 * "ignition" bump that lerps toward the cursor — the ridge under the
 * mouse literally heats to red. Vertex z is evaluated once per frame
 * into a grid (corners shared by 4 cells) and cells paint back→front.
 *
 * Color: continuous thermal ramp teal-green (cold) → yellow → orange →
 * red (ignition), hue lerping 168°→4° by normalized elevation.
 *
 * Resize fix kept: redraws at the current wave time (was drawWave(0)).
 * Projection scales are derived from the mesh rect, not raw viewport,
 * so ultrawide/mobile resizes never anamorphically distort the iso.
 */
import { useEffect, useRef } from 'react'

const CELLS_W = 64
const CELLS_H = 38
const EXTENT = 3
const VW = CELLS_W + 1
const VH = CELLS_H + 1
const N_VERT = VW * VH

// painter order is static — sort once (back→front by iso depth i+j)
const CELL_ORDER = Array.from({ length: CELLS_W * CELLS_H }, (_, i) => {
  const cx = i % CELLS_W
  const cy = (i / CELLS_W) | 0
  return [cx + cy, i] as const
})
  .sort((a, b) => a[0] - b[0])
  .map(([, i]) => i)

const STEP_X = (EXTENT * 2) / CELLS_W
const STEP_Y = (EXTENT * 2) / CELLS_H

function surfaceZ(x: number, y: number, t: number): number {
  // Stylized mathematical wave for the hero; it is illustrative, not experimental data.
  return (
    0.78 * Math.sin(x * 1.18 + t) * Math.cos(y * 1.04 - t * 0.72) +
    0.28 * Math.sin(x * 2.05 - t * 0.68) * Math.cos(y * 1.55 + t * 0.8)
  )
}

export default function HeroCanvas() {
  const starsRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const starsCanvas = starsRef.current
    const waveCanvas = waveRef.current
    if (!host || !starsCanvas || !waveCanvas) return
    const stars = starsCanvas.getContext('2d')!
    const wave = waveCanvas.getContext('2d')!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')

    let width = 0
    let height = 0
    let pixelRatio = 1
    let frame = 0
    let waveTime = 0

    // mesh rect in canvas pixels (CSS px after DPR transform)
    let meshW = 0
    let meshH = 0
    let meshCX = 0
    let meshCY = 0
    let kx = 1
    let ky = 1
    let kz = 1
    let cyBase = 0

    const zGrid = new Float32Array(N_VERT)
    const pointer = { sx: -9999, sy: -9999 }
    const mouse = { x: 0, y: 0 }
    let hasPointer = false

    const toWorld = (sx: number, sy: number): [number, number] => {
      const a = (sx - meshCX) / kx // = x - y
      const b = (sy - cyBase) / ky // = x + y
      return [(a + b) / 2, (b - a) / 2]
    }

    function onPointerMove(e: PointerEvent) {
      const rect = waveCanvas!.getBoundingClientRect()
      pointer.sx = e.clientX - rect.left
      pointer.sy = e.clientY - rect.top
      hasPointer = true
    }

    function project(x: number, y: number, z: number): [number, number] {
      return [meshCX + (x - y) * kx, cyBase + (x + y) * ky - z * kz]
    }

    function drawStars() {
      stars.clearRect(0, 0, width, height)
      for (let i = 0; i < 145; i++) {
        const x = ((Math.sin(i * 127.1 + 1) * 43758.5453) % 1 + 1) % 1
        const y = ((Math.sin(i * 311.7 + 2) * 96453.132) % 1 + 1) % 1
        stars.fillStyle = `rgba(195,218,236,${0.16 + (i % 5) * 0.1})`
        stars.beginPath()
        stars.arc(x * width, y * height, i % 11 === 0 ? 1.2 : 0.6, 0, Math.PI * 2)
        stars.fill()
      }
    }

    function vertexHeight(x: number, y: number, t: number): number {
      if (!hasPointer) return surfaceZ(x, y, t)
      // gaussian ignition bump where the cursor is — lerped for smoothness
      const dx = x - mouse.x
      const dy = y - mouse.y
      const bump =
        1.45 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.82 * 0.82))
      return surfaceZ(x, y, t) + bump
    }

    function drawWave(time: number) {
      wave.clearRect(0, 0, width, height)

      // 1) vertex heights — shared by the 4 cells that touch each vertex
      let v = 0
      for (let iy = 0; iy <= CELLS_H; iy++) {
        const y = -EXTENT + iy * STEP_Y
        for (let ix = 0; ix <= CELLS_W; ix++, v++) {
          const x = -EXTENT + ix * STEP_X
          zGrid[v] = vertexHeight(x, y, time)
        }
      }

      // 2) cells back→front, flat-shaded quads with thermal color
      const stepX = STEP_X
      const stepY = STEP_Y
      for (const ci of CELL_ORDER) {
        const cx = ci % CELLS_W
        const cy = (ci / CELLS_W) | 0
        const i0 = cy * VW + cx
        const corners = [i0, i0 + 1, i0 + 1 + VW, i0 + VW]
        const zs = [zGrid[corners[0]], zGrid[corners[1]], zGrid[corners[2]], zGrid[corners[3]]]
        const x0 = -EXTENT + cx * stepX
        const y0 = -EXTENT + cy * stepY
        const pts: [number, number][] = [
          [x0, y0],
          [x0 + stepX, y0],
          [x0 + stepX, y0 + stepY],
          [x0, y0 + stepY],
        ]
        const avgZ = (zs[0] + zs[1] + zs[2] + zs[3]) / 4
        // map the wave field to the thermal ramp: crests ignite red,
        // troughs stay deep teal (matches the original hero.js mapping)
        const level = Math.max(0, Math.min(1, (avgZ + 1.05) / 2.1))
        // thermal ramp: teal-green → yellow → orange → red-ignition
        const hue = 168 - 164 * level
        const sat = 76 + level * 10
        const lit = 30 + level * 14
        wave.beginPath()
        pts.forEach(([px, py], idx) => {
          const pz = zs[idx]
          const [sx, sy] = project(px, py, pz)
          if (idx === 0) wave.moveTo(sx, sy)
          else wave.lineTo(sx, sy)
        })
        wave.closePath()
        wave.fillStyle = `hsla(${hue}, ${sat}%, ${lit}%, .92)`
        wave.fill()
        wave.strokeStyle = 'rgba(235,255,244,.16)'
        wave.lineWidth = 0.6
        wave.stroke()
      }
    }

    function resize() {
      const bounds = host!.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      pixelRatio = Math.min(devicePixelRatio || 1, 2)
      for (const canvas of [starsCanvas!, waveCanvas!]) {
        canvas.width = Math.round(width * pixelRatio)
        canvas.height = Math.round(height * pixelRatio)
        canvas.getContext('2d')!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      }

      // mesh geometry — 85% of viewport width (max 1300px), 55% of height
      meshW = Math.min(width * 0.85, 1300)
      meshH = height * 0.55
      meshCX = width / 2
      meshCY = height * 0.6
      // near-uniform iso scale → no anamorphic distortion on ultrawide
      kx = meshW * 0.075
      ky = meshH * 0.052
      kz = meshH * 0.16
      cyBase = meshCY

      drawStars()
      drawWave(waveTime)
    }

    function animate(now: number) {
      waveTime = now * 0.00009

      // lerp cursor → world coords (smooth follow, ~12%/frame)
      if (hasPointer) {
        const [wx, wy] = toWorld(pointer.sx, pointer.sy)
        mouse.x += (wx - mouse.x) * 0.12
        mouse.y += (wy - mouse.y) * 0.12
      }
      drawWave(waveTime)
      if (!reduced.matches) frame = requestAnimationFrame(animate)
    }

    function start() {
      cancelAnimationFrame(frame)
      if (reduced.matches) drawWave(waveTime)
      else frame = requestAnimationFrame(animate)
    }

    resize()
    start()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    reduced.addEventListener('change', start)
    // listen on the hero section — the canvases are pointer-events:none
    const scope = host.closest('section') ?? host
    scope.addEventListener('pointermove', onPointerMove)
    const onPointerLeave = () => {
      hasPointer = false
    }
    scope.addEventListener('pointerleave', onPointerLeave)
    return () => {
      observer.disconnect()
      reduced.removeEventListener('change', start)
      scope.removeEventListener('pointermove', onPointerMove)
      scope.removeEventListener('pointerleave', onPointerLeave)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
      <canvas
        ref={starsRef}
        className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-500 dark:opacity-100"
      />
      <canvas
        ref={waveRef}
        className="heat-surface absolute inset-0 h-full w-full cursor-crosshair [animation:reveal-surfaces_3.4s_.25s_ease-out_both]"
      />
    </div>
  )
}
