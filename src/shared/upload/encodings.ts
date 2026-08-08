import type { Bitrate } from '@shared/types/upload'

/**
 * The name Gazelle's `bitrate` field expects for a transcode.
 *
 * Our own `Bitrate` is the lame preset — `V0` — but the sites take a fixed list
 * of encodings in which the variable ones are spelled `V0 (VBR)`. Anything off
 * that list is rejected outright, so a `V0` upload fails while the `320` beside
 * it goes through. Redacted and Orpheus share the list, so this is not per
 * tracker.
 */
export function trackerEncoding(bitrate: Bitrate): string {
  return bitrate === 'V0' ? 'V0 (VBR)' : bitrate
}
