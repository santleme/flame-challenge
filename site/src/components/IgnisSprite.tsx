import { useEffect, useRef } from 'react'

const SHEET = '/assets/ignis-laptop-sprites-v2.png'
const FRAME_SIZE = 512

/** Preload image once in memory so state toggles don't cause flicker */
let cachedImage: HTMLImageElement | null = null
let preloadPromise: Promise<HTMLImageElement> | null = null

function getSheetImage(): Promise<HTMLImageElement> {
  if (cachedImage && cachedImage.complete && cachedImage.naturalWidth > 0) {
    return Promise.resolve(cachedImage)
  }
  if (!preloadPromise) {
    preloadPromise = new Promise((resolve) => {
      const img = new Image()
      img.src = SHEET
      img.onload = () => {
        cachedImage = img
        resolve(img)
      }
      img.onerror = () => {
        preloadPromise = null
        resolve(img)
      }
    })
  }
  return preloadPromise
}

// Preload immediately in browser environments
if (typeof window !== 'undefined') {
  void getSheetImage()
}

/** Draws the clean Ignis poses with rock-solid registration (zero zoom/jitter) */
export default function IgnisSprite({
  working = false,
  size = 256,
}: {
  working?: boolean
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    // Ensure internal resolution is exactly FRAME_SIZE x FRAME_SIZE without redundant resets
    if (canvas.width !== FRAME_SIZE) canvas.width = FRAME_SIZE
    if (canvas.height !== FRAME_SIZE) canvas.height = FRAME_SIZE

    let frame = 0
    let elapsed = 0
    let previous = 0
    let animation = 0
    let stopped = false

    // Frame 0: Idle pose (calm hands, no sparks, smile)
    // Frame 1 & 2: Active typing cycle (hands alternate on keyboard, typing sparks fly)
    const frames = working ? [1, 2] : [0]
    const frameDuration = 0.2 // 200ms per typing frame

    const draw = (img: HTMLImageElement, index: number) => {
      if (!img.complete || img.naturalWidth === 0) return
      context.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(
        img,
        index * FRAME_SIZE,
        0,
        FRAME_SIZE,
        FRAME_SIZE,
        0,
        0,
        FRAME_SIZE,
        FRAME_SIZE,
      )
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const onImageReady = (image: HTMLImageElement) => {
      if (stopped) return
      draw(image, frames[0])

      // If idle or reduced motion, no need to loop frames
      if (frames.length <= 1 || reducedMotion) return

      const tick = (now: number) => {
        if (stopped) return
        if (previous && !document.hidden) {
          elapsed += Math.max(0, Math.min((now - previous) / 1000, 0.12))
          if (elapsed >= frameDuration) {
            elapsed %= frameDuration
            frame = (frame + 1) % frames.length
            draw(image, frames[frame])
          }
        }
        previous = now
        animation = window.requestAnimationFrame(tick)
      }

      animation = window.requestAnimationFrame(tick)
    }

    // Synchronous paint if image is already cached — prevents single-frame blanking
    if (cachedImage && cachedImage.complete && cachedImage.naturalWidth > 0) {
      onImageReady(cachedImage)
    } else {
      void getSheetImage().then(onImageReady)
    }

    return () => {
      stopped = true
      if (animation) {
        window.cancelAnimationFrame(animation)
      }
    }
  }, [working])

  return (
    <canvas
      ref={canvasRef}
      width={FRAME_SIZE}
      height={FRAME_SIZE}
      aria-label={working ? 'Ignis is working at a laptop' : 'Ignis at a laptop'}
      role="img"
      className="shrink-0 aspect-square select-none pointer-events-none"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        maxWidth: '100%',
        maxHeight: '100%',
      }}
    />
  )
}
