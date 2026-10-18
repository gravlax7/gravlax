import { describe, expect, it } from 'vitest'
import { numericTrackPositions, trackCompletenessNotices, trackPositionMismatchNotice } from '../trackOrder'

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

describe('track completeness', () => {
  const disc = (numbers: number[], tags: Record<string, string> = {}) =>
    numbers.map((n) => ({ trackNumber: String(n), ...tags }))

  it.each([
    ['a gap', disc([1, 2, 4]), ['Track 3 is missing.']],
    ['a total above the file count', disc([...Array(10).keys()].map((i) => i + 1), { trackTotal: '13' }),
      ['Tags say 13 tracks; the folder has 10.']],
    ['a number past the total', [...disc([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], { trackTotal: '13' }),
      { trackNumber: '15', trackTotal: '13' }], [
      'Tracks 12–14 are missing.',
      'Track 15 is numbered past the total of 13.',
      'Tags say 13 tracks; the folder has 12.'
    ]],
    ['a total in the number tag', [{ trackNumber: '1/3' }, { trackNumber: '2/3' }],
      ['Tags say 3 tracks; the folder has 2.']],
    ['a file without a total', [{ trackNumber: '1', trackTotal: '3' }, { trackNumber: '2' }],
      ['Tags say 3 tracks; the folder has 2.']],
    ['files that disagree on the total', [{ trackNumber: '1', trackTotal: '2' }, { trackNumber: '2', trackTotal: '3' }],
      ['Files disagree on the track total (2, 3).']],
    ['a missing disc', [{ discNumber: '1', trackNumber: '1' }, { discNumber: '3', trackNumber: '1' }],
      ['Disc 2 is missing.']],
    ['a disc total above the discs found', [{ discNumber: '1/2', trackNumber: '1' }],
      ['Tags say 2 discs; the folder has 1.']],
    ['a gap on one disc', [
      { discNumber: '1', trackNumber: '1' }, { discNumber: '2', trackNumber: '1' }, { discNumber: '2', trackNumber: '3' }
    ], ['Disc 2: Track 2 is missing.']],
    ['a complete release', disc([1, 2, 3], { trackTotal: '3' }), []],
    ['vinyl sides', [{ trackNumber: 'A1' }, { trackNumber: 'A2' }], []]
  ])('reports %s', (_name, files, notices) => {
    expect(trackCompletenessNotices(files)).toEqual(notices)
  })
})
