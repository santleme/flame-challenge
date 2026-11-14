// Behavioral harness for the game core — covers the crew-AI rules that
// type checking and lint can't: the per-tick movement budget and the
// experiment-reservation lifecycle (assign / preempt / forced rest /
// flee / death / unreachable job / dangling id sweep).
//
// Run:  npx tsx verify.mts      (or: npm test)
// Exit: 0 = all checks passed, 1 = failures

import { Engine, investigations } from './src/game/engine'
import { moveAlongPath, updateCrewMember } from './src/game/crew'
import { mulberry32 } from './src/game/config'
import { tileKey } from './src/game/types'
import type { CrewMember, RoomType } from './src/game/types'

let failures = 0
const check = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ok  ${msg}`)
  else { failures++; console.error(`FAIL  ${msg}`) }
}

const noop = () => {}
const mkCrew = (over: Partial<CrewMember> = {}): CrewMember => ({
  id: 999,
  name: 'Test',
  role: 'engineer',
  pos: { x: 0, y: 0 },
  path: [],
  state: 'idle',
  job: null,
  stamina: 100,
  morale: 80,
  health: 100,
  speed: 2.4,
  taskTimer: 0,
  ...over,
})

const fireTile = (x: number, y: number) => ({
  x, y, intensity: 0.8, fuel: 5, hidden: false, spreadRate: 0.3,
  smolder: false, selfOxidizing: false, burnMult: 1, dormant: 0,
  sourceInv: 'verify',
})

// ---------- moveAlongPath: one distance budget, never negative ----------

{
  const c = mkCrew({ path: [{ x: 5, y: 0 }] })
  const arrived = moveAlongPath(c, 0)
  check(!arrived && c.pos.x === 0 && c.pos.y === 0,
    'moveAlongPath: dt=0 produces no movement')
}
{
  const c = mkCrew({ path: [{ x: 5, y: 0 }] })
  moveAlongPath(c, -1)
  check(c.pos.x === 0 && c.pos.y === 0,
    'moveAlongPath: negative dt never moves backwards')
}
{
  const c = mkCrew({ speed: 2.4, path: [{ x: 10, y: 0 }] })
  moveAlongPath(c, 0.25)
  check(Math.abs(c.pos.x - 0.6) < 1e-6,
    'moveAlongPath: distance travelled == speed*dt (single budget)')
}
{
  const c = mkCrew({ speed: 2.4, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] })
  moveAlongPath(c, 0.5) // budget 1.2 — waypoint 1 consumed, 0.2 toward 2
  check(Math.abs(c.pos.x - 1.2) < 1e-6 && c.path.length === 2,
    'moveAlongPath: fast crew cannot exceed one tick budget')
}
{
  const c = mkCrew({ path: [{ x: 0.5, y: 0 }] })
  check(moveAlongPath(c, 1) === true && c.pos.x === 0.5,
    'moveAlongPath: returns true when the path is consumed')
}

// ---------- engine-level: reservation lifecycle ----------

const eng = new Engine(7)
const st = eng.state

// a combustion chamber adjacent to the deck apron (dock+deck at x3..x9,y3..y6)
const rect = { x: 9, y: 3, w: 4, h: 4 }
check(eng.canPlace('combustion' as RoomType, rect).ok, 'canPlace: chamber adjacent to deck')
check(eng.placeRoom('combustion' as RoomType, rect), 'placeRoom: chamber built')
const room = st.rooms.find((r) => r.type === 'combustion')!
room.state = 'active'
room.buildProgress = 1

check(eng.startExperiment(room.id, investigations[0].id, 21, 0), 'startExperiment: run queued')
const exp = room.experiment!

// --- queued run preempts duty-lab ---
const [sci, other] = st.crew.filter((c) => c.role === 'scientist')
sci.job = { kind: 'duty-lab', roomId: room.id }
other.job = { kind: 'build', roomId: st.rooms[0].id } // ineligible
eng.step(0.3) // first step fires the assignJobs scheduler
check(exp.scientistId === sci.id, 'assignJobs: duty-lab scientist reserved for the run')
check(sci.job?.kind === 'experiment', 'assignJobs: queued run preempts duty-lab')

// --- injured forced rest releases the reservation immediately ---
other.job = { kind: 'rest', roomId: st.rooms[0].id }
other.state = 'resting'
other.stamina = 5 // stays resting — cannot pick up the released run
sci.health = 40
eng.step(0.3)
check(sci.job?.kind === 'rest' && (sci.state === 'injured' || sci.state === 'resting'),
  'forced rest: injured scientist sent to rest')
check(exp.scientistId === null,
  'forced rest: reservation released in the same tick (no stranded run)')

// --- fleeing a fire releases the reservation ---
exp.scientistId = sci.id
sci.health = 100
sci.state = 'idle'
sci.job = { kind: 'experiment', roomId: room.id }
const fx = Math.floor(sci.pos.x)
const fy = Math.floor(sci.pos.y)
st.fires.set(tileKey(fx, fy), fireTile(fx, fy))
updateCrewMember(st, sci, 0.1, mulberry32(1), noop)
check(sci.job === null && exp.scientistId === null,
  'panic: fleeing scientist releases job and reservation')

// --- dying on a burning tile releases the reservation ---
exp.scientistId = sci.id
sci.job = { kind: 'experiment', roomId: room.id }
sci.state = 'idle'
sci.path = []
sci.health = 0.01 // next tick of burn damage is fatal
updateCrewMember(st, sci, 0.1, mulberry32(1), noop)
check(sci.state === 'dead' && exp.scientistId === null,
  'death: reservation released when the scientist dies')
st.fires.clear()

// --- unreachable job target clears job + reservation ---
const origRect = room.rect
exp.scientistId = other.id
other.job = { kind: 'experiment', roomId: room.id }
other.state = 'idle'
other.path = []
room.rect = { x: 40, y: 40, w: 2, h: 2 } // off-grid → pathTo fails
updateCrewMember(st, other, 0.1, mulberry32(1), noop)
check(other.job === null && exp.scientistId === null,
  'unreachable job: clearJob releases the reservation')
room.rect = origRect

// --- dangling scientistId is swept by the next assignJobs pass ---
exp.scientistId = 424242
eng.step(0.3)
check(exp.scientistId !== 424242,
  'assignJobs: reservation held by a non-existent scientist is swept')

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
