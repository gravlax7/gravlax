import { describe, expect, it } from 'vitest'
import { trackerEncoding } from '@shared/upload/encodings'

describe('trackerEncoding', () => {
  it('spells V0 the way Gazelle does', () => {
    expect(trackerEncoding('V0')).toBe('V0 (VBR)')
  })

  it('leaves the constant bitrates alone', () => {
    expect(trackerEncoding('320')).toBe('320')
  })
})
