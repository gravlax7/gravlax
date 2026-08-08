import { describe, expect, it } from 'vitest'
import { compareNatural } from '../naturalSort'

describe('compareNatural', () => {
  it('orders numeric runs by value, not codepoint', () => {
    expect(['CD10', 'CD2', 'CD1'].sort(compareNatural)).toEqual(['CD1', 'CD2', 'CD10'])
    expect(['10 - a.flac', '1 - a.flac', '2 - a.flac'].sort(compareNatural)).toEqual([
      '1 - a.flac',
      '2 - a.flac',
      '10 - a.flac'
    ])
  })

  it('orders multi-disc relative paths correctly', () => {
    const paths = ['CD10/01.flac', 'CD2/01.flac', 'CD1/01.flac', 'CD1/02.flac']
    expect(paths.sort(compareNatural)).toEqual([
      'CD1/01.flac',
      'CD1/02.flac',
      'CD2/01.flac',
      'CD10/01.flac'
    ])
  })

  it('falls back to text comparison when there are no digits', () => {
    expect(['b.flac', 'a.flac'].sort(compareNatural)).toEqual(['a.flac', 'b.flac'])
  })

  it('treats a shorter prefix as smaller', () => {
    expect(compareNatural('track', 'track 2')).toBeLessThan(0)
  })

  it('is stable for equal strings', () => {
    expect(compareNatural('CD1/01.flac', 'CD1/01.flac')).toBe(0)
  })
})
