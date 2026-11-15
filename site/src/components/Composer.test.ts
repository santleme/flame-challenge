import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Composer from './Composer'
import { parseFlameParameters } from './MathematicalFlameField'

describe('Composer component', () => {
  it('renders input elements, mic button, and send button', () => {
    const onSend = vi.fn()
    const onVoice = vi.fn()
    const html = renderToString(React.createElement(Composer, { onSend, onVoice }))

    expect(html).toContain('textarea')
    expect(html).toContain('placeholder="Message Ignis…"')
    expect(html).toContain('Press and hold to talk')
    expect(html).toContain('Send message to Ignis')
    expect(html).toContain('type="submit"')
  })

  it('disables input and buttons when disabled=true', () => {
    const onSend = vi.fn()
    const onVoice = vi.fn()
    const html = renderToString(React.createElement(Composer, { onSend, onVoice, disabled: true }))

    expect(html).toContain('disabled=""')
  })

  it('renders with explicit flameDefaults', () => {
    const onSend = vi.fn()
    const onVoice = vi.fn()
    const html = renderToString(
      React.createElement(Composer, {
        onSend,
        onVoice,
        flameDefaults: {
          gravityG: 0.38,
          o2Pct: 35,
          airflowCms: 10,
          coolFlame: false,
        },
      }),
    )

    expect(html).toContain('g: 0.38g')
    expect(html).toContain('O₂: 35%')
  })
})

describe('parseFlameParameters', () => {
  it('parses empty text with default fallback parameters', () => {
    const params = parseFlameParameters('')
    expect(params).toEqual({
      gravityG: 0,
      o2Pct: 21,
      airflowCms: 0.5,
      coolFlame: false,
      enriched: false,
      suppressed: false,
    })
  })

  it('parses explicit gravity, oxygen, flow and cool flame directives', () => {
    const params = parseFlameParameters('Test at 30% oxygen with 12 cm/s airflow under lunar gravity and cool flame')
    expect(params.o2Pct).toBe(30)
    expect(params.airflowCms).toBe(12)
    expect(params.gravityG).toBe(0.16)
    expect(params.coolFlame).toBe(true)
  })

  it('clamps bounded ranges safely', () => {
    const high = parseFlameParameters('99% O2 and 150 cm/s airflow with 5g gravity')
    expect(high.o2Pct).toBe(85)
    expect(high.airflowCms).toBe(80)
    expect(high.gravityG).toBe(1.5)
  })
})
