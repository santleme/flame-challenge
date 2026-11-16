import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Composer from './Composer'

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
})
