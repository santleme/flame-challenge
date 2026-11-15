import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import IgnisSprite from './IgnisSprite'
import AgentTurn from './AgentTurn'
import type { AgentTurnModel } from '../lib/simConsole'

describe('IgnisSprite component', () => {
  it('exports IgnisSprite function component', () => {
    expect(typeof IgnisSprite).toBe('function')
  })

  it('renders canvas with intrinsic 512x512 resolution to prevent aspect ratio jump', () => {
    const html = renderToString(React.createElement(IgnisSprite, { working: false }))
    expect(html).toContain('width="512"')
    expect(html).toContain('height="512"')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Ignis at a laptop"')
    expect(html).toContain('aspect-square')
    expect(html).toContain('shrink-0')
  })

  it('sets working aria-label when working=true', () => {
    const html = renderToString(React.createElement(IgnisSprite, { working: true, size: 68 }))
    expect(html).toContain('aria-label="Ignis is working at a laptop"')
    expect(html).toContain('width:68px')
    expect(html).toContain('height:68px')
  })

  it('defaults to size=256px inline styles', () => {
    const html = renderToString(React.createElement(IgnisSprite))
    expect(html).toContain('width:256px')
    expect(html).toContain('height:256px')
  })
})

describe('AgentTurn and IgnisSprite integration', () => {
  it('renders IgnisSprite in working mode when turn.pending is true', () => {
    const pendingTurn: AgentTurnModel = {
      kind: 'agent',
      id: 1,
      pending: true,
      tools: [],
      briefing: '',
      action: null,
      run: null,
      mode: null,
      model: null,
      engine: null,
      riskIndex: null,
      evidence: [],
      ms: null,
    }

    const html = renderToString(React.createElement(AgentTurn, { turn: pendingTurn, live: false }))
    expect(html).toContain('Ignis is working…')
    expect(html).toContain('aria-label="Ignis is working at a laptop"')
    expect(html).toContain('width:68px')
  })

  it('renders completed turn without sprite when turn.pending is false', () => {
    const completedTurn: AgentTurnModel = {
      kind: 'agent',
      id: 2,
      pending: false,
      tools: [{ name: 'set_o2_percent', arg: '21', live: false }],
      briefing: 'Ignition confirmed under 21% O2.',
      action: 'Check quench distance',
      run: null,
      mode: 'llm',
      model: 'qwen',
      engine: 'c++',
      riskIndex: 0.42,
      evidence: [
        {
          accession: 'PSI-TEST-1',
          fuel: 'heptane',
          outcome: 'cool flame',
          sourceUrl: 'https://example.com',
          runId: '1',
          investigationId: 'flex-2',
          similarity: 0.95,
          verified: true,
        },
      ],
      ms: 120,
    }

    const html = renderToString(React.createElement(AgentTurn, { turn: completedTurn, live: false }))
    expect(html).toContain('Ignis')
    expect(html).toContain('Connected')
    expect(html).toContain('Ignition confirmed under 21% O2.')
    expect(html).toContain('Check quench distance')
    expect(html).toContain('42')
    expect(html).toContain('set_o2_percent')
    expect(html).toContain('PSI-TEST-1')
    expect(html).not.toContain('Ignis is working…')
  })

  it('omits risk badge when turn.riskIndex is NaN', () => {
    const nanTurn: AgentTurnModel = {
      kind: 'agent',
      id: 3,
      pending: false,
      tools: [],
      briefing: 'Ignition check',
      action: null,
      run: null,
      mode: 'llm',
      model: 'qwen',
      engine: 'c++',
      riskIndex: NaN,
      evidence: [],
      ms: 100,
    }

    const html = renderToString(React.createElement(AgentTurn, { turn: nanTurn, live: false }))
    expect(html).not.toContain('Risk index')
    expect(html).not.toContain('NaN')
  })
})
