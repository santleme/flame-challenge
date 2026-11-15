import { describe, expect, it } from 'vitest'
import type { SiChamberState, SiSimulationCommands } from './api'
import {
  mergeChamberState,
  presetToCommands,
  toolCallsFromCommands,
} from './simConsole'

const base: SiChamberState = {
  investigationId: 'flex-2',
  materialId: 'heptane',
  o2Pct: 21,
  flowCms: 0.5,
  gravity: 'microgravity',
}

describe('toolCallsFromCommands', () => {
  it('maps every command field into ordered tool rows', () => {
    const { tools } = toolCallsFromCommands({
      load_preset: 'saffire',
      set_o2_percent: 21.8,
      set_airflow_cm_s: 25,
      set_gravity_g: 0,
      trigger_containment: 'n2_purge',
    })
    expect(tools.map((t) => t.name)).toEqual([
      'load_preset',
      'set_o2_percent',
      'set_airflow_cm_s',
      'set_gravity_g',
      'trigger_containment',
      'chamber.run',
    ])
    expect(tools[0].arg).toBe('"saffire"')
    expect(tools[1].arg).toBe('21.8')
    expect(tools.at(-1)?.live).toBe(true)
  })

  it('does not run the chamber for a gravity-only command', () => {
    const { tools, run } = toolCallsFromCommands({ set_gravity_g: 0.17 })
    expect(run).toBeNull()
    expect(tools.map((t) => t.name)).toEqual(['set_gravity_g'])
  })

  it('returns nothing for empty commands', () => {
    const { tools, run } = toolCallsFromCommands({})
    expect(tools).toEqual([])
    expect(run).toBeNull()
  })

  it('extracts the run request fields', () => {
    const { run } = toolCallsFromCommands({
      load_preset: 'flex-2',
      set_o2_percent: 15,
      set_airflow_cm_s: 0.5,
      set_gravity_g: 0,
      trigger_containment: null,
    })
    expect(run).toEqual({
      presetId: 'flex-2',
      o2Pct: 15,
      flowCms: 0.5,
      gravityG: 0,
      containment: null,
    })
  })
})

describe('mergeChamberState', () => {
  it('maps load_preset to investigation + material via the fallback table', () => {
    const next = mergeChamberState(base, { load_preset: 'saffire' })
    expect(next.investigationId).toBe('saffire')
    expect(next.materialId).toBe('cotton')
    expect(next.o2Pct).toBe(21)
  })

  it('maps set_gravity_g through gravityRegime', () => {
    expect(mergeChamberState(base, { set_gravity_g: 0.17 }).gravity).toBe('lunar')
    expect(mergeChamberState(base, { set_gravity_g: 1 }).gravity).toBe('earth')
  })

  it('overrides scalars and keeps the rest', () => {
    const next = mergeChamberState(base, {
      set_o2_percent: 15,
      set_airflow_cm_s: 0,
    })
    expect(next.o2Pct).toBe(15)
    expect(next.flowCms).toBe(0)
    expect(next.investigationId).toBe('flex-2')
  })
})

describe('presetToCommands', () => {
  it('emits the full deterministic command set', () => {
    const sim = presetToCommands({
      investigationId: 'flare',
      o2Pct: 30,
      flowCms: 15,
      gravity: 'lunar',
    })
    expect(sim).toEqual({
      load_preset: 'flare',
      set_o2_percent: 30,
      set_airflow_cm_s: 15,
      set_gravity_g: 0.17,
    })
  })

  it('maps named gravity regimes to g values', () => {
    expect(
      presetToCommands({ investigationId: 'flex-2', o2Pct: 21, flowCms: 0.5, gravity: 'microgravity' })
        .set_gravity_g,
    ).toBe(0)
    expect(
      presetToCommands({ investigationId: 'x', o2Pct: 21, flowCms: 1, gravity: 'earth' })
        .set_gravity_g,
    ).toBe(1)
    expect(
      presetToCommands({ investigationId: 'x', o2Pct: 21, flowCms: 1, gravity: 'mars' })
        .set_gravity_g,
    ).toBe(0.38)
  })
})
