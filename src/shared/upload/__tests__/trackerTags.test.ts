import { describe, expect, it } from 'vitest'
import { normalizeTrackerTags } from '../trackerTags'

describe('normalizeTrackerTags', () => {
  it('swaps spaces for dots and drops empty tags', () => {
    expect(normalizeTrackerTags(' Chamber Music, jazz,, hip  hop ')).toBe(
      'chamber.music, jazz, hip.hop'
    )
  })

  it('leaves dotted tags alone', () => {
    expect(normalizeTrackerTags('chamber.music, ambient')).toBe('chamber.music, ambient')
  })
})
