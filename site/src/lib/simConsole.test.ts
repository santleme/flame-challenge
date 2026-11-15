import { describe, expect, it } from 'vitest'
import type { SiChamberState } from './api'
import type { ChamberState } from './live'
import {
  GRAVITY_G,
  mergeChamberState,
  presetToCommands,
  runOutcome,
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

  it('mirrors the N2 purge oxygen drop so follow-ups keep 11.5%', () => {
    const sealed = mergeChamberState(
      { ...base, o2Pct: 15 },
      { trigger_containment: 'n2_purge' },
    )
    expect(sealed.sealed).toBe(true)
    expect(sealed.o2Pct).toBe(11.5)
    const followUp = mergeChamberState(sealed, { set_airflow_cm_s: 0 })
    expect(followUp.o2Pct).toBe(11.5)
  })

  it('keeps explicit O2 when the purge carries a setpoint', () => {
    const next = mergeChamberState(base, {
      trigger_containment: 'n2_purge',
      set_o2_percent: 18,
    })
    expect(next.o2Pct).toBe(18)
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
    expect(
      presetToCommands({ investigationId: 'x', o2Pct: 21, flowCms: 1, gravity: 'martian' })
        .set_gravity_g,
    ).toBe(0.38)
  })
})

describe('runOutcome', () => {
  const baseFrame: ChamberState = {
    model: 'spread',
    tSec: 10,
    regime: 1,
    o2Pct: 21,
    o2EffPct: 21,
    volumeLiters: 100,
    ignited: true,
    coolFlame: false,
    finished: false,
  }

  it('correctly reports spreading for active spread in regime 1', () => {
    expect(runOutcome({ ...baseFrame, model: 'spread', regime: 1 })).toBe('spreading')
  })

  it('reports burned out when spread flame has extinguished (regime 3)', () => {
    expect(runOutcome({ ...baseFrame, model: 'spread', regime: 3 })).toBe('burned out')
  })

  it('reports preheat for spread regime 0', () => {
    expect(runOutcome({ ...baseFrame, model: 'spread', regime: 0 })).toBe('preheat')
  })

  it('reports cooling for spread regime 2', () => {
    expect(runOutcome({ ...baseFrame, model: 'spread', regime: 2 })).toBe('cooling')
  })

  it('reports cool flame sustained when coolFlame is true or droplet regime 2', () => {
    expect(runOutcome({ ...baseFrame, coolFlame: true })).toBe('cool flame sustained')
    expect(runOutcome({ ...baseFrame, model: 'droplet', regime: 2, coolFlame: false })).toBe(
      'cool flame sustained',
    )
  })

  it('reports hot flame for droplet regime 1', () => {
    expect(runOutcome({ ...baseFrame, model: 'droplet', regime: 1 })).toBe('hot flame')
  })
})

describe('sequential follow-up command retention', () => {
  it('preserves accumulated oxygen, flow, and investigation across partial commands', () => {
    // Turn 1: initial run with 15% O2 and 2.5 cm/s flow on saffire
    const turn1 = mergeChamberState(base, {
      load_preset: 'saffire',
      set_o2_percent: 15,
      set_airflow_cm_s: 2.5,
    })
    expect(turn1.investigationId).toBe('saffire')
    expect(turn1.o2Pct).toBe(15)
    expect(turn1.flowCms).toBe(2.5)

    // Turn 2: partial follow-up command adjusting only airflow to 0
    const turn2 = mergeChamberState(turn1, {
      set_airflow_cm_s: 0,
    })
    expect(turn2.investigationId).toBe('saffire')
    expect(turn2.o2Pct).toBe(15)
    expect(turn2.flowCms).toBe(0)

    // Turn 3: nitrogen purge drops O2 to 11.5% like the live chamber does
    const turn3 = mergeChamberState(turn2, {
      trigger_containment: 'n2_purge',
    })
    expect(turn3.investigationId).toBe('saffire')
    expect(turn3.o2Pct).toBe(11.5)
    expect(turn3.flowCms).toBe(0)
    expect(turn3.sealed).toBe(true)

    // Turn 4: setting martian gravity and ensuring follow-up commands retain 0.38g
    const turn4 = mergeChamberState(turn3, {
      set_gravity_g: 0.38,
    })
    expect(turn4.gravity).toBe('martian')
    expect(GRAVITY_G[turn4.gravity]).toBe(0.38)

    // Turn 5: follow-up command modifying only oxygen retains martian gravity
    const turn5 = mergeChamberState(turn4, {
      set_o2_percent: 25,
    })
    expect(turn5.gravity).toBe('martian')
    expect(GRAVITY_G[turn5.gravity]).toBe(0.38)
    expect(turn5.o2Pct).toBe(25)
  })
})
