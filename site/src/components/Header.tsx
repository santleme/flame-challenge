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

const NAV: { label: string; href: string; className?: string }[] = [
  { label: 'vision', href: '#vision', className: 'max-lg:hidden' },
  { label: 'simulations', href: '#simulations', className: 'max-[520px]:hidden' },
  { label: 'dashboard', href: '#dashboard', className: 'max-[700px]:hidden' },
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

  const go = useCallback((href: string) => {
    navigate(href)
  }, [])

  return (
    <header className="fixed inset-x-0 top-0 z-20 px-3 py-4 sm:px-8 sm:py-6">
      <div className="relative mx-auto flex w-fit max-w-full items-center justify-center gap-3 px-3.5 py-2.5 sm:gap-7 sm:px-7 sm:py-3.5">
        <span
          ref={glassRef}
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-white/70 bg-[color-mix(in_srgb,#ffffff_78%,transparent)] shadow-[0_18px_50px_-16px_rgba(23,33,43,0.34),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl backdrop-saturate-200 will-change-transform dark:border-white/25 dark:bg-[#0d1524ed] dark:shadow-[0_18px_52px_-16px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.22)]"
        />

        <nav className="relative flex items-center gap-1 sm:gap-1.5" aria-label="Primary">
          {NAV.map((item, i) => (
            <Fragment key={item.label}>
              <a
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  go(item.href)
                }}
                className={`nav-glass-link group relative inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3.5 font-mono text-[clamp(14px,1.15vw,16px)] font-semibold lowercase tracking-[0.06em] text-[var(--ink)] transition-[background,box-shadow,transform,color] duration-300 hover:-translate-y-px ${item.className ?? ''}`}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 bottom-1 h-px origin-left scale-x-0 bg-current transition-transform duration-300 group-hover:scale-x-100"
                />
              </a>
              {i === NAV.length - 1 && (
                <a
                  ref={brandRef}
                  data-ignis-brand
                  href="#top"
                  onClick={(e) => {
                    e.preventDefault()
                    go('#top')
                  }}
                  aria-label="IGNIS — back to top"
                  className="relative pb-1 font-[family-name:var(--font-display)] text-[clamp(14px,1.9vw,20px)] font-bold leading-none tracking-[-0.03em] text-[var(--ink)] opacity-0"
                >
                  IGNIS
                </a>
              )}
            </Fragment>
          ))}
        </nav>

        <div className="relative flex items-center gap-3 sm:gap-6">
          <span
            className="group/loc hidden cursor-default items-center gap-2 rounded-full border border-transparent px-3 py-1.5 font-mono text-[13px] lowercase tracking-[0.18em] text-[var(--ink)] opacity-60 transition-[background,border-color,box-shadow,opacity,transform] duration-300 hover:-translate-y-px hover:border-white/60 hover:bg-white/70 hover:opacity-100 hover:shadow-[0_6px_18px_rgba(23,33,43,0.10)] xl:inline-flex dark:hover:border-white/25 dark:hover:bg-white/10 dark:hover:shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
            title="são paulo, brazil — utc-3"
          >
            <span
              aria-hidden="true"
              className="loc-dot size-1.5 shrink-0 rounded-full bg-[var(--accent)] transition-transform duration-300 group-hover/loc:scale-125"
            />
            são paulo, brazil
          </span>
          <span
            className="hidden font-mono text-[13px] lowercase tracking-[0.18em] text-[var(--ink)] opacity-60 sm:inline"
            aria-label="current time in são paulo, utc-3"
          >
            {clock.split(':').map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="clock-blink">:</span>}
                {part}
              </Fragment>
            ))}
            <span className="opacity-60"> utc-3</span>
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
