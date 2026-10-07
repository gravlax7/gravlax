import { describe, expect, it } from 'vitest'
import { numericTrackPositions, trackPositionMismatchNotice } from '../trackOrder'

describe('numeric track positions', () => {
  it('accepts padded numbers, totals, gaps, and repeated numbers on separate discs', () => {
    const tracks = [
      { discNumber: '02/2', trackNumber: '01/12' },
      { discNumber: '1', trackNumber: '10' },
      { discNumber: '1', trackNumber: '2' }
    ]
    expect(numericTrackPositions(tracks)).toEqual([
      { disc: 2, track: 1 }, { disc: 1, track: 10 }, { disc: 1, track: 2 }
    ])
    expect(tracks[0]).toEqual({ discNumber: '02/2', trackNumber: '01/12' })
  })

  it('defaults missing discs to 1 for a single-disc release', () => {
    expect(numericTrackPositions([{ trackNumber: '2' }, { discNumber: '1', trackNumber: '1' }]))
      .toEqual([{ disc: 1, track: 2 }, { disc: 1, track: 1 }])
  })

  it.each(['', '0', '-1', '1.5', 'A1', '1junk', '9007199254740992'])(
    'rejects invalid track number %j for the whole release', (trackNumber) => {
      expect(numericTrackPositions([{ trackNumber: '2' }, { trackNumber }])).toBeUndefined()
    }
  )

  it.each(['0', '-1', 'CD1', '1.5'])(
    'rejects supplied invalid disc number %j', (discNumber) => {
      expect(numericTrackPositions([{ discNumber, trackNumber: '1' }])).toBeUndefined()
    }
  )

  it('rejects missing discs in a multi-disc release and duplicate normalized positions', () => {
    expect(numericTrackPositions([{ discNumber: '2', trackNumber: '1' }, { trackNumber: '2' }]))
      .toBeUndefined()
    expect(numericTrackPositions([{ trackNumber: '1' }, { discNumber: '01', trackNumber: '01/12' }]))
      .toBeUndefined()
  })
})

describe('position mismatch notice', () => {
  it('compares sequence without sorting metadata or changing tracks', () => {
    const current = [{ trackNumber: '1' }, { trackNumber: '2' }]
    const selected = [{ trackNumber: '2' }, { trackNumber: '1' }]
    expect(trackPositionMismatchNotice(current, selected)).toContain('Tracks are paired in order')
    expect(selected.map((track) => track.trackNumber)).toEqual(['2', '1'])
    expect(trackPositionMismatchNotice(current, [{ trackNumber: '01/2' }, { trackNumber: '02' }]))
      .toBeUndefined()
  })

  it('leaves invalid positions and track counts to existing checks', () => {
    expect(trackPositionMismatchNotice([{ trackNumber: '1' }], [{ trackNumber: 'A1' }])).toBeUndefined()
    expect(trackPositionMismatchNotice([{ trackNumber: '1' }], [])).toBeUndefined()
  })
})
