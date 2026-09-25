import { describe, expect, it } from 'vitest'
import type { TrackAudioInfo } from '../audioInfo'
import { deriveEncoding } from '../audioInfo'

function track(bitDepth: number, sampleRate: number): TrackAudioInfo {
  return {
    relativePath: `${bitDepth}-${sampleRate}.flac`,
    absolutePath: `/tmp/${bitDepth}-${sampleRate}.flac`,
    bitsPerSample: bitDepth,
    sampleRate,
    channels: 2,
    hasTags: true
  }
}

describe('deriveEncoding', () => {
  it('uses the highest depth and rate for mixed audio regardless of order', () => {
    expect(deriveEncoding([track(16, 192000), track(24, 44100)])).toEqual({
      encoding: '24bit Lossless',
      hybrid: true,
      sampleRate: 192000
    })
    expect(deriveEncoding([track(24, 44100), track(16, 192000)])).toEqual({
      encoding: '24bit Lossless',
      hybrid: true,
      sampleRate: 192000
    })
  })
})
