import type { AudioTrackProfile, FileChecksSnapshot } from '../../types/upload'

const MAX_BIT_DEPTH = 24
const ALLOWED_RATES = [44_100, 48_000, 88_200, 96_000, 176_400, 192_000]
const MIN_KBPS = 192

/** Each finding breaks a rule and blocks the upload. */
export interface AudioLimitFinding {
  headline: string
  detail: string
  tracks: string[]
}

function trackKbps(track: Pick<AudioTrackProfile, 'audioBytes' | 'durationSeconds'>): number {
  return (track.audioBytes * 8) / track.durationSeconds / 1000
}

export function audioLimitFindings(fileChecks: FileChecksSnapshot): AudioLimitFinding[] {
  const tracks = fileChecks.audio.tracks
  const findings: AudioLimitFinding[] = []

  const deep = tracks.filter((track) => track.bitDepth > MAX_BIT_DEPTH)
  if (deep.length > 0) {
    findings.push({
      headline: `Bit depth above 24-bit (${deep.length})`,
      detail: 'FLAC files may be at most 24-bit. Convert these files to 24-bit and load the folder again.',
      tracks: deep.map((track) => `${track.relativePath} (${track.bitDepth}-bit)`)
    })
  }

  const odd = tracks.filter((track) => !ALLOWED_RATES.includes(track.sampleRate))
  if (odd.length > 0) {
    findings.push({
      headline: `Sample rate not allowed (${odd.length})`,
      detail:
        'Allowed rates are 44.1, 48, 88.2, 96, 176.4 and 192 kHz. Resample these files and ' +
        'load the folder again.',
      tracks: odd.map((track) => `${track.relativePath} (${track.sampleRate / 1000} kHz)`)
    })
  }

  // Sessions saved before these fields existed read 0; skip them.
  const timed = tracks.filter((track) => track.durationSeconds > 0 && track.audioBytes > 0)
  const seconds = timed.reduce((total, track) => total + track.durationSeconds, 0)
  const bytes = timed.reduce((total, track) => total + track.audioBytes, 0)
  const average = seconds > 0 ? trackKbps({ audioBytes: bytes, durationSeconds: seconds }) : Infinity
  if (average < MIN_KBPS) {
    const low = timed.filter((track) => trackKbps(track) < MIN_KBPS)
    findings.push({
      headline: `Average bitrate ${Math.floor(average)} kbps`,
      detail: `A release must average at least ${MIN_KBPS} kbps.`,
      tracks: low.map((track) => `${track.relativePath} (${Math.floor(trackKbps(track))} kbps)`)
    })
  }

  // The integrity repair re-encodes with our own flac, which changes the vendor.
  const repaired = new Set(fileChecks.integrity.repairedPaths)
  const vendors = new Map<string, string[]>()
  for (const track of tracks) {
    if (!track.vendor || repaired.has(track.relativePath)) continue
    vendors.set(track.vendor, [...(vendors.get(track.vendor) ?? []), track.relativePath])
  }
  if (vendors.size > 1) {
    findings.push({
      headline: `${vendors.size} encoders in one release`,
      detail:
        'All files in a release must come from one encoder with the same settings. Encode ' +
        'them all again with one encoder and load the folder again.',
      tracks: [...vendors].map(([vendor, list]) => `${vendor}: ${list.length} file${list.length === 1 ? '' : 's'}`)
    })
  }
  return findings
}

export function audioLimitsDetail(fileChecks: FileChecksSnapshot): string {
  return audioLimitFindings(fileChecks)
    .flatMap((finding) => [
      `${finding.headline}. ${finding.detail}`,
      ...finding.tracks.map((track) => `- ${track}`)
    ])
    .join('\n')
}
