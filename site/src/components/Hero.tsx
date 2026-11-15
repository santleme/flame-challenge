import { useEffect, useRef, useState } from 'react'
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
  const [shipOn, setShipOn] = useState(false)

  // typewriter — writes each letter as its own span so hover lift works
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.replaceChildren()
    setShipOn(false)
    const cursor = document.createElement('span')
    cursor.className = 'caret'
    cursor.setAttribute('aria-hidden', 'true')
    el.append(cursor)
    let i = 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const typeNext = () => {
      if (stopped) return
      if (i < TITLE.length) {
        const span = document.createElement('span')
        span.className =
          'inline-block transition duration-300 ease-out group-hover:-translate-y-2'
        span.textContent = TITLE[i++]
        el.insertBefore(span, cursor)
        if (i === TITLE.length) setShipOn(true)
        timer = setTimeout(typeNext, 320)
      } else {
        timer = setTimeout(() => cursor.remove(), 1200)
      }
    }
    timer = setTimeout(typeNext, 700)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
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
          // viewport-relative: '58% top' would measure 58% of the hero
          // trigger (~0.8 viewport scrolls) and never be reached
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
      className="relative isolate h-[130svh] cursor-crosshair"
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
        <div className="group pointer-events-auto relative mx-auto w-fit max-w-full cursor-default text-center">
          <div className="group/title relative">
            <h1
              id="ignis-title"
              ref={titleRef}
              aria-label={TITLE}
              className="m-0 font-display text-[clamp(4.5rem,13vw,10.5rem)] font-bold leading-none tracking-tighter"
            />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-10 mt-3 w-56 -translate-x-1/2 -translate-y-1 rounded-2xl border border-black/10 bg-white/90 px-4 py-3 text-left font-sans text-ink opacity-0 shadow-[0_10px_24px_-8px_rgba(23,33,43,0.28)] backdrop-blur-xl transition-[opacity,transform] duration-300 group-hover/title:translate-y-0 group-hover/title:opacity-100 dark:border-white/15 dark:bg-[#0e1116f2] dark:shadow-[0_10px_24px_-8px_rgba(255,255,255,0.16)]"
            >
              <span className="block font-display text-base font-bold leading-none">ignis</span>
              <span className="mt-1.5 block font-mono text-[10px] uppercase leading-none tracking-label opacity-50">noun · latin · product</span>
              <span className="mt-2.5 block font-mono text-caption font-normal leading-snug tracking-normal">
                Fire, made safe to study. Real NASA combustion data, turned into a ship you can build.
              </span>
            </span>
          </div>
          <span className="pointer-events-none absolute inset-0 text-[clamp(4.5rem,13vw,10.5rem)] leading-none max-md:hidden">
            <span
              className={`group/ship pointer-events-auto absolute left-[calc(100%-0.05em)] top-[-0.45em] block w-[0.8em] transition-opacity duration-700 ${shipOn ? 'opacity-100' : 'opacity-0'}`}
            >
              <span className="ship-float block">
                <span
                  role="img"
                  aria-label="Science patrol ship — hover to ignite its engines"
                  className="ship-sprite block"
                />
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-[20%] top-full z-10 mt-1 w-64 -translate-y-1 rounded-2xl border border-black/10 bg-white/90 px-4 py-3 text-left text-ink opacity-0 shadow-[0_10px_24px_-8px_rgba(23,33,43,0.28)] backdrop-blur-xl transition-[opacity,transform] duration-300 group-hover/ship:translate-y-0 group-hover/ship:opacity-100 dark:border-white/15 dark:bg-[#0e1116f2] dark:shadow-[0_10px_24px_-8px_rgba(255,255,255,0.16)]"
              >
                <span className="block font-display text-base font-bold leading-none">apollo 8</span>
                <span className="mt-1.5 block font-mono text-[10px] uppercase leading-none tracking-label opacity-50">quote · genesis · 1968</span>
                <span className="mt-2.5 block font-mono text-caption leading-snug">
                  “In the beginning God created the heaven and the earth.”
                </span>
                <span className="mt-2 block font-mono text-[11px] leading-snug opacity-60">
                  Read from lunar orbit on Christmas Eve, 1968.
                </span>
              </span>
            </span>
          </span>
        </div>
      </div>
    </section>
  )
}
