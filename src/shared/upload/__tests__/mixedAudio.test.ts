import { describe, expect, it } from 'vitest'
import type { ReleaseAudioProfile } from '../../types/upload'
import { mixedWebTrackerGuidance } from '../mixedAudio'

const mixed: ReleaseAudioProfile = {
  tracks: [
    { relativePath: '01.flac', bitDepth: 16, sampleRate: 44100 },
    { relativePath: '02.flac', bitDepth: 24, sampleRate: 96000 }
  ],
  highestBitDepth: 24,
  highestSampleRate: 96000,
  mixedBitDepth: true,
  mixedSampleRate: true
}

describe('mixed WEB tracker guidance', () => {
  it('explains RED proof retention', () => {
    expect(mixedWebTrackerGuidance('WEB', mixed, ['redacted'])).toContain(
      'Keep the retailer receipt and album information'
    )
  })

  it('explains direct OPS reporting', () => {
    expect(mixedWebTrackerGuidance('WEB', mixed, ['orpheus'])).toContain(
      'directly in a lossy master approval request report on OPS'
    )
  })

  it('warns about the in-app report when both trackers are selected', () => {
    const guidance = mixedWebTrackerGuidance('WEB', mixed, ['redacted', 'orpheus'])
    expect(guidance).toContain('Submit that proof directly')
    expect(guidance).toContain('Use Gravlax’s lossy-master report only for an actual lossy master')
  })

  it('stays hidden for CDs and uniform WEB releases', () => {
    expect(mixedWebTrackerGuidance('CD', mixed, ['redacted'])).toBeNull()
    expect(mixedWebTrackerGuidance('WEB', { ...mixed, mixedBitDepth: false, mixedSampleRate: false }, ['redacted'])).toBeNull()
  })
})
