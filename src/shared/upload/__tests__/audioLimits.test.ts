import { describe, expect, it } from 'vitest'
import type { AudioTrackProfile, FileChecksSnapshot } from '../../types/upload'
import { audioLimitFindings, fileChecksBlocker } from '../fileChecks'

// 1411 kbps: 16-bit stereo 44.1 kHz PCM for 60 s.
function track(overrides: Partial<AudioTrackProfile> = {}): AudioTrackProfile {
  return {
    relativePath: '01.flac',
    bitDepth: 16,
    sampleRate: 44_100,
    channels: 2,
    durationSeconds: 60,
    audioBytes: 10_584_000,
    vendor: 'reference libFLAC 1.4.3 20230623',
    ...overrides
  }
}

function snapshot(tracks: AudioTrackProfile[], repairedPaths: string[] = []): FileChecksSnapshot {
  return {
    status: 'ok',
    structure: { ready: true, issues: [], approvedPaths: [], emptyDirectories: [], quarantined: [] },
    audio: { tracks, highestBitDepth: 0, highestSampleRate: 0, mixedBitDepth: false, mixedSampleRate: false },
    integrity: { status: 'passed', checkedCount: tracks.length, failures: [], repairedPaths, repairErrors: [] },
    mqa: { checkedCount: 0, mqaPaths: [], errors: [] },
    upconvert: { checkedCount: 0, results: [], errors: [] },
    logs: { logFiles: [], checks: [] }
  }
}

const headlines = (tracks: AudioTrackProfile[], repaired?: string[]) =>
  audioLimitFindings(snapshot(tracks, repaired)).map((finding) => finding.headline)

describe('audio limits', () => {
  it('passes a normal release', () => {
    expect(headlines([track(), track({ relativePath: '02.flac' })])).toEqual([])
  })

  it.each([
    [16, false],
    [24, false],
    [32, true]
  ])('blocks only above 24-bit: %i-bit', (bitDepth, blocked) => {
    const state = snapshot([track({ bitDepth })])
    expect(fileChecksBlocker(state)).toBe(blocked ? audioLimitFindings(state)[0]!.detail : null)
  })

  it.each([
    [44_100, true],
    [48_000, true],
    [88_200, true],
    [96_000, true],
    [176_400, true],
    [192_000, true],
    [32_000, false],
    [64_000, false],
    [352_800, false],
    [384_000, false]
  ])('allows the six sample rates: %i Hz', (sampleRate, allowed) => {
    expect(headlines([track({ sampleRate })])).toEqual(allowed ? [] : ['Sample rate not allowed (1)'])
  })

  it('warns when the release averages under 192 kbps and lists the low tracks', () => {
    // 192 kbps for 60 s is 1,440,000 bytes.
    const loud = track({ audioBytes: 1_440_000 })
    expect(headlines([loud])).toEqual([])
    const quiet = track({ relativePath: '02.flac', audioBytes: 1_439_000 })
    expect(audioLimitFindings(snapshot([quiet]))[0]).toMatchObject({
      headline: 'Average bitrate 191 kbps',
      tracks: ['02.flac (191 kbps)']
    })
  })

  it('judges bitrate over the whole release, not per track', () => {
    const silent = track({ relativePath: '02.flac', audioBytes: 100_000 })
    expect(headlines([track(), silent])).toEqual([])
  })

  it('skips tracks saved before durations were recorded', () => {
    expect(headlines([track({ durationSeconds: 0, audioBytes: 0, vendor: '' })])).toEqual([])
  })

  it('warns on more than one encoder, ignoring files the repair re-encoded', () => {
    const other = track({ relativePath: '02.flac', vendor: 'reference libFLAC 1.2.1 20070917' })
    expect(headlines([track(), other])).toEqual(['2 encoders in one release'])
    expect(headlines([track(), other], ['02.flac'])).toEqual([])
  })

  it.each([
    ['rate', track({ sampleRate: 32_000 }), /^Allowed rates/],
    ['bitrate', track({ audioBytes: 1_000 }), /^A release must average/],
    ['encoder', track({ vendor: 'other' }), /^All files in a release/]
  ])('blocks the upload on a %s finding', (_name, odd, message) => {
    expect(fileChecksBlocker(snapshot([odd, track({ relativePath: '02.flac', audioBytes: 1_000 })])))
      .toMatch(message)
  })
})
