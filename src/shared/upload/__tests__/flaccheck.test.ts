import { describe, expect, it } from 'vitest'
import {
  flaccheckHiresSuspectCount,
  flaccheckSuspectCount,
  isFakeHires,
  isLikelyLossy
} from '../flaccheck'

describe('lossy vs fake hi-res helpers', () => {
  it('attributes SUSPICIOUS + PADDED_DEPTH to fake hi-res, not lossy', () => {
    const file = { path: 'a.flac', verdict: 'SUSPICIOUS' as const, hiresVerdict: 'PADDED_DEPTH' as const }
    expect(isFakeHires(file)).toBe(true)
    expect(isLikelyLossy(file)).toBe(false)
  })

  it('treats TRANSCODED as lossy even with fake hi-res', () => {
    const file = { path: 'a.flac', verdict: 'TRANSCODED' as const, hiresVerdict: 'UPSAMPLED' as const }
    expect(isFakeHires(file)).toBe(true)
    expect(isLikelyLossy(file)).toBe(true)
  })

  it('treats SUSPICIOUS with clean hi-res as lossy', () => {
    const file = { path: 'a.flac', verdict: 'SUSPICIOUS' as const, hiresVerdict: 'UNKNOWN' as const }
    expect(isFakeHires(file)).toBe(false)
    expect(isLikelyLossy(file)).toBe(true)
  })
})

describe('flaccheck counts', () => {
  it('counts lossy and fake hi-res separately', () => {
    const flaccheck = {
      status: 'ok' as const,
      checkedCount: 4,
      files: [
        { path: 'a.flac', verdict: 'TRANSCODED' as const, hiresVerdict: 'UNKNOWN' as const },
        { path: 'b.flac', verdict: 'SUSPICIOUS' as const, hiresVerdict: 'UNKNOWN' as const },
        { path: 'c.flac', verdict: 'SUSPICIOUS' as const, hiresVerdict: 'PADDED_DEPTH' as const },
        { path: 'd.flac', verdict: 'GENUINE' as const, hiresVerdict: 'UPSAMPLED' as const }
      ]
    }
    expect(flaccheckSuspectCount(flaccheck)).toBe(2)
    expect(flaccheckHiresSuspectCount(flaccheck)).toBe(2)
  })

  it('treats a missing summary as zero suspects', () => {
    expect(flaccheckSuspectCount(undefined)).toBe(0)
    expect(flaccheckHiresSuspectCount(undefined)).toBe(0)
  })
})
