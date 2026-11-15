import { useEffect, useRef } from 'react'
import { attachKeyedFlame } from '../lib/keyedFlame'

/** NASA combustion footage luminance-keyed to alpha — black pixels
 *  fall away and the flame floats behind the layout, the same
 *  treatment the hero and psi-dataset screens use. The clip is a prop:
 *  each screen burns different station footage (sofie-gel on the
 *  challenge page, saffire-vi on the psi screen, saffire-v's uv
 *  channel on the simulations deck). Renders absolutely positioned;
 *  the parent provides the mask/vignette via className on the
 *  wrapper. The pixel pipeline lives in lib/keyedFlame (WebGL luma-key,
 *  video-frame cadence); the loop window is discovered at runtime
 *  (the clip's container reports an odd duration, so we adapt instead
 *  of hardcoding). */
export default function KeyedFlame({
  className = '',
  strength = 0.75,
  src = { hd: '/assets/sofie_flame_hd.mp4', sd: '/assets/sofie_flame.mp4' },
  mask = '[mask-image:radial-gradient(ellipse_at_center,black_38%,transparent_74%)]',
}: {
  className?: string
  /** canvas alpha — dial it down when dense copy rides over the flame */
  strength?: number
  src?: { hd: string; sd: string }
  /** tailwind mask-image class on the canvas — override to soften the edges */
  mask?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loopEnd = useRef(Infinity)

  useEffect(() => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    return attachKeyedFlame(v, c)
  }, [])

  return (
    <>
      <video
        ref={videoRef}
        className="absolute h-px w-px opacity-0"
        autoPlay
        muted
        playsInline
        loop
        preload="metadata"
        aria-hidden="true"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = 0.5
          const d = e.currentTarget.duration
          loopEnd.current =
            Number.isFinite(d) && d > 1.5 ? d - 0.4 : Infinity
        }}
        onTimeUpdate={(e) => {
          if (e.currentTarget.currentTime >= loopEnd.current)
            e.currentTarget.currentTime = 0.5
        }}
      >
        <source src={src.hd} media="(min-width: 768px)" />
        <source src={src.sd} />
      </video>
      <div aria-hidden="true" className={`pointer-events-none absolute ${className}`}>
        <canvas
          ref={canvasRef}
          className={`block h-full w-full object-cover ${mask}`}
          style={{ opacity: strength }}
        />
        {/* readability veil — the flame stays ambient, never a wall of
            noise under the copy that rides over it */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-bg to-transparent" />
      </div>
    </>
  )
}
