import { describe, expect, it } from 'vitest'
import { audioProfileIsMixed, summarizeAudioTracks } from '../../audioProfile'

describe('audio profiles', () => {
  it('finds mixed properties and their highest values', () => {
    const profile = summarizeAudioTracks([
      { relativePath: '01.flac', bitDepth: 16, sampleRate: 192000 },
      { relativePath: '02.flac', bitDepth: 24, sampleRate: 44100 }
    ])
    expect(profile).toMatchObject({
      highestBitDepth: 24,
      highestSampleRate: 192000,
      mixedBitDepth: true,
      mixedSampleRate: true
    })
    expect(audioProfileIsMixed(profile)).toBe(true)
  })

  it('reports uniform settings without a warning flag', () => {
    const profile = summarizeAudioTracks([
      { relativePath: '01.flac', bitDepth: 24, sampleRate: 96000 },
      { relativePath: '02.flac', bitDepth: 24, sampleRate: 96000 }
    ])
    expect(profile).toMatchObject({ mixedBitDepth: false, mixedSampleRate: false })
    expect(audioProfileIsMixed(profile)).toBe(false)
  })
})
