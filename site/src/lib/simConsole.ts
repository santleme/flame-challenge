/**
 * Agent-console plumbing for the SimDeck: pure mappers between the SI
 * copilot's `simulation_commands`, the thread's tool-call rows, and the
 * chamber state fed back into the next copilot request.
 */
import {
  FALLBACK_INVESTIGATIONS,
  gravityRegime,
  type SiChamberState,
  type SiEvidence,
  type SiSimulationCommands,
} from './api'
import type { ChamberState } from './live'

export interface ToolCall {
  name: string
  arg: string | null
  live: boolean
}

export interface RunRequest {
  presetId: string | null
  o2Pct: number | null
  flowCms: number | null
  gravityG: number | null
  containment: string | null
}

export interface TurnCommands {
  tools: ToolCall[]
  run: RunRequest | null
}

/** Structural input for preset→command mapping (SimDeck's MissionPreset
 *  satisfies it; kept structural to avoid a component→lib cycle). */
export interface PresetCommandSource {
  investigationId: string
  o2Pct: number
  flowCms: number
  gravity: string
}

export interface UserMsg {
  kind: 'user'
  id: number
  text: string
}

export interface AgentTurnModel {
  kind: 'agent'
  id: number
  pending: boolean
  tools: ToolCall[]
  briefing: string
  action: string | null
  run: RunRequest | null
  mode: string | null
  model: string | null
  engine: string | null
  riskIndex: number | null
  evidence: SiEvidence[]
  ms: number | null
}

export type ChatMsg = UserMsg | AgentTurnModel

export const GRAVITY_G: Record<string, number> = {
  microgravity: 0,
  lunar: 0.17,
  mars: 0.38,
  martian: 0.38,
  earth: 1,
}

/** Mirror of simBus's run-condition rule: gravity alone never fires a run. */
function hasRunCondition(sim: SiSimulationCommands): boolean {
  return (
    sim.load_preset != null ||
    sim.set_o2_percent != null ||
    sim.set_airflow_cm_s != null ||
    sim.trigger_containment != null
  )
}

export function toolCallsFromCommands(
  sim: SiSimulationCommands | null | undefined,
): TurnCommands {
  if (!sim) return { tools: [], run: null }
  const tools: ToolCall[] = []
  const push = (name: string, arg: string | null, live = false) =>
    tools.push({ name, arg, live })
  if (sim.load_preset != null) push('load_preset', JSON.stringify(sim.load_preset))
  if (sim.set_o2_percent != null) push('set_o2_percent', String(sim.set_o2_percent))
  if (sim.set_airflow_cm_s != null) push('set_airflow_cm_s', String(sim.set_airflow_cm_s))
  if (sim.set_gravity_g != null) push('set_gravity_g', String(sim.set_gravity_g))
  if (sim.trigger_containment != null)
    push('trigger_containment', JSON.stringify(sim.trigger_containment))

  const runnable = hasRunCondition(sim)
  if (runnable) push('chamber.run', 'seed 1 · 30 Hz', true)

  return {
    tools,
    run: runnable
      ? {
          presetId: sim.load_preset ?? null,
          o2Pct: sim.set_o2_percent ?? null,
          flowCms: sim.set_airflow_cm_s ?? null,
          gravityG: sim.set_gravity_g ?? null,
          containment: sim.trigger_containment ?? null,
        }
      : null,
  }
}

export function mergeChamberState(
  state: SiChamberState,
  sim: SiSimulationCommands,
): SiChamberState {
  const next = { ...state }
  if (sim.load_preset != null) {
    next.investigationId = sim.load_preset
    next.materialId =
      FALLBACK_INVESTIGATIONS[sim.load_preset]?.materialId ?? state.materialId
  }
  if (sim.set_o2_percent != null) next.o2Pct = sim.set_o2_percent
  if (sim.set_airflow_cm_s != null) next.flowCms = sim.set_airflow_cm_s
  if (sim.set_gravity_g != null) next.gravity = gravityRegime(sim.set_gravity_g)
  if (sim.trigger_containment != null) {
    next.sealed = true
    // Mirror LiveChamber's N2 purge: a nitrogen purge without an explicit
    // O2 setpoint drops the chamber to 11.5% — keep the tracked state in
    // sync so follow-up commands don't rerun at pre-purge oxygen.
    const isN2Purge =
      typeof sim.trigger_containment === 'string' &&
      (sim.trigger_containment.toLowerCase().includes('n2') ||
        sim.trigger_containment.toLowerCase().includes('purge'))
    if (isN2Purge && sim.set_o2_percent == null) next.o2Pct = 11.5
  }
  return next
}

export function presetToCommands(preset: PresetCommandSource): SiSimulationCommands {
  return {
    load_preset: preset.investigationId,
    set_o2_percent: preset.o2Pct,
    set_airflow_cm_s: preset.flowCms,
    set_gravity_g: GRAVITY_G[preset.gravity] ?? 0,
  }
}

/** One-line outcome for a finished run, derived from the last frame. */
export function runOutcome(frame: ChamberState): string {
  if (frame.coolFlame || (frame.model === 'droplet' && frame.regime === 2))
    return 'cool flame sustained'
  if (frame.model === 'spread' && frame.regime === 3) return 'burned out'
  const names =
    frame.model === 'droplet'
      ? ['ignition', 'hot flame', 'cool flame', 'extinction', 'out']
      : ['preheat', 'spreading', 'cooling', 'out']
  return names[frame.regime] ?? 'run complete'
}
