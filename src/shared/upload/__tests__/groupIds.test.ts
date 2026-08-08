import { describe, expect, it } from 'vitest'
import {
  allSelectedTrackersHaveGroupId,
  anySelectedTrackerHasGroupId,
  groupIdForTracker,
  withGroupIdForTracker
} from '../groupIds'

describe('groupIds helpers', () => {
  it('reads and writes per-tracker ids', () => {
    const next = withGroupIdForTracker({ redacted: 1 }, 'orpheus', 2)
    expect(next).toEqual({ redacted: 1, orpheus: 2 })
    expect(groupIdForTracker({ groupIds: next }, 'redacted')).toBe(1)
    expect(groupIdForTracker({ groupIds: next }, 'orpheus')).toBe(2)
    expect(groupIdForTracker({ groupIds: { redacted: null } }, 'redacted')).toBeNull()
  })

  it('detects selected trackers with group ids', () => {
    const upload = {
      selectedTrackerIds: ['redacted', 'orpheus'] as Array<'redacted' | 'orpheus'>,
      groupIds: { redacted: 10, orpheus: null }
    }
    expect(anySelectedTrackerHasGroupId(upload)).toBe(true)
    expect(allSelectedTrackersHaveGroupId(upload)).toBe(false)

    expect(
      allSelectedTrackersHaveGroupId({
        selectedTrackerIds: ['redacted', 'orpheus'],
        groupIds: { redacted: 10, orpheus: 20 }
      })
    ).toBe(true)
  })
})
