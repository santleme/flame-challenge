import { useEffect, useRef } from 'react'
import { gsap, ScrollTrigger } from '../lib/scroll'
import HeroCanvas from './HeroCanvas'

const TITLE = 'IGNIS'

/** Hero — typewriter title in Space Mono, per-letter hover lift,
 *  expanding rule with technical end-tags, mesh backdrop, GSAP scroll
 *  choreography (lift → scale → fade as the hero leaves view). */
export default function Hero() {
  const heroRef = useRef<HTMLElement>(null)
  const identityRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // typewriter — writes each letter as its own span so hover lift works
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.replaceChildren()
    const cursor = document.createElement('span')
    cursor.className = 'caret'
    cursor.setAttribute('aria-hidden', 'true')
    el.append(cursor)
    let i = 0
    let timer: ReturnType<typeof setTimeout>
    const typeNext = () => {
      if (i < TITLE.length) {
        const span = document.createElement('span')
        span.className =
          'inline-block transition duration-300 ease-out group-hover:-translate-y-2'
        span.textContent = TITLE[i++]
        el.insertBefore(span, cursor)
        timer = setTimeout(typeNext, 320)
      } else {
        timer = setTimeout(() => cursor.remove(), 1200)
      }
    }
    timer = setTimeout(typeNext, 700)
    return () => clearTimeout(timer)
  }, [])

  // scroll choreography
  useEffect(() => {
    const hero = heroRef.current
    const identity = identityRef.current
    if (!hero || !identity) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // no motion — swap the fixed title for the header wordmark at the
      // choreography boundary, not on first scroll (the brand is still
      // nearly transparent earlier in the range)
      const st = ScrollTrigger.create({
        trigger: hero,
        start: 'top top',
        end: () => window.innerHeight * 0.58,
        onLeave: () => gsap.set(identity, { autoAlpha: 0 }),
        onEnterBack: () => gsap.set(identity, { autoAlpha: 1 }),
      })
      // pages loaded already scrolled past the boundary start hidden
      if (st.progress >= 1) gsap.set(identity, { autoAlpha: 0 })
      return () => st.kill()
    }
    // capture once — reading offsetHeight inside onUpdate forces layout per frame
    const ctx = gsap.context(() => {
      const brand = document.querySelector<HTMLElement>('[data-ignis-brand]')
      const title = titleRef.current
      // dock: the title flies to the brand slot in the header, not just up
      const dims = { dx: 0, lift: window.innerHeight * 0.43 - 45, scale: 0.15 }
      const measure = () => {
        if (!brand || !title) return
        const br = brand.getBoundingClientRect()
        dims.dx = br.left + br.width / 2 - window.innerWidth / 2
        dims.lift = window.innerHeight * 0.43 - (br.top + br.height / 2)
        dims.scale =
          parseFloat(getComputedStyle(brand).fontSize) /
          parseFloat(getComputedStyle(title).fontSize)
      }
      measure()
      const tween = { p: 0 }
      gsap.to(tween, {
        p: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: hero,
          start: 'top top',
          // viewport-relative: '58% top' would measure 58% of the 190svh
          // trigger (~1.1 viewport scrolls) and never be reached
          end: () => window.innerHeight * 0.58,
          scrub: true,
          onRefresh: measure,
        },
        onUpdate: () => {
          const dx = dims.dx * tween.p
          const lift = dims.lift * tween.p
          const scale = 1 + (dims.scale - 1) * tween.p
          identity.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% - ${lift}px)) scale(${scale})`
          identity.style.opacity = String(1 - Math.max(0, (tween.p - 0.88) / 0.12))
        },
      })
    })
    return () => ctx.revert()
  }, [])

  return (
    <section
      id="top"
      ref={heroRef}
      aria-labelledby="ignis-title"
      className="relative isolate h-[190svh] cursor-crosshair"
    >
      <div className="sticky top-0 h-[100svh] min-h-[680px] overflow-hidden">
        <HeroCanvas />
        <div className="hero-shade pointer-events-none absolute inset-0" aria-hidden="true" />
      </div>

      <div
        ref={identityRef}
        className="pointer-events-none fixed left-1/2 top-[43%] z-10 w-[min(78%,850px)] text-center will-change-transform"
        style={{ transform: 'translate(-50%, -50%)' }}
      >
        <div className="group pointer-events-auto mx-auto w-fit max-w-full cursor-default text-center">
          <h1
            id="ignis-title"
            ref={titleRef}
            aria-label={TITLE}
            className="m-0 font-[family-name:var(--font-display)] text-[clamp(4.5rem,13vw,10.5rem)] font-bold leading-none tracking-[-0.04em]"
          />
        </div>
      </div>
    </section>
  )
}
