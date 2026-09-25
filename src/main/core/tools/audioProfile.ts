import type { AudioTrackProfile, ReleaseAudioProfile } from '@shared/types'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'

export function summarizeAudioTracks(tracks: AudioTrackProfile[]): ReleaseAudioProfile {
  const bitDepths = new Set(tracks.map((track) => track.bitDepth))
  const sampleRates = new Set(tracks.map((track) => track.sampleRate))
  return {
    tracks: tracks.map((track) => ({ ...track })),
    highestBitDepth: Math.max(0, ...tracks.map((track) => track.bitDepth)),
    highestSampleRate: Math.max(0, ...tracks.map((track) => track.sampleRate)),
    mixedBitDepth: bitDepths.size > 1,
    mixedSampleRate: sampleRates.size > 1
  }
}

export async function gatherReleaseAudioProfile(root: string): Promise<ReleaseAudioProfile> {
  const files = await discoverFLACFiles(root)
  const tracks: AudioTrackProfile[] = []
  for (const file of files) {
    const stream = await readFLACStreamInfo(file.absolutePath)
    tracks.push({
      relativePath: file.relativePath,
      bitDepth: stream.bitsPerSample,
      sampleRate: stream.sampleRate
    })
  }
  return summarizeAudioTracks(tracks)
}

export function audioProfileIsMixed(profile: ReleaseAudioProfile): boolean {
  return profile.mixedBitDepth || profile.mixedSampleRate
}

export function audioProfileDetail(profile: ReleaseAudioProfile): string {
  if (profile.tracks.length === 0) return 'No FLAC files found for audio properties.'
  if (!audioProfileIsMixed(profile)) {
    return `${profile.highestBitDepth} bit ${(profile.highestSampleRate / 1000).toFixed(1)} kHz audio properties.`
  }
  return [
    'Mixed bit depths or sample rates found.',
    ...profile.tracks.map(
      (track) => `- ${track.relativePath}: ${track.bitDepth} bit / ${(track.sampleRate / 1000).toFixed(1)} kHz`
    )
  ].join('\n')
}
