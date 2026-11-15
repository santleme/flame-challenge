import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import Challenge from './components/Challenge'
import Crew from './components/Crew'
import Footer from './components/Footer'
import Header from './components/Header'
import Hero from './components/Hero'
import Shipyard from './components/Shipyard'
import Stars from './components/Stars'

// overlay screens carry the heavy data tables — split them out of the
// hero path so the landing bundle stays small, then prefetch the chunks
// on idle so first navigation feels instant
const PsiDataset = lazy(() => import('./components/PsiDataset'))
const SimDeck = lazy(() => import('./components/SimDeck'))
const Dashboard = lazy(() => import('./components/Dashboard'))
import { getLenis, initScroll, isSimChild, scrollInner, scrollToSection } from './lib/scroll'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  try {
    return window.localStorage.getItem('ignis-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  // '#psi-dataset' and '#simulations' swap the whole
  // page for their own screens — the main scroll stays mounted
  // underneath so its position (and every ScrollTrigger) survives the
  // round trip
  const [view, setView] = useState<'main' | 'psi' | 'sim' | 'dashboard'>(() => {
    const h = location.hash.slice(1)
    if (h === 'psi-dataset') return 'psi'
    if (h === 'dashboard' || h.startsWith('dashboard-')) return 'dashboard'
    if (h === 'simulations' || isSimChild(h)) return 'sim'
    return 'main'
  })

  useEffect(() => {
    const sync = () => {
      const name = location.hash.slice(1)
      if (name === 'psi-dataset') {
        setView('psi')
        return
      }
      if (name === 'dashboard' || name.startsWith('dashboard-')) {
        setView('dashboard')
        return
      }
      if (name === 'simulations') {
        setView('sim')
        return
      }
      if (isSimChild(name)) {
        // a bare '#chamber'-style link — normalize onto the deck's hash
        // (replace, so back() doesn't bounce through the transient)
        // and land on the inner section
        history.replaceState(null, '', '#simulations')
        scrollInner(name)
        setView('sim')
        return
      }
      setView('main')
      // wait a beat so the overlay is gone before measuring scroll math
      if (name) setTimeout(() => scrollToSection(name), 60)
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    window.addEventListener('ignis:route', sync)
    if (location.hash && location.hash !== '#psi-dataset') sync()
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('ignis:route', sync)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : ''
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0e1116' : '#f4f3ee')
    try {
      window.localStorage.setItem('ignis-theme', theme)
    } catch {
      // theme still applies for the session when storage is blocked
    }
  }, [theme])

  useEffect(() => {
    initScroll()
    // warm the lazy overlay chunks once the landing is up — judges get
    // zero-spinner transitions without paying for the data tables upfront
    const prefetch = () => {
      // swallow failures — the lazy() import retries on navigation anyway,
      // so a dropped chunk only costs the judge one spinner, not a console
      // full of unhandled rejections
      void import('./components/PsiDataset').catch(() => {})
      void import('./components/SimDeck').catch(() => {})
      void import('./components/Dashboard').catch(() => {})
    }
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(prefetch, { timeout: 5000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(prefetch, 2500)
    return () => clearTimeout(id)
  }, [])

  // broadcast the active view so loops on the page underneath
  // (hero mesh, keyed flames, shipyard feed) can sleep while an
  // overlay screen covers them — they resume when it's dismissed
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('ignis:view', { detail: { view } }),
    )
  }, [view])

  // the overlay screens scroll inside their own fixed container —
  // freeze the page behind them so the root scrollbar doesn't render
  // a second track next to the overlay's own
  useEffect(() => {
    const overlay = view !== 'main'
    document.documentElement.classList.toggle('overlay-open', overlay)
    const l = getLenis()
    if (overlay) l?.stop()
    else l?.start()
    return () => {
      document.documentElement.classList.remove('overlay-open')
      l?.start()
    }
  }, [view])

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    [],
  )

  return (
    <main>
      <Header
        dark={theme === 'dark'}
        onToggleTheme={toggleTheme}
        brandVisible={view !== 'main'}
      />
      <Stars />
      <Hero />
      <Challenge />
      <Crew />
      <Shipyard />
      <Footer />
      <Suspense fallback={null}>
        {view === 'psi' && <PsiDataset />}
        {view === 'sim' && <SimDeck />}
        {view === 'dashboard' && <Dashboard />}
      </Suspense>
    </main>
  )
}
