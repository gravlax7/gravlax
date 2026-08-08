import type { UploadArtist } from '@shared/types'
import { normalizeArtistRole } from '@shared/tags/editor'

// Gazelle's own ordering, which is not ARTIST_ROLE_PRESETS' ordering — the
// presets list is the order the tag editor cycles through, these are the
// numbers the tracker's upload form expects.
export const MAIN_ARTIST_IMPORTANCE = 1

export const ARTIST_IMPORTANCE: Record<string, number> = {
  main: MAIN_ARTIST_IMPORTANCE,
  guest: 2,
  remixer: 3,
  composer: 4,
  conductor: 5,
  'dj/compiler': 6,
  producer: 7,
  arranger: 8
}

const ROLE_BY_IMPORTANCE = new Map(
  Object.entries(ARTIST_IMPORTANCE).map(([role, importance]) => [importance, role])
)

export function artistRoleToImportance(role: string | undefined): number {
  const normalized = normalizeArtistRole(role ?? '')
  return ARTIST_IMPORTANCE[normalized] ?? MAIN_ARTIST_IMPORTANCE
}

export function importanceToArtistRole(importance: number): string {
  return ROLE_BY_IMPORTANCE.get(importance) ?? 'main'
}

export function isNamedMainArtist(artist: UploadArtist): boolean {
  return artist.importance === MAIN_ARTIST_IMPORTANCE && artist.name.trim().length > 0
}
