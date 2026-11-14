import { useCallback, useEffect, useState } from 'react'
import Header from './components/Header'
import Hero from './components/Hero'
import { initScroll } from './lib/scroll'

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
  }, [])

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    [],
  )

  return (
    <main>
      <Header dark={theme === 'dark'} onToggleTheme={toggleTheme} />
      <Hero />
      <footer className="border-t border-[var(--edge)] py-8 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-mist">
        NASA Space Apps Challenge 2026 · Flame in Freefall · data: psi.nasa.gov/physci/repo
      </footer>
    </main>
  )
}
