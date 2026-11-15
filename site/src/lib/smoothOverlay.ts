/** Wheel smoothing for the fixed overlay screens, which scroll natively
 *  (the page-level Lenis is stopped while one is open). Same easing as
 *  initScroll — lerp 0.11, wheel 0.95 — driven by rAF, frame-rate
 *  independent. Touch, keyboard and scrollbar drags stay native; reduced
 *  motion keeps plain scrolling. */
export function attachSmoothScroll(el: HTMLElement, lerp = 0.11, wheel = 0.95): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}
  let pos = el.scrollTop
  let target = pos
  let raf = 0
  let last = 0
  const limit = () => el.scrollHeight - el.clientHeight

  const step = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    pos += (target - pos) * (1 - Math.pow(1 - lerp, dt * 60))
    if (Math.abs(target - pos) < 0.5) {
      pos = target
      el.scrollTop = pos
      raf = 0
      return
    }
    el.scrollTop = pos
    raf = requestAnimationFrame(step)
  }

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.defaultPrevented) return
    e.preventDefault()
    if (!raf) pos = target = el.scrollTop
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
    target = Math.min(limit(), Math.max(0, target + e.deltaY * unit * wheel))
    if (!raf) {
      last = performance.now()
      raf = requestAnimationFrame(step)
    }
  }

  // a scrollbar drag / keyboard jump mid-glide wins over the animation
  const onScroll = () => {
    if (raf && Math.abs(el.scrollTop - pos) > 3) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    cancelAnimationFrame(raf)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('scroll', onScroll)
  }
}
