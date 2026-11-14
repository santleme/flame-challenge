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

export { gsap, ScrollTrigger }
