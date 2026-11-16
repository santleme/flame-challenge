import { describe, expect, it } from 'vitest'
import { missionMedia } from './missionMedia'

describe('missionMedia', () => {
  it('gives every known investigation its own distinct NASA plate', () => {
    const ids = ['flare', 'sofie-gel', 'flex-2', 'saffire', 'same', 'acme', 'bass-ii', 'confined-combustion']
    const srcs = ids.map((id) => missionMedia(id, '').src)
    expect(new Set(srcs).size).toBe(ids.length)
  })

  it('is case-insensitive on the investigation id', () => {
    expect(missionMedia('SAFFIRE', 'x').src).toContain('saffire5')
  })

  it('falls back on the gravity regime for unknown investigations', () => {
    expect(missionMedia('unknown', 'lunar').src).toContain('apollo11')
    expect(missionMedia('unknown', 'Earth 1g').src).toContain('acme')
    expect(missionMedia('unknown', 'Microgravity (0g)').src).toContain('skylab')
  })
})
