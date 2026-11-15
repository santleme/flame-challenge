import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FALLBACK_INVESTIGATIONS, type ChamberUiCommand } from '../lib/api'
import {
  streamChamber,
  type ChamberState,
} from '../lib/live'
import { emitSimFrame, peekPendingUiCmd } from '../lib/simBus'
import Button from './ui/Button'
import { IconVideo } from './Icons'

export const CHAMBER_INVESTIGATIONS = Object.entries(FALLBACK_INVESTIGATIONS).map(([id, spec]) => ({
  id,
  label: `${id} · ${spec.materialId}`,
  model: spec.model === 'droplet' ? 'droplet' : 'spread',
}))

const REGIME = ['ignition', 'hot flame', 'cool flame', 'extinction', 'out']
const SPREAD_REGIME = ['preheat', 'spreading', 'cooling', 'out']

type Status = 'idle' | 'streaming' | 'done' | 'offline'
type SensorMode = 'visible' | 'uv'

export default function LiveChamber({
  stage = false,
  autoBoot = true,
  bare = false,
  children,
}: {
  stage?: boolean
  autoBoot?: boolean
  /** canvas only — no telemetry bar, HUD controls, stage line, readout or log */
  bare?: boolean
  children?: ReactNode
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [inv, setInv] = useState<string>('flex-2')
  const [o2, setO2] = useState(21)
  const [flow, setFlow] = useState<number | null>(null)
  const [sealed, setSealed] = useState(false)
  const [frame, setFrame] = useState<ChamberState | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState<string[]>([])
  const [retuneTick, setRetuneTick] = useState(0)

  // Interactive High-Impact Upgrades
  const [splitScreen, setSplitScreen] = useState(false)
  const [sensorMode, setSensorMode] = useState<SensorMode>('visible')
  const [showNasaVideo, setShowNasaVideo] = useState(false)

  const runObservations = useRef({ coolFlameObserved: false, events: [] as string[] })

  // the 30 Hz stream paints the canvas imperatively; React state only
  // tracks a ~10 Hz slice for the text readout, so the deck doesn't
  // reconcile the component on every engine frame
  const frameRef = useRef<ChamberState | null>(null)
  const statusRef = useRef<Status>('idle')
  const viewRef = useRef({ split: false, sensor: 'visible' as SensorMode })
  const lastUiTs = useRef(0)

  const stop = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  const run = useCallback(() => {
    stop()
    frameRef.current = null
    setFrame(null)
    setLog([])
    statusRef.current = 'streaming'
    setStatus('streaming')
    lastUiTs.current = 0
    runObservations.current = { coolFlameObserved: false, events: [] }
    const req = {
      investigationId: inv,
      o2Pct: o2,
      ...(flow != null ? { flowCms: flow } : {}),
      seed: 1,
      ...(sealed
        ? { volumeLiters: 50, ambientO2Pct: o2, ventPerSec: 0.0005 }
        : {}),
    }
    wsRef.current = streamChamber(
      req,
      (s) => {
        if (s.coolFlame) runObservations.current.coolFlameObserved = true
        for (const event of s.events ?? []) {
          if (!runObservations.current.events.includes(event)) runObservations.current.events.push(event)
        }
        const completed = s.done
          ? {
              ...s,
              observations: {
                coolFlameObserved: runObservations.current.coolFlameObserved,
                events: [...runObservations.current.events],
              },
            }
          : s
        frameRef.current = completed
        paint()
        emitSimFrame(completed)
        if (s.events?.length) {
          setLog((l) => [...l.slice(-5), ...s.events!])
        }
        const now = performance.now()
        if (s.done || now - lastUiTs.current > 100) {
          lastUiTs.current = now
          setFrame(completed)
        }
        if (s.done) {
          statusRef.current = 'done'
          setStatus('done')
          window.dispatchEvent(new CustomEvent('ignis:chamber-complete', { detail: completed }))
        }
      },
      () => {
        statusRef.current = 'offline'
        setStatus('offline')
        window.dispatchEvent(new CustomEvent('ignis:chamber-offline'))
        paint()
      },
    )
    if (!wsRef.current) {
      statusRef.current = 'offline'
      setStatus('offline')
      window.dispatchEvent(new CustomEvent('ignis:chamber-offline'))
      paint()
    }
  }, [inv, o2, flow, sealed, stop])

  useEffect(() => stop, [stop])

  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  }, [run])

  // Auto-seed boot run on mount — callers that drive runs exclusively
  // through ignis:ui-command pass autoBoot={false} so mounting alone
  // never fires a stream
  useEffect(() => {
    if (!autoBoot) return
    const timer = setTimeout(() => {
      runRef.current()
    }, 250)
    return () => clearTimeout(timer)
  }, [autoBoot])

  const invRef = useRef(inv)
  useEffect(() => {
    invRef.current = inv
  }, [inv])

  const applyCmd = useCallback(
    (cmd: ChamberUiCommand & { __investigation?: string | null }) => {
      let touched = false
      const requestedInv = cmd.__investigation ?? cmd.load_preset
      const hasPreset = requestedInv != null
      const runnable = !hasPreset || CHAMBER_INVESTIGATIONS.some((i) => i.id === requestedInv)
      if (!runnable) {
        window.dispatchEvent(
          new CustomEvent('ignis:chamber-command-error', { detail: { preset: requestedInv } }),
        )
        return
      }
      const srcInv = requestedInv ?? invRef.current
      const af = cmd.set_airflow_cm_s
      const hasFlow = typeof af === 'number'
      if (runnable) {
        if (srcInv !== invRef.current && !hasFlow) setFlow(null)
        setInv(srcInv)
        touched = true
      }
      if (typeof cmd.set_o2_percent === 'number') {
        setO2(Math.round(Math.min(Math.max(cmd.set_o2_percent, 0), 40) * 10) / 10)
        touched = true
      }
      if (hasFlow) {
        setFlow(Math.round(Math.min(Math.max(af, 0), 40) * 10) / 10)
        touched = true
      }
      if (cmd.trigger_containment) {
        setSealed(true)
        const isN2Purge =
          typeof cmd.trigger_containment === 'string' &&
          (cmd.trigger_containment.toLowerCase().includes('n2') ||
            cmd.trigger_containment.toLowerCase().includes('purge'))
        if (isN2Purge && typeof cmd.set_o2_percent !== 'number') {
          setO2(11.5)
        }
        touched = true
      }
      if (touched && cmd.__run) setRetuneTick((tick) => tick + 1)
    },
    [],
  )

  useEffect(() => {
    const onCmd = (e: Event) => {
      applyCmd(
        (e as CustomEvent<ChamberUiCommand & { __investigation?: string | null }>).detail ?? {},
      )
    }
    window.addEventListener('ignis:ui-command', onCmd)
    const pending = peekPendingUiCmd()
    if (pending) applyCmd(pending)
    return () => window.removeEventListener('ignis:ui-command', onCmd)
  }, [applyCmd])

  useEffect(() => {
    if (retuneTick > 0) run()
  }, [retuneTick, run])

  // Canvas Rendering (Supporting Split-Screen 1g vs µg & UV Sensor Modes)
  // paint() reads refs — the WS handler calls it directly on every
  // frame; the effect below repaints on the ~10 Hz state slice and on
  // view toggles (split screen, sensor mode, theme ink changes)
  function paint(
    f: ChamberState | null = frameRef.current,
    st: Status = statusRef.current,
    split: boolean = viewRef.current.split,
    sensor: SensorMode = viewRef.current.sensor,
  ) {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const w = (cv.width = cv.clientWidth * devicePixelRatio)
    const h = (cv.height = cv.clientHeight * devicePixelRatio)
    ctx.clearRect(0, 0, w, h)
    ctx.save()
    ctx.scale(devicePixelRatio, devicePixelRatio)
    const cw = cv.clientWidth
    const ch = cv.clientHeight
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#e8e6e0'

    if (!f || !f.ignited) {
      ctx.globalAlpha = 0.5
      ctx.font = '14px monospace'
      ctx.fillStyle = ink
      ctx.textAlign = 'center'
      ctx.fillText(
        st === 'offline' ? 'engine offline' : st === 'streaming' ? 'igniting physical chamber…' : 'chamber stand by',
        cw / 2,
        ch / 2 + 3,
      )
      ctx.restore()
      return
    }

    const isCool = f.coolFlame || (f.model === 'droplet' && f.regime === 2)
    const showInvisible = isCool && sensor === 'visible'

    // Helper to draw Microgravity Flame
    const drawMicrogravityFlame = (cx: number, cy: number, maxRadius: number) => {
      if (f.model === 'droplet') {
        const d = Math.max(3, (f.dropletDMm ?? 1) * 12)
        const fr = Math.max(d, (f.flameRMm ?? 0) * 12)

        if (fr > d + 2 && f.regime !== 4) {
          if (showInvisible) {
            // Invisible to naked eye
            ctx.fillStyle = 'rgba(80,120,200,0.06)'
            ctx.beginPath()
            ctx.arc(cx, cy, fr * 1.2, 0, Math.PI * 2)
            ctx.fill()
          } else {
            const g = ctx.createRadialGradient(cx, cy, d, cx, cy, fr * 2.1)
            if (sensor === 'uv' && isCool) {
              g.addColorStop(0, 'rgba(0, 240, 255, 0.75)') // UV false-color cyan
              g.addColorStop(0.4, 'rgba(180, 50, 255, 0.45)') // OH* band magenta
              g.addColorStop(1, 'rgba(0,0,0,0)')
            } else {
              g.addColorStop(0, isCool ? 'rgba(80,140,255,0.30)' : 'rgba(255,170,60,0.55)')
              g.addColorStop(0.6, isCool ? 'rgba(80,140,255,0.12)' : 'rgba(255,120,30,0.22)')
              g.addColorStop(1, 'rgba(0,0,0,0)')
            }
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(cx, cy, fr * 2.1, 0, Math.PI * 2)
            ctx.fill()

            ctx.strokeStyle = sensor === 'uv' ? 'rgba(0, 240, 255, 0.9)' : isCool ? 'rgba(120,170,255,0.7)' : 'rgba(255,190,90,0.7)'
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(cx, cy, fr, 0, Math.PI * 2)
            ctx.stroke()
          }
        }

        // Droplet fuel core
        ctx.fillStyle = f.regime === 4 ? 'rgba(120,120,120,0.6)' : ink
        ctx.beginPath()
        ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // Solid spread front
        const slabW = Math.min(240, maxRadius * 2)
        const x0 = cx - slabW / 2
        const pos = Math.min(1, (f.frontPosCm ?? 0) / 30)
        ctx.strokeStyle = ink
        ctx.globalAlpha = 0.4
        ctx.strokeRect(x0, cy - 6, slabW, 12)
        ctx.fillStyle = ink
        ctx.fillRect(x0, cy - 6, slabW * pos, 12)
        const fx = x0 + slabW * pos
        if (f.regime === 1) {
          const inten = Math.min(1, f.intensity ?? 0.5)
          const g = ctx.createRadialGradient(fx, cy, 2, fx, cy, 38)
          g.addColorStop(0, sensor === 'uv' ? 'rgba(0, 240, 255, 0.8)' : `rgba(255,180,70,${0.75 * inten})`)
          g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(fx, cy, 38, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // Helper to draw Earth 1g Buoyant Teardrop Flame
    const drawEarth1gFlame = (cx: number, cy: number) => {
      const d = 16
      const baseFlameH = 75
      const flicker = Math.sin(f.tSec * 16) * 4

      // Rising Buoyant Soot Column
      const plumeG = ctx.createLinearGradient(cx, cy, cx, cy - 110)
      plumeG.addColorStop(0, 'rgba(255, 120, 20, 0.25)')
      plumeG.addColorStop(0.5, 'rgba(100, 100, 100, 0.15)')
      plumeG.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = plumeG
      ctx.fillRect(cx - 8, cy - 110, 16, 110)

      // Classic Teardrop Shape
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(cx - d, cy + 2)
      ctx.quadraticCurveTo(cx - d * 0.8, cy - baseFlameH * 0.5, cx, cy - baseFlameH - flicker)
      ctx.quadraticCurveTo(cx + d * 0.8, cy - baseFlameH * 0.5, cx + d, cy + 2)
      ctx.closePath()

      const flameG = ctx.createLinearGradient(cx, cy + 2, cx, cy - baseFlameH)
      flameG.addColorStop(0, 'rgba(255, 230, 120, 0.85)')
      flameG.addColorStop(0.4, 'rgba(255, 120, 20, 0.75)')
      flameG.addColorStop(0.9, 'rgba(220, 40, 10, 0.4)')
      flameG.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = flameG
      ctx.fill()

      // Inner Blue Reaction Zone at Base
      ctx.beginPath()
      ctx.arc(cx, cy + 2, d * 0.7, 0, Math.PI)
      ctx.fillStyle = 'rgba(60, 140, 255, 0.65)'
      ctx.fill()

      // Fuel source
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.arc(cx, cy + 5, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    if (split) {
      // Split-screen: Left is Earth 1g, Right is µg
      const dividerX = cw / 2

      // Divider line
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(dividerX, 20)
      ctx.lineTo(dividerX, ch - 20)
      ctx.stroke()
      ctx.setLineDash([])

      // Left: Earth 1g
      ctx.font = '11px monospace'
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.7
      ctx.textAlign = 'center'
      ctx.fillText('EARTH 1G (BUOYANT CONVECTION)', dividerX / 2, 28)
      ctx.fillText('Peak T ≈ 1950 K · Buoyancy Plume Active', dividerX / 2, ch - 16)
      drawEarth1gFlame(dividerX / 2, ch / 2 + 25)

      // Right: Microgravity µg
      ctx.fillText('FLIGHT µG (DIFFUSIVE SPHERE)', dividerX + dividerX / 2, 28)
      ctx.fillText(
        isCool ? 'Cool-Flame Active · Sub-optical ~720 K' : 'Isotropic Flame Shell · No Chimney',
        dividerX + dividerX / 2,
        ch - 16,
      )
      drawMicrogravityFlame(dividerX + dividerX / 2, ch / 2, dividerX / 2 - 20)
    } else {
      // Single view (µg)
      drawMicrogravityFlame(cw / 2, ch / 2, cw / 2 - 40)
    }

    ctx.restore()
  }

  // React-driven repaints: the ~10 Hz frame slice for the readout and
  // the view toggles — the 30 Hz stream itself paints via paint()
  useEffect(() => {
    frameRef.current = frame
    statusRef.current = status
    viewRef.current = { split: splitScreen, sensor: sensorMode }
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, status, splitScreen, sensorMode])

  const regime = frame
    ? frame.model === 'droplet'
      ? REGIME[frame.regime] ?? '?'
      : SPREAD_REGIME[frame.regime] ?? '?'
    : '—'

  const invLabel = CHAMBER_INVESTIGATIONS.find((i) => i.id === inv)?.label ?? inv
  const isCoolFlame = frame?.coolFlame || (frame?.model === 'droplet' && frame?.regime === 2)

  // bare: the embedding surface owns all chrome — we render the stream only
  if (bare) {
    return <canvas ref={canvasRef} className="block h-64 w-full rounded-xl sm:h-72 bg-black/20" />
  }

  return (
    <section id="chamber" className={`relative scroll-mt-24 ${stage ? '' : 'px-6 pb-28 pt-6 sm:px-10 lg:px-16'}`}>
      {/* Top telemetry bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-xs lowercase tracking-label text-ink opacity-70">
        <span>live chamber — compiled c++20 core (xorshift-seeded)</span>
        <div className="flex items-center gap-4">
          <span>{status === 'offline' ? 'engine offline' : `ws · 30 hz · ${status}`}</span>
          <button
            type="button"
            onClick={run}
            className="rounded border border-edge bg-white/10 px-2 py-1 text-mini font-semibold hover:bg-white/20"
          >
            re-fire
          </button>
        </div>
      </div>

      {!stage && (
        <>
          <h2 className="m-0 mt-4 font-display text-[clamp(1.6rem,3.2vw,2.6rem)] font-bold leading-display tracking-tight text-ink">
            The engine, running.
          </h2>
          <p className="m-0 mt-2 max-w-3xl text-caption lowercase leading-relaxed text-ink opacity-75">
            compiled c++ physics streamed frame by frame — seal the cabin to watch the flame consume its own oxygen and die on the loc boundary.
          </p>
        </>
      )}

      {/* COOL FLAME TELEMETRY ALERT BANNER */}
      {isCoolFlame && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/15 p-4 text-amber-300 shadow-lg backdrop-blur-xl animate-pulse"
        >
          <span className="text-xl">⚠</span>
          <div className="text-xs leading-relaxed">
            <strong className="font-mono uppercase font-bold tracking-label">
              Anomaly Detected: Radiative Quenching — Cool Flame Active
            </strong>
            <p className="mt-1 font-mono text-mini opacity-90">
              Visible emission: 0%. Droplet consumption continues via low-temperature kinetics (T ≈ 720 K).
              Extreme risk of sudden explosive re-ignition upon forced airflow resumption.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6">
        {/* Controls HUD: Split-Screen & Sensor Mode */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-edge bg-black/10 px-4 py-2 backdrop-blur-lg">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-micro opacity-60">View Mode:</span>
            <button
              type="button"
              onClick={() => setSplitScreen(false)}
              className={`rounded-full px-3 py-1 font-mono text-xs font-semibold transition ${
                !splitScreen
                  ? 'bg-accent text-black'
                  : 'bg-white/10 text-ink hover:bg-white/20'
              }`}
            >
              Flight µg
            </button>
            <button
              type="button"
              onClick={() => setSplitScreen(true)}
              className={`rounded-full px-3 py-1 font-mono text-xs font-semibold transition ${
                splitScreen
                  ? 'bg-accent text-black'
                  : 'bg-white/10 text-ink hover:bg-white/20'
              }`}
            >
              Split-Screen (Earth 1g vs µg)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-micro opacity-60">Sensor:</span>
            <button
              type="button"
              onClick={() => setSensorMode('visible')}
              className={`rounded-full px-3 py-1 font-mono text-xs font-semibold transition ${
                sensorMode === 'visible'
                  ? 'bg-amber-400 text-black'
                  : 'bg-white/10 text-ink hover:bg-white/20'
              }`}
            >
              Visible Spectrum (Eye)
            </button>
            <button
              type="button"
              onClick={() => setSensorMode('uv')}
              className={`rounded-full px-3 py-1 font-mono text-xs font-semibold transition ${
                sensorMode === 'uv'
                  ? 'bg-cyan-400 text-black'
                  : 'bg-white/10 text-ink hover:bg-white/20'
              }`}
            >
              UV / Radiometric (310nm OH*)
            </button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNasaVideo(!showNasaVideo)}
              className="!text-xs"
            >
              <IconVideo size={13} /> {showNasaVideo ? 'Hide UV Video' : 'NASA UV Video'}
            </Button>
          </div>
        </div>

        {/* Embedded NASA Video PIP if toggled */}
        {showNasaVideo && (
          <div className="relative mb-4 overflow-hidden rounded-2xl border border-cyan-500/40 bg-black p-2">
            <div className="flex items-center justify-between px-2 py-1 text-xs font-mono text-cyan-400">
              <span>NASA SAFFIRE-V FLIGHT FOOTAGE (UV CHEMILUMINESCENCE)</span>
              <button onClick={() => setShowNasaVideo(false)} className="opacity-70 hover:opacity-100">✕</button>
            </div>
            <video
              src="/assets/saffire5_uv.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="h-44 w-full rounded-xl object-contain bg-black"
            />
          </div>
        )}

        {stage && (
          <div className="mb-4 font-mono text-sm lowercase tracking-micro text-ink opacity-85">
            <span className="text-accent">▸</span> {invLabel} · o₂ {o2}%
            {flow != null ? ` · ${flow} cm/s` : ''}
            {sealed ? ' · sealed cabin' : ''}
          </div>
        )}

        {stage && children}

        <canvas ref={canvasRef} className="h-72 w-full rounded-3xl sm:h-80 bg-black/20" />

        {frame && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 font-mono text-sm lowercase text-ink opacity-85">
            <span>t {frame.tSec.toFixed(1)}s</span>
            <span className="font-semibold text-accent">{regime}</span>
            <span>o₂ {frame.o2Pct.toFixed(1)}%</span>
            {sealed && <span>o₂eff {frame.o2EffPct.toFixed(1)}%</span>}
            {frame.heatReleaseW != null && <span>{frame.heatReleaseW.toFixed(2)} w</span>}
            {frame.spreadRateCms != null && <span>{frame.spreadRateCms.toFixed(2)} cm/s</span>}
            {frame.flameRMm != null && <span>r {frame.flameRMm.toFixed(1)} mm</span>}
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-2 font-mono text-micro lowercase tracking-card text-ink opacity-60">
            {log.map((e, i) => (
              <span key={i} className="mr-4">
                → {e}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
