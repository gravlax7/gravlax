import { describe, expect, it } from 'vitest'
import type { UploadSnapshot } from '@shared/types'
import {
  effectiveReleaseType,
  isOrpheusSplitEligible,
  namedMainArtistCount
} from '../releaseTypes'

function splitCandidate(patch: Partial<UploadSnapshot> = {}): UploadSnapshot {
  return {
    selectedTrackerIds: ['redacted', 'orpheus'],
    artists: [
      { name: 'A', importance: 1 },
      { name: 'B', importance: 1 }
    ],
    releaseType: 'Album',
    groupIds: {},
    ...patch
  }
}

describe('Orpheus split release type', () => {
  it('counts named main artists only', () => {
    expect(
      namedMainArtistCount(
        splitCandidate({
          artists: [
            { name: 'A', importance: 1 },
            { name: ' ', importance: 1 },
            { name: 'Guest', importance: 2 },
            { name: 'Composer', importance: 4 }
          ]
        })
      )
    ).toBe(1)
  })

  it('offers Split for a new selected Orpheus group with two main artists', () => {
    expect(isOrpheusSplitEligible(splitCandidate())).toBe(true)
  })

  it('does not offer Split for guests, a deselected tracker, or an existing group', () => {
    expect(
      isOrpheusSplitEligible(
        splitCandidate({
          artists: [
            { name: 'A', importance: 1 },
            { name: 'Guest', importance: 2 }
          ]
        })
      )
    ).toBe(false)
    expect(
      isOrpheusSplitEligible(splitCandidate({ selectedTrackerIds: ['redacted'] }))
    ).toBe(false)
    expect(
      isOrpheusSplitEligible(splitCandidate({ groupIds: { orpheus: 42 } }))
    ).toBe(false)
  })

  it('defaults to the shared type and overrides Orpheus only when chosen', () => {
    expect(effectiveReleaseType(splitCandidate(), 'orpheus')).toBe('Album')

    const chosen = splitCandidate({ orpheusSplit: true })
    expect(effectiveReleaseType(chosen, 'redacted')).toBe('Album')
    expect(effectiveReleaseType(chosen, 'orpheus')).toBe('Split')
  })
})
