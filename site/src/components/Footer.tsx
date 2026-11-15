import { useCallback } from 'react'
import { navigate } from '../lib/scroll'

const LINKS = [
  { label: 'challenge', href: '#challenge' },
  { label: 'simulations', href: '#simulations' },
  { label: 'dashboard', href: '#dashboard' },
  { label: 'psi-dataset', href: '#psi-dataset' },
  { label: 'crew', href: '#crew' },
  { label: 'vision', href: '#vision' },
  { label: 'back to top', href: '#top' },
]

const SOURCES = [
  { label: 'psi.nasa.gov/physci/repo', href: 'https://psi.nasa.gov/physci/repo' },
  { label: 'ntrs.nasa.gov', href: 'https://ntrs.nasa.gov' },
  { label: 'images.nasa.gov', href: 'https://images.nasa.gov' },
]

/** Footer — NASA Earth-at-night backdrop fading into the page bg,
 *  brand + tagline, nav and data-source columns, credit bar. */
export default function Footer() {
  const go = useCallback((href: string) => {
    navigate(href)
  }, [])

  return (
    <footer className="relative isolate overflow-hidden bg-[#05070d]">
      <img
        src="/assets/footer_earth_night.jpg"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-[var(--bg)] via-transparent to-transparent"
      />
      <img
        src="/assets/space/ship_vessel.png"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="ship-drift pointer-events-none absolute right-[6%] top-20 z-0 w-40 opacity-90 [filter:drop-shadow(0_0_18px_#49b8d680)] [image-rendering:pixelated] sm:bottom-12 sm:left-[7%] sm:right-auto sm:top-auto sm:w-48 lg:left-[10%] lg:w-56"
      />

      <div className="relative z-10 mx-auto w-[min(1400px,94%)] pb-10 pt-28 sm:pt-36">
        <div className="grid gap-12 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="m-0 font-[family-name:var(--font-display)] text-3xl font-bold leading-none tracking-[-0.03em] text-[#edf4fa] sm:text-4xl">
              IGNIS
            </p>
            <p className="mt-4 max-w-[36ch] font-mono text-[11px] lowercase leading-relaxed tracking-[0.08em] text-[#edf4fa99]">
              fire-safety insight for crewed spacecraft — microgravity
              combustion physics driven by real nasa psi experiment data.
              cabins &amp; habitats, not propulsion.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-col items-start gap-2.5">
            <span className="mb-1 font-mono text-[9px] uppercase tracking-[0.28em] text-[#edf4fa66]">
              navigate
            </span>
            {LINKS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  go(item.href)
                }}
                className="font-mono text-[11px] lowercase tracking-[0.18em] text-[#edf4fab3] transition-colors hover:text-[#edf4fa]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex flex-col items-start gap-2.5">
            <span className="mb-1 font-mono text-[9px] uppercase tracking-[0.28em] text-[#edf4fa66]">
              data & sources
            </span>
            {SOURCES.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] lowercase tracking-[0.18em] text-[#edf4fab3] transition-colors hover:text-[#edf4fa]"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-[#edf4fa73] sm:flex-row sm:items-center sm:justify-between">
          <span>nasa space apps challenge 2026 · flame in freefall</span>
          <span>photo iss035e017673 · nasa image & video library</span>
        </div>
      </div>
    </footer>
  )
}
