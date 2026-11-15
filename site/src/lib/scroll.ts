/** Lenis smooth-scroll + GSAP ScrollTrigger wiring (initialized once). */
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

let lenis: Lenis | null = null

export function initScroll(): Lenis {
  if (lenis) return lenis
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis!.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  return lenis
}

export function getLenis(): Lenis | null {
  return lenis
}

/** Friendly section names -> their DOM ids. */
const SECTION_IDS: Record<string, string> = {
  hero: 'top',
  dashboard: 'dashboard',
  shipyard: 'vision',
}

/** sections that live inside the #simulations deck */
const SIM_CHILDREN = new Set(['chamber'])

export function isSimChild(name: string): boolean {
  return SIM_CHILDREN.has(name)
}

let innerTarget: string | null = null

/** land on a section inside the sim deck — the event reaches it when
 *  already open; the stash survives mounting (StrictMode's simulated
 *  remount included) and is cleared only once the scroll lands */
export function scrollInner(name: string): void {
  innerTarget = name
  window.dispatchEvent(
    new CustomEvent('ignis:scroll-inner', { detail: { id: name } }),
  )
}

export function peekInnerTarget(): string | null {
  return innerTarget
}

export function clearInnerTarget(): void {
  innerTarget = null
}

/** smooth-scroll to a named section — Lenis when it's up, native
 *  scrollIntoView otherwise. Returns false for unknown names. */
export function scrollToSection(name: string): boolean {
  // the psi dataset and the simulations deck live on their own overlay
  // screens — "scrolling" to them opens the view instead
  if (name === 'psi-dataset') {
    navigate('#psi-dataset')
    return true
  }
  if (name === 'simulations') {
    navigate('#simulations')
    return true
  }
  if (name === 'dashboard') {
    navigate('#dashboard')
    return true
  }
  if (SIM_CHILDREN.has(name)) {
    navigate('#simulations')
    scrollInner(name)
    return true
  }
  const id = SECTION_IDS[name] ?? name
  const l = getLenis()
  if (id === 'top') {
    if (l) l.scrollTo(0)
    else window.scrollTo({ top: 0, behavior: 'smooth' })
    return true
  }
  const el = document.getElementById(id)
  if (!el) return false
  if (l) l.scrollTo(el, { offset: -96 })
  else el.scrollIntoView({ behavior: 'smooth' })
  return true
}

/** hash router — '#psi-dataset' opens the dataset screen, anything else
 *  lands back on the main page and scrolls there. pushState keeps the
 *  native anchor jump from fighting Lenis; 'ignis:route' + popstate are
 *  the two signals App syncs on. */
export function navigate(href: string): void {
  if (location.hash === href) {
    applyRoute()
    return
  }
  history.pushState(null, '', href)
  applyRoute()
}

export function applyRoute(): void {
  window.dispatchEvent(new CustomEvent('ignis:route'))
}

/** leave the psi screen — drop the hash without touching the main
 *  page's scroll position (the overlay is fixed; the page underneath
 *  never moved). */
export function navigateBack(): void {
  history.pushState(null, '', location.pathname + location.search)
  applyRoute()
}

/** Keep the dataset's selected theme across overlay open/close cycles. */
let filterTag: string | null = null

export function getFilterTag(): string | null {
  return filterTag
}

export function setFilterTag(tag: string | null): void {
  filterTag = tag
}

export { gsap, ScrollTrigger }
