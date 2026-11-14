import { useEffect, useState } from 'react'
import {
  Atom,
  ChevronsRight,
  Coins,
  Cpu,
  Database,
  FastForward,
  HardHat,
  HeartPulse,
  Pause,
  Play,
  Rocket,
  Ship,
  Siren,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react'
import { BALANCE } from '../game/config'
import type { Engine } from '../game/engine'
import { engineOnline } from '../sim-bridge/physics'
import { useGameVersion } from '../state/store'
import type { Speed } from '../game/types'

function fmtTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const SPEEDS: { s: Speed; icon: typeof Play; label: string }[] = [
  { s: 0, icon: Pause, label: 'Pause' },
  { s: 1, icon: Play, label: '1×' },
  { s: 2, icon: FastForward, label: '2×' },
  { s: 4, icon: ChevronsRight, label: '4×' },
]

export default function TopBar({
  engine,
  onOpenMission,
  onOpenData,
  onOpenInsights,
}: {
  engine: Engine
  onOpenMission: () => void
  onOpenData: () => void
  onOpenInsights: () => void
}) {
  useGameVersion()
  const st = engine.state
  const alive = st.crew.filter((c) => c.state !== 'dead').length
  const safetyCol = st.safety > 60 ? 'text-ice' : st.safety > 30 ? 'text-ember' : 'text-red-400'
  const [physics, setPhysics] = useState(false)
  useEffect(() => {
    const t = setInterval(() => engineOnline().then(setPhysics), 20000)
    engineOnline().then(setPhysics)
    return () => clearInterval(t)
  }, [])

  return (
    <header className="pointer-events-auto flex items-center gap-3 border-b border-edge bg-panel/90 px-3 py-1.5 backdrop-blur">
      <div className="flex items-center gap-2 pr-2">
        <Rocket className="h-4 w-4 text-flame" />
        <span className="text-[13px] font-bold tracking-widest text-white">FREEFALL FOUNDRY</span>
      </div>
      <span className="font-mono text-[11px] text-mist">{fmtTime(st.time)}</span>

      <Stat icon={Coins} label="cr" value={Math.floor(st.credits)} tone="text-ember" />
      <Stat icon={Atom} label="sci" value={Math.floor(st.science)} tone="text-ice" />
      <Stat icon={Users} label="crew" value={`${alive}/${BALANCE.crewCap}`} tone="text-white" />
      <span className={`flex items-center gap-1 font-mono text-[11px] ${safetyCol}`} title="Safety rating — hits zero and the program is terminated">
        <HeartPulse className="h-3.5 w-3.5" />
        {Math.round(st.safety)}%
      </span>

      <div className="mx-1 flex min-w-40 flex-1 items-center gap-2" title="SSV hull completion — fabricate sections to launch">
        <Ship className="h-3.5 w-3.5 shrink-0 text-mist" />
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
          <div
            className="h-full rounded-full bg-gradient-to-r from-flame to-ember transition-all"
            style={{ width: `${Math.min(100, st.shipProgress)}%` }}
          />
        </div>
        <span className="font-mono text-[11px] text-mist">{Math.floor(st.shipProgress)}%</span>
      </div>

      <span className="font-mono text-[10px] text-mist" title="Next supply ship">
        resupply {Math.max(0, Math.ceil(st.supply.inSec))}s
      </span>
      <span
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
          physics ? 'bg-emerald-500/15 text-emerald-400' : 'bg-edge/60 text-mist'
        }`}
        title={physics ? 'Engine: C++20 physics core online' : 'backend offline — local model'}
      >
        <Cpu className="h-3 w-3" />
        {physics ? 'Engine: C++20' : 'local'}
      </span>

      <button
        onClick={onOpenData}
        title="NASA combustion master sheet — auditable records, inject into the yard"
        className="flex items-center gap-1 rounded border border-ice/50 bg-panel2 px-2 py-1 text-[10px] font-semibold text-ice hover:bg-ice/20"
      >
        <Database className="h-3 w-3" />
        Data
      </button>

      <button
        onClick={onOpenInsights}
        title="PSI Insights — ranked investigations, risk curves and interpreted findings"
        className="flex items-center gap-1 rounded border border-flame/50 bg-panel2 px-2 py-1 text-[10px] font-semibold text-flame hover:bg-flame/20"
      >
        <TrendingUp className="h-3 w-3" />
        Insights
      </button>

      <button
        onClick={onOpenMission}
        title="Mission Control — NASA incident replays & spin-off tech"
        className="flex items-center gap-1 rounded border border-ember/50 bg-panel2 px-2 py-1 text-[10px] font-semibold text-ember hover:bg-ember/20"
      >
        <Siren className="h-3 w-3" />
        Mission
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={() => engine.hire('engineer')}
          title={`Hire engineer — ${BALANCE.hireCost.engineer} cr`}
          className="flex items-center gap-1 rounded border border-edge bg-panel2 px-1.5 py-1 text-[10px] text-ember hover:border-ember"
        >
          <UserPlus className="h-3 w-3" />
          <HardHat className="h-3 w-3" />
        </button>
        <button
          onClick={() => engine.hire('scientist')}
          title={`Hire scientist — ${BALANCE.hireCost.scientist} cr`}
          className="flex items-center gap-1 rounded border border-edge bg-panel2 px-1.5 py-1 text-[10px] text-ice hover:border-ice"
        >
          <UserPlus className="h-3 w-3" />
          <Atom className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-0.5 rounded border border-edge bg-panel2 p-0.5">
        {SPEEDS.map(({ s, icon: Icon, label }) => (
          <button
            key={s}
            onClick={() => engine.setSpeed(s)}
            title={`${label} [${s === 0 ? 'space' : s}]`}
            className={`rounded px-1.5 py-0.5 ${
              st.speed === s ? 'bg-flame text-white' : 'text-mist hover:text-white'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </header>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Coins
  label: string
  value: string | number
  tone: string
}) {
  return (
    <span className="flex items-center gap-1 font-mono text-[11px] text-mist">
      <Icon className={`h-3.5 w-3.5 ${tone}`} />
      <span className={tone}>{value}</span>
      <span className="text-[9px] uppercase">{label}</span>
    </span>
  )
}
