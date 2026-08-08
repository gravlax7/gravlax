import { describe, expect, it } from 'vitest'
import { prepareTags } from '../tags'

describe('prepareTags', () => {
  it('strips replaygain and encoder tags', () => {
    const result = prepareTags({
      TITLE: ['Song'],
      REPLAYGAIN_TRACK_GAIN: ['-6.0 dB'],
      encoder: ['Lavf']
    })
    expect(result).toEqual({ title: ['Song'] })
  })

  it('merges track totals into tracknumber', () => {
    const result = prepareTags({
      tracknumber: ['3'],
      tracktotal: ['10']
    })
    expect(result.tracknumber).toEqual(['3/10'])
    expect(result.tracktotal).toBeUndefined()
  })

  it('merges disc totals with alternate key names', () => {
    const result = prepareTags({
      discnumber: ['1'],
      'total discs': ['2']
    })
    expect(result.discnumber).toEqual(['1/2'])
  })

  it('throws on conflicting totals', () => {
    expect(() =>
      prepareTags({
        tracknumber: ['1'],
        tracktotal: ['10'],
        totaltracks: ['12']
      })
    ).toThrow(/conflicting values/)
  })

  it('throws on non-integer totals', () => {
    expect(() =>
      prepareTags({
        tracknumber: ['1'],
        tracktotal: ['ten']
      })
    ).toThrow(/Non-integer total values/)
  })
})
