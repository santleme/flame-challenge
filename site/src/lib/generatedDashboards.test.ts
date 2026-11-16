import { describe, expect, it } from 'vitest'
import {
  analysisScenarioForResponse,
  compileMissionReportSpec,
} from './generatedDashboards'
import type { SiChamberState, SiResponse } from './api'

const sent: SiChamberState = {
  investigationId: 'sofie-gel',
  materialId: 'pmma',
  o2Pct: 40,
  flowCms: 5,
  gravity: 'microgravity',
}

/** backend scored PMMA at 40% O₂, then commanded O₂ down toward LOC —
 *  risk + uncertainty describe the sent point, not the post-command one */
const res: SiResponse = {
  briefing: 'high-risk oxidizer-rich environment',
  recommended_action: 'REDUCE_O2',
  ui_command: null,
  simulation_commands: { set_o2_percent: 16 },
  mode: 'offline-fallback',
  model: 'deterministic',
  chamber: {
    investigationId: 'sofie-gel',
    materialId: 'pmma',
    o2Pct: 40,
    flowCms: 5,
    gravity: 'microgravity',
    riskIndex: 0.9,
    level: 'critical',
  },
  evidence: [],
}

describe('analysisScenarioForResponse', () => {
  it('returns the validated operating point from res.chamber', () => {
    const a = analysisScenarioForResponse(res, sent)
    expect(a.o2Pct).toBe(40)
    expect(a.flowCms).toBe(5)
    expect(a.materialId).toBe('pmma')
    expect(a.investigationId).toBe('sofie-gel')
    expect(a.gravity).toBe('microgravity')
  })

  it('falls back to the sent state for fields res.chamber lacks', () => {
    const local: SiResponse = { ...res, chamber: { o2Pct: 21 } }
    const a = analysisScenarioForResponse(local, sent)
    expect(a.o2Pct).toBe(21)
    expect(a.flowCms).toBe(5)
    expect(a.investigationId).toBe('sofie-gel')
  })
})

describe('compileMissionReportSpec — commands that retune conditions', () => {
  it('pairs the returned risk with the analyzed point, not the post-command chamber', () => {
    const analysis = analysisScenarioForResponse(res, sent)
    const spec = compileMissionReportSpec('analyze pmma at 40%', res, undefined, analysis)
    expect(spec.rubric.summarize.o2Pct).toBe(40)
    expect(spec.rubric.summarize.flowCms).toBe(5)
    expect(spec.rubric.rank.compositeRisk).toBe(90)
    expect(spec.rubric.rank.level).toBe('critical')
  })
})
