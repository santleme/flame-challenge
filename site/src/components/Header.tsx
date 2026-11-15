import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { gsap, navigate, ScrollTrigger } from '../lib/scroll'
import Button from './ui/Button'
import { IconMoon, IconSun } from './Icons'

interface Props {
  dark: boolean
  onToggleTheme: () => void
  /** overlay screens (psi dataset, simulations) pin the brand visible —
   *  it's the way back home from a deck, and the main-page scroll scrub
   *  that normally reveals it is frozen underneath the overlay */
  brandVisible?: boolean
}

const LEFT = [
  { label: 'simulations', href: '#simulations', className: 'max-[520px]:hidden' },
  { label: 'dashboard', href: '#dashboard', className: 'max-[700px]:hidden' },
]
const RIGHT = [
  { label: 'vision', href: '#vision', className: 'max-lg:hidden' },
  { label: 'psi-dataset', href: '#psi-dataset', className: 'max-[640px]:hidden' },
]


/** Floating glass header — bare monospace text over the hero, then a
 *  blurred, glowing pill materializes behind the nav as you scroll. */
const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** Floating glass header — bare monospace text over the hero, then a
 *  blurred, glowing pill materializes behind the nav as you scroll. */
export default function Header({ dark, onToggleTheme, brandVisible = false }: Props) {
  const glassRef = useRef<HTMLSpanElement>(null)
  const brandRef = useRef<HTMLAnchorElement>(null)
  const [clock, setClock] = useState(() => clockFmt.format(new Date()))

  useEffect(() => {
    const id = setInterval(() => setClock(clockFmt.format(new Date())), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const glass = glassRef.current
    const brand = brandRef.current
    if (!glass || !brand) return
    const ctx = gsap.context(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.set(glass, { opacity: 1, scaleX: 1, y: 0 })
        ScrollTrigger.create({
          trigger: '#top',
          start: 'top top',
          end: () => window.innerHeight * 0.58,
          onUpdate: (self) => gsap.set(brand, { opacity: self.progress }),
        })
        return
      }
      const scrub = {
        trigger: '#top',
        start: 'top top',
        end: () => window.innerHeight * 0.58,
        scrub: true,
      } as const
      gsap.fromTo(
        glass,
        { opacity: 0, scaleX: 0.55, y: -6 },
        { opacity: 1, scaleX: 1, y: 0, ease: 'none', scrollTrigger: scrub },
      )
      gsap.fromTo(
        brand,
        { opacity: 0 },
        { opacity: 1, ease: 'none', scrollTrigger: scrub },
      )
    })
    return () => ctx.revert()
  }, [])

  // overlays pin the brand; returning to the main page re-syncs it to
  // wherever the scroll scrub would have left it (hidden at the hero
  // top, solid once you've scrolled)
  useEffect(() => {
    const brand = brandRef.current
    const glass = glassRef.current
    if (!brand || !glass) return
    const reveal = brandVisible
      ? 1
      : Math.min(1, window.scrollY / (window.innerHeight * 0.58))
    gsap.set(glass, { opacity: reveal, scaleX: 1, y: 0 })
    gsap.set(brand, {
      opacity: reveal,
    })
  }, [brandVisible])

  const [hidden, setHidden] = useState(false)
  const [docked, setDocked] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const last = new WeakMap<EventTarget, number>()
    const onScroll = (e: Event) => {
      const t = e.target
      const el = t instanceof Element ? t : document.scrollingElement
      if (!t || !el) return
      const y = t instanceof Element ? el.scrollTop : window.scrollY
      const prev = last.get(t) ?? y
      last.set(t, y)
      if (!(t instanceof Element)) setDocked(y > window.innerHeight * 0.58)
      const safe = t instanceof Element ? 80 : window.innerHeight * 1.15
      if (y < safe || y < prev - 2) setHidden(false)
      else if (y > prev + 2 && !headerRef.current?.querySelector(":focus-visible")) setHidden(true)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  useEffect(() => {
    if (brandVisible) setHidden(false)
  }, [brandVisible])

  useEffect(() => {
    setDocked(brandVisible || window.scrollY > window.innerHeight * 0.58)
  }, [brandVisible])

  const go = useCallback((href: string) => {
    navigate(href)
  }, [])

  const navLink = (item: { label: string; href: string; className?: string }) => (
    <a
      key={item.label}
      href={item.href}
      onClick={(e) => {
        e.preventDefault()
        go(item.href)
      }}
      className={`nav-glass-link group relative inline-flex min-h-8 items-center whitespace-nowrap rounded-full px-3 font-mono text-[clamp(13px,1.05vw,15px)] font-semibold lowercase tracking-micro text-ink transition-[background,box-shadow,transform,color] duration-300 hover:-translate-y-px ${item.className ?? ''}`}
    >
      {item.label}
      <span
        aria-hidden="true"
        className="absolute inset-x-3 bottom-0.5 h-px origin-left scale-x-0 bg-current transition-transform duration-300 group-hover:scale-x-100"
      />
    </a>
  )

  return (
    <header
      ref={headerRef}
      onFocusCapture={() => setHidden(false)}
      className={`fixed inset-x-0 top-0 z-20 px-3 py-3 transition-[transform,opacity,filter] ease-out sm:px-8 sm:py-4 ${hidden ? 'pointer-events-none -translate-y-3 opacity-0 blur-[3px] duration-500' : 'duration-400'}`}
    >
      <div className="relative mx-auto flex w-fit max-w-full items-center justify-center gap-3 px-3 py-1 sm:gap-5 sm:px-4 sm:py-1.5">
        <span
          ref={glassRef}
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-white/70 bg-[color-mix(in_srgb,#ffffff_78%,transparent)] shadow-[0_10px_24px_-8px_rgba(23,33,43,0.28),0_3px_8px_-2px_rgba(23,33,43,0.14),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl backdrop-saturate-200 will-change-transform dark:border-white/15 dark:bg-[#0e1116f2] dark:shadow-[0_10px_24px_-8px_rgba(255,255,255,0.16),0_3px_8px_-2px_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(255,255,255,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]"
        />

        <nav className="relative flex items-center gap-1 sm:gap-1.5" aria-label="Primary">
          {LEFT.map(navLink)}
        </nav>

        <span className={`group/brand relative flex items-center ${docked ? '' : 'pointer-events-none'}`}>
          <a
            ref={brandRef}
            data-ignis-brand
            href="#top"
            onClick={(e) => {
              e.preventDefault()
              go('#top')
            }}
            aria-label="IGNIS — back to top"
            className="relative isolate pb-1 font-display text-[clamp(14px,1.9vw,20px)] font-bold leading-none tracking-tight text-ink"
          >
            <span
              aria-hidden="true"
              className="absolute -inset-x-1.5 bottom-[3px] -z-10 h-[62%] origin-left -rotate-[1.5deg] scale-x-0 rounded-[3px_6px_4px_7px] bg-accent/50 transition-transform duration-500 ease-out group-hover/brand:scale-x-100 dark:bg-accent/40"
            />
            IGNIS
          </a>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-full z-10 mt-4 w-56 -translate-x-1/2 -translate-y-1 rounded-2xl border border-black/10 bg-white/90 px-4 py-3 text-left opacity-0 shadow-[0_10px_24px_-8px_rgba(23,33,43,0.28)] backdrop-blur-xl transition-[opacity,transform] duration-300 group-hover/brand:translate-y-0 group-hover/brand:opacity-100 dark:border-white/15 dark:bg-[#0e1116f2] dark:shadow-[0_10px_24px_-8px_rgba(255,255,255,0.16)]"
          >
            <span className="block font-display text-base font-bold leading-none text-ink">ignis</span>
            <span className="mt-1.5 block font-mono text-[10px] uppercase tracking-label text-ink opacity-50">noun · latin · product</span>
            <span className="mt-2.5 block font-mono text-caption leading-snug text-ink">
              Fire, made safe to study. Real NASA combustion data, turned into a ship you can build.
            </span>
          </span>
        </span>

        <nav className="relative flex items-center gap-1 sm:gap-1.5" aria-label="Secondary">
          {RIGHT.map(navLink)}
        </nav>

        <div className="relative flex items-center gap-2 sm:gap-4">
          <span
            className="group/loc hidden cursor-default items-center self-stretch gap-2 rounded-full border border-transparent px-2.5 py-1 font-mono text-tiny lowercase tracking-card text-ink opacity-60 transition-[background,border-color,box-shadow,opacity,transform] duration-300 hover:-translate-y-px hover:border-white/60 hover:bg-white/70 hover:opacity-100 hover:shadow-[0_6px_18px_rgba(23,33,43,0.10)] relative sm:inline-flex dark:hover:border-white/25 dark:hover:bg-white/10 dark:hover:shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
          >
            <span className="relative flex items-center gap-2 transition-transform duration-300 group-hover/loc:-translate-y-[8px]">
              <span
                aria-hidden="true"
                className="loc-dot size-1.5 shrink-0 rounded-full bg-accent transition-transform duration-300 group-hover/loc:scale-125"
              />
              são paulo, brazil
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-current transition-transform duration-300 group-hover/loc:scale-x-100"
              />
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-1/2 mt-[6px] -translate-x-1/2 translate-y-1 whitespace-nowrap font-mono text-[11px] leading-none text-ink opacity-0 transition-[opacity,transform] duration-300 group-hover/loc:translate-y-0 group-hover/loc:opacity-100"
            >
              {clock.split(':').map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="clock-blink">:</span>}
                  {part}
                </Fragment>
              ))}
              <span className="opacity-60"> utc-3</span>
            </span>
          </span>
          <Button
            type="button"
            onClick={onToggleTheme}
            aria-pressed={dark}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            variant="glass"
            size="sm"
            className="header-theme-toggle lowercase"
          >
            {dark ? <IconMoon size={16} /> : <IconSun size={16} />}
            {dark ? 'dark' : 'light'}
          </Button>
        </div>
      </div>
    </header>
  )
}
