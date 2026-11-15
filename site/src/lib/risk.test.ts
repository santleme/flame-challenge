import { describe, expect, it } from 'vitest'
import { riskIndexLocal } from './risk'

describe('gravity vocabulary', () => {
  // mission presets spell the regime "mars" while the model vocabulary
  // says "martian" — both must resolve to the same factor or the local
  // mirror and the backend produce different scores for the same input
  it.each([
    ['pmma', 25, 5],
    ['heptane', 16, 0],
  ])('mars alias matches martian — %s @ %d%% O₂, %d cm/s', (mat, o2, flow) => {
    const mars = riskIndexLocal(mat, o2, flow, 'mars')
    const martian = riskIndexLocal(mat, o2, flow, 'martian')
    expect(mars.breakdown.gravityFactor).toBe(0.95)
    expect(mars.riskIndex).toBe(martian.riskIndex)
  })
})
