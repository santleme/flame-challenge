import { Activity, FlaskConical, Flame, Hammer, HeartPulse, ShieldAlert, Wind, Wrench, X, Zap } from 'lucide-react'
import { BALANCE, ROOM_SPECS } from '../game/config'
import type { Engine } from '../game/engine'
import { invById } from '../game/engine'
import { useGameVersion } from '../state/store'
import type { Selection } from '../renderer/WorldView'
import { COUNTERMEASURE_PREVIEW, rectContains } from '../game/types'
import type { Countermeasure, CrewMember, Room } from '../game/types'

interface Props {
  engine: Engine
  selection: Selection | null
  onClose: () => void
  onRunExperiment: (roomId: number) => void
}

export default function InspectPanel({ engine, selection, onClose, onRunExperiment }: Props) {
  useGameVersion()
  const st = engine.state
  if (!selection) return null

  const room = selection.kind === 'room' ? st.rooms.find((r) => r.id === selection.id) : null
  const crew = selection.kind === 'crew' ? st.crew.find((c) => c.id === selection.id) : null
  if (!room && !crew) return null

  return (
    <div className="pointer-events-auto w-72 rounded border border-edge bg-panel/90 backdrop-blur">
      <div className="flex items-center justify-between border-b border-edge px-2.5 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white">
          {room ? room.label : `${crew!.name}`}
        </span>
        <button onClick={onClose} className="text-mist hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2 px-2.5 py-2 text-[11px]">
        {room && <RoomInfo engine={engine} room={room} onRunExperiment={onRunExperiment} />}
        {crew && <CrewInfo crew={crew} />}
      </div>
    </div>
  )
}

function Bar({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-mist">
        <span>{label}</span>
        <span className="font-mono">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-edge">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
}

function RoomInfo({
  engine,
  room,
  onRunExperiment,
}: {
  engine: Engine
  room: Room
  onRunExperiment: (id: number) => void
}) {
  const spec = ROOM_SPECS[room.type]
  return (
    <>
      <div className="flex items-center justify-between text-mist">
        <span>{spec.label}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
            room.state === 'active'
              ? 'bg-emerald-500/15 text-emerald-400'
              : room.state === 'damaged'
                ? 'bg-red-500/15 text-red-400'
                : 'bg-ember/15 text-ember'
          }`}
        >
          {room.state}
        </span>
      </div>
      {room.state === 'building' && <Bar label="construction" value={room.buildProgress * 100} cls="bg-ember" />}
      {room.damage > 0 && <Bar label="damage" value={room.damage * 100} cls="bg-red-500" />}

      {room.experiment && (
        <div className="rounded border border-ice/25 bg-ice/5 p-2">
          <div className="flex items-center gap-1 text-ice">
            <FlaskConical className="h-3 w-3" />
            <span className="font-semibold">{invById.get(room.experiment.investigationId)?.name}</span>
            <span className="ml-auto font-mono text-[10px]">{Math.round(room.experiment.progress * 100)}%</span>
          </div>
          <div className="mt-1 text-[10px] text-mist">
            O₂ {room.experiment.oxygenPct}% · flow {room.experiment.flowCms} cm/s · risk{' '}
            {room.experiment.riskPct}% · yield ~{room.experiment.scienceYield} sci
          </div>
        </div>
      )}

      {room.type === 'combustion' && room.state === 'active' && !room.experiment && (
        <button
          onClick={() => onRunExperiment(room.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-flame/80 py-1.5 text-[11px] font-semibold text-white hover:bg-flame"
        >
          <FlaskConical className="h-3.5 w-3.5" /> Run PSI experiment
        </button>
      )}

      {room.type === 'fab' && room.state === 'active' && (
        <button
          onClick={() => engine.startFabrication(room.id)}
          disabled={!!room.fabJob}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-[#6e5596] py-1.5 text-[11px] font-semibold text-white hover:bg-[#7e65a8] disabled:opacity-50"
          title={`Costs ${BALANCE.fabCostScience} sci + ${BALANCE.fabCostCredits} cr → +${BALANCE.fabProgressPct}% hull`}
        >
          <Hammer className="h-3.5 w-3.5" />
          {room.fabJob ? `Fabricating… ${Math.ceil(room.fabJob.remaining)}s` : `Fabricate section (+${BALANCE.fabProgressPct}% hull)`}
        </button>
      )}

      {room.state === 'damaged' && (
        <div className="flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">
          <Wrench className="h-3.5 w-3.5" /> Offline — engineers will auto-repair.
        </div>
      )}

      <TacticalPlaybook engine={engine} room={room} />
      {room.type === 'quarters' && <p className="text-[10px] text-mist">Crew resting here recovers stamina and heals.</p>}
      {room.type === 'lab' && room.state === 'active' && (
        <p className="text-[10px] text-mist">Idle scientists analyze data here (+science trickle).</p>
      )}
      {room.type === 'dock' && <p className="text-[10px] text-mist">Arrivals and supply ships use this arm.</p>}
    </>
  )
}

/** Tactical playbook — 3 countermeasure buttons with predicted impact,
 *  shown when the inspected module has live fires. */
function TacticalPlaybook({ engine, room }: { engine: Engine; room: Room }) {
  const st = engine.state
  const fires = [...st.fires.values()].filter(
    (f) => f.dormant <= 0 && rectContains(room.rect, f.x, f.y),
  )
  if (!fires.length) return null
  const hidden = fires.some((f) => f.hidden)
  const selfOx = fires.some((f) => f.selfOxidizing)

  const buttons: { kind: Countermeasure; icon: typeof Wind }[] = [
    { kind: 'vent-cut', icon: Wind },
    { kind: 'depressurize', icon: ShieldAlert },
    { kind: 'suppression', icon: Zap },
  ]

  return (
    <div className="rounded border border-red-500/40 bg-red-500/10 p-2">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-red-300">
        <Flame className="h-3 w-3" /> Fire response — {fires.length} tile{fires.length > 1 ? 's' : ''}
      </div>
      {hidden && (
        <p className="mb-1 text-[9px] text-violet-300">
          Cool flame suspected — invisible to the naked eye (FLEX regime). Use sensors, not visuals.
        </p>
      )}
      {selfOx && (
        <p className="mb-1 text-[9px] text-ember">
          Self-oxidizing fire (Mir-1997 type) — vent/O₂ cuts won't starve it; knock-down re-ignites.
        </p>
      )}
      <div className="space-y-1">
        {buttons.map(({ kind, icon: Icon }) => {
          const used = room.countermeasures.includes(kind)
          const p = COUNTERMEASURE_PREVIEW[kind]
          const ineffective = selfOx && kind !== 'suppression'
          return (
            <button
              key={kind}
              onClick={() => engine.countermeasure(room.id, kind)}
              disabled={used}
              className="flex w-full items-center gap-1.5 rounded bg-panel/80 px-1.5 py-1 text-left text-[10px] font-medium text-white hover:bg-edge disabled:opacity-40"
            >
              <Icon className="h-3 w-3 shrink-0 text-ember" />
              <span className="flex-1">{p.desc.split('—')[0].trim()}</span>
              <span className={`font-mono text-[9px] ${ineffective ? 'text-red-400' : 'text-emerald-400'}`}>
                {used ? 'applied' : ineffective ? 'ineffective' : `−${p.deltaPct}%`}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CrewInfo({ crew }: { crew: CrewMember }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className={crew.role === 'engineer' ? 'text-ember' : 'text-ice'}>
          {crew.role === 'engineer' ? 'Engineer' : 'Scientist'}
        </span>
        <span className="flex items-center gap-1 text-[10px] uppercase text-mist">
          <Activity className="h-3 w-3" />
          {crew.state}
        </span>
      </div>
      <Bar label="health" value={crew.health} cls={crew.health > 50 ? 'bg-emerald-500' : 'bg-red-500'} />
      <Bar label="stamina" value={crew.stamina} cls="bg-ice" />
      <Bar label="morale" value={crew.morale} cls="bg-ember" />
      <div className="flex items-center gap-1 text-[10px] text-mist">
        <HeartPulse className="h-3 w-3" />
        {crew.job ? `task: ${crew.job.kind}` : 'awaiting assignment'}
      </div>
    </>
  )
}
