import { describe, expect, it } from 'vitest'
import {
  TRACKER_AUTH_MODES,
  TRACKER_INFO,
  UPLOAD_TRACKER_IDS,
  isUploadTrackerId,
  trackerCode,
  trackerName
} from '../trackers'

describe('tracker catalog', () => {
  it('keeps tracker order, names, and codes together', () => {
    expect(UPLOAD_TRACKER_IDS).toEqual(['redacted', 'orpheus'])
    expect(TRACKER_INFO).toEqual({
      redacted: { name: 'Redacted', code: 'RED' },
      orpheus: { name: 'Orpheus', code: 'OPS' }
    })
    expect(UPLOAD_TRACKER_IDS.map(trackerName)).toEqual(['Redacted', 'Orpheus'])
    expect(UPLOAD_TRACKER_IDS.map(trackerCode)).toEqual(['RED', 'OPS'])
  })

  it('recognizes only catalog tracker ids', () => {
    for (const id of UPLOAD_TRACKER_IDS) expect(isUploadTrackerId(id)).toBe(true)
    expect(isUploadTrackerId('other')).toBe(false)
    expect(isUploadTrackerId(null)).toBe(false)
  })

  it('defines both tracker authentication modes once', () => {
    expect(TRACKER_AUTH_MODES).toEqual(['api', 'session'])
  })
})
