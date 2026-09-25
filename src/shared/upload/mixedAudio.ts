import type { ReleaseAudioProfile, SourceMedia, UploadTrackerId } from '../types/upload'

export function isMixedAudio(profile: ReleaseAudioProfile | undefined): boolean {
  return Boolean(profile?.mixedBitDepth || profile?.mixedSampleRate)
}

export function mixedWebTrackerGuidance(
  sourceMedia: SourceMedia | '',
  profile: ReleaseAudioProfile | undefined,
  trackerIds: readonly UploadTrackerId[]
): string | null {
  if (sourceMedia !== 'WEB' || !isMixedAudio(profile)) return null
  const red = trackerIds.includes('redacted')
  const ops = trackerIds.includes('orpheus')
  if (red && ops) {
    return 'Keep the retailer receipt and album information for RED. Submit that proof directly in a lossy master approval request report on OPS, including for a FLAC-only hybrid release. Use Gravlax’s lossy-master report only for an actual lossy master. Gravlax cannot verify the proof, report, or approval.'
  }
  if (red) {
    return 'Keep the retailer receipt and album information showing that the mixed files came from the retailer. RED staff may request them. Gravlax cannot verify this proof.'
  }
  if (ops) {
    return 'Submit proof that the retailer supplied the mixed files directly in a lossy master approval request report on OPS, including for a FLAC-only hybrid release. Gravlax cannot verify the proof, report, or approval.'
  }
  return null
}
