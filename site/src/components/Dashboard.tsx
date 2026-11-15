import { navigate, navigateBack } from '../lib/scroll'
import Button from './ui/Button'
import { IconArrowLeft, IconArrowUpRight } from './Icons'

/** Mission Safety Dashboard — the route stays, but the report widgets
 *  were pulled out; what remains is a shell that points back at the
 *  live simulations deck. Mounted as an overlay by App on
 *  '#dashboard'. */
export default function Dashboard() {
  return (
    <div data-lenis-prevent className="fixed inset-0 z-10 overflow-y-auto overscroll-contain bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-28 sm:px-10 lg:px-16">
        <Button variant="glass" size="default" onClick={navigateBack}>
          <IconArrowLeft size={16} /> Back to Overview
        </Button>

        <div className="mt-12 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
              IGNIS · NASA PSI Flight Safety Intelligence
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-0.04em] sm:text-6xl">
              Mission Safety Dashboard
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 opacity-75 sm:text-lg">
              Flight certification briefs generated from 30 years of NASA microgravity combustion
              experiments and the C++20 physics core.
            </p>
          </div>
          <Button variant="primary" size="default" onClick={() => navigate('#simulations')}>
            Run Live Simulation <IconArrowUpRight size={16} />
          </Button>
        </div>

        <section className="mt-12 rounded-[28px] border border-dashed border-[var(--edge)] bg-[color-mix(in_srgb,var(--panel)_40%,transparent)] p-10 text-center backdrop-blur-xl sm:p-16">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--accent)]">empty</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-bold sm:text-3xl">
            No mission briefs on this dashboard
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 opacity-70 sm:text-base">
            The dashboard widgets were removed. Live combustion runs still stream in the
            simulations deck.
          </p>
        </section>
      </div>
    </div>
  )
}
