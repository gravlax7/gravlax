import type { UploadSnapshot, UploadTrackerId } from '@shared/types/upload'
import { isNamedMainArtist } from './artists'

export const STANDARD_RELEASE_TYPES = [
  'Album',
  'Soundtrack',
  'EP',
  'Anthology',
  'Compilation',
  'Single',
  'Live album',
  'Remix',
  'Bootleg',
  'Interview',
  'Mixtape',
  'Demo',
  'Concert Recording',
  'DJ Mix',
  'Unknown'
] as const

export const REDACTED_RELEASE_TYPES: Record<string, number> = {
  Album: 1,
  Soundtrack: 3,
  EP: 5,
  Anthology: 6,
  Compilation: 7,
  Single: 9,
  'Live album': 11,
  Remix: 13,
  Bootleg: 14,
  Interview: 15,
  Mixtape: 16,
  Demo: 17,
  'Concert Recording': 18,
  'DJ Mix': 19,
  Unknown: 21
}

export const ORPHEUS_RELEASE_TYPES: Record<string, number> = {
  Album: 1,
  Soundtrack: 3,
  EP: 5,
  Anthology: 6,
  Compilation: 7,
  Single: 9,
  Demo: 10,
  'Live album': 11,
  Split: 12,
  Remix: 13,
  Bootleg: 14,
  Interview: 15,
  Mixtape: 16,
  'DJ Mix': 17,
  'Concert Recording': 18,
  Unknown: 21
}

/**
 * The two sites disagree: OPS has Split and puts Demo at 10, RED puts Demo at
 * 17 and has no Split at all. A release type valid on one can be invalid on the
 * other, which is why this is looked up per tracker rather than once.
 */
export function releaseTypesFor(trackerId: UploadTrackerId): Record<string, number> {
  return trackerId === 'orpheus' ? ORPHEUS_RELEASE_TYPES : REDACTED_RELEASE_TYPES
}

export function releaseTypeId(trackerId: UploadTrackerId, releaseType: string): number | null {
  return releaseTypesFor(trackerId)[releaseType.trim()] ?? null
}

export function namedMainArtistCount(
  upload: Pick<UploadSnapshot, 'artists'>
): number {
  return (upload.artists ?? []).filter(isNamedMainArtist).length
}

/** Split is an Orpheus group-level choice, not a shared release type. */
export function isOrpheusSplitEligible(
  upload: Pick<UploadSnapshot, 'artists' | 'selectedTrackerIds' | 'groupIds'>
): boolean {
  if (!(upload.selectedTrackerIds ?? []).includes('orpheus')) return false
  const groupId = upload.groupIds?.orpheus
  if (typeof groupId === 'number' && Number.isFinite(groupId)) return false
  return namedMainArtistCount(upload) >= 2
}

export function effectiveReleaseType(
  upload: Pick<
    UploadSnapshot,
    'artists' | 'selectedTrackerIds' | 'groupIds' | 'releaseType' | 'orpheusSplit'
  >,
  trackerId: UploadTrackerId
): string {
  if (trackerId === 'orpheus' && upload.orpheusSplit && isOrpheusSplitEligible(upload)) {
    return 'Split'
  }
  return (upload.releaseType ?? '').trim()
}
