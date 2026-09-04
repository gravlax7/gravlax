import type { Release, Track } from '@shared/types'
import { uniqueStringsStable } from './editor'
import { metadataDate } from './dates'

export const TAG_ALIASES = {
  ALBUM: ['ALBUM'],
  EDITIONTITLE: ['EDITIONTITLE', 'EDITION TITLE', 'EDITION'],
  ALBUMARTIST: ['ALBUMARTIST', 'ALBUM ARTIST'],
  ALBUMARTISTS: ['ALBUMARTISTS', 'ALBUM ARTISTS'],
  ORIGINALDATE: ['ORIGINALDATE', 'ORIGINAL DATE', 'ORIGINALYEAR', 'ORIGINAL YEAR'],
  DATE: ['DATE', 'YEAR'],
  LABEL: ['LABEL', 'RECORDLABEL', 'ORGANIZATION'],
  CATALOGNUMBER: ['CATALOGNUMBER', 'CATALOG NUMBER', 'CATNO', 'LABELNO', 'CATALOG #'],
  UPC: ['UPC', 'BARCODE'],
  BARCODE: ['BARCODE', 'UPC'],
  GENRE: ['GENRE'],
  RELEASETYPE: ['RELEASETYPE', 'RELEASE TYPE'],
  COMMENT: ['COMMENT', 'DESCRIPTION'],
  TITLE: ['TITLE'],
  ARTIST: ['ARTIST'],
  ARTISTS: ['ARTISTS'],
  COMPOSER: ['COMPOSER'],
  CONDUCTOR: ['CONDUCTOR'],
  REMIXER: ['REMIXER', 'MIXARTIST'],
  DJMIXER: ['DJMIXER', 'DJ MIXER'],
  PRODUCER: ['PRODUCER'],
  ARRANGER: ['ARRANGER'],
  TRACKNUMBER: ['TRACKNUMBER', 'TRACK NUMBER'],
  DISCNUMBER: ['DISCNUMBER', 'DISC NUMBER'],
  TRACKTOTAL: ['TRACKTOTAL', 'TOTALTRACKS', 'TOTAL TRACKS'],
  DISCTOTAL: ['DISCTOTAL', 'TOTALDISCS', 'TOTAL DISCS']
} as const

type ManagedTagKey = keyof typeof TAG_ALIASES

function aliasesFor(key: string): readonly string[] {
  return TAG_ALIASES[key as ManagedTagKey] ?? [key]
}

const MANAGED_TAG_ORDER = [
  'ALBUM',
  'EDITIONTITLE',
  'ALBUMARTIST',
  'ALBUMARTISTS',
  'ORIGINALDATE',
  'DATE',
  'LABEL',
  'CATALOGNUMBER',
  'BARCODE',
  'UPC',
  'GENRE',
  'RELEASETYPE',
  'COMMENT',
  'TITLE',
  'ARTIST',
  'ARTISTS',
  'COMPOSER',
  'CONDUCTOR',
  'REMIXER',
  'DJMIXER',
  'PRODUCER',
  'ARRANGER',
  'TRACKNUMBER',
  'DISCNUMBER',
  'TRACKTOTAL',
  'DISCTOTAL'
] as const

export function managedRemovalKeys(): string[] {
  const keys = new Set<string>()
  for (const aliases of Object.values(TAG_ALIASES)) {
    for (const alias of aliases) keys.add(alias)
  }
  return [...keys]
}

let removalSet: Set<string> | undefined
function managedRemovalKeySet(): Set<string> {
  removalSet ??= new Set(managedRemovalKeys())
  return removalSet
}

export function discTrackTotal(tracks: readonly Track[], discNumber: string): number {
  const disc = normalizeDisc(discNumber)
  let total = 0
  for (const track of tracks) {
    if (normalizeDisc(track.discNumber) === disc) total += 1
  }
  return total
}

export function releaseDiscTotal(tracks: readonly Track[]): number {
  const discs = new Set(tracks.map((track) => normalizeDisc(track.discNumber)))
  return Math.max(1, discs.size)
}

export function firstAliasValue(tags: Record<string, string[]>, key: string): string {
  for (const alias of aliasesFor(key)) {
    for (const value of tags[alias] ?? []) {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
  }
  return ''
}

export function mergeAliasValues(tags: Record<string, string[]>, key: string): string[] {
  const values: string[] = []
  const seen = new Set<string>()
  for (const alias of aliasesFor(key)) {
    for (const value of tags[alias] ?? []) {
      const trimmed = value.trim()
      if (!trimmed) continue
      const fold = trimmed.toLowerCase()
      if (seen.has(fold)) continue
      seen.add(fold)
      values.push(trimmed)
    }
  }
  return values
}

function uniqueArtistNames(artists: Release['artists'], role: string): string[] {
  return uniqueStringsStable(
    (artists ?? [])
      .filter((artist) => (artist.role || 'main') === role)
      .map((artist) => artist.name ?? '')
  )
}

function joinArtistNames(names: string[]): string {
  const separator = names.length > 2 && !names.some((name) => name.includes('&')) ? ', ' : ' & '
  return names.join(separator)
}

export function trackArtistValue(artists: Release['artists']): string {
  const main = uniqueArtistNames(artists, 'main')
  const conductors = uniqueArtistNames(artists, 'conductor')
  const lead = uniqueStringsStable([...main, ...conductors])
  let value = conductors.length > 0 ? lead.join(', ') : joinArtistNames(lead)
  const guests = uniqueArtistNames(artists, 'guest')
  if (guests.length >= 4) value += ' (feat. Various)'
  else if (guests.length > 0) value += ` (feat. ${joinArtistNames(guests)})`
  return value
}

export function managedTagProjection(release: Release, trackIndex: number): Map<string, string[]> {
  const tracks = release.tracks ?? []
  const track = tracks[trackIndex] ?? {}
  const discNumber = (track.discNumber ?? '').trim() || '1'
  const originalDate = metadataDate(release.groupYear)
  const editionDate = metadataDate(release.year)
  const date = editionDate || originalDate
  const original = originalDate || date
  const barcode = (release.upc ?? '').trim()
  const albumArtists = uniqueArtistNames(release.artists, 'main')
  const values = new Map<string, string[]>([
    ['ALBUM', one(release.title)],
    ['EDITIONTITLE', one(release.editionTitle)],
    ['ALBUMARTIST', one(release.albumArtist)],
    ['ALBUMARTISTS', albumArtists.length > 0 ? albumArtists : one(release.albumArtist)],
    ['ORIGINALDATE', one(original)],
    ['DATE', one(date)],
    ['LABEL', one(release.label)],
    ['CATALOGNUMBER', one(release.catNo)],
    ['BARCODE', one(barcode)],
    ['UPC', one(barcode)],
    ['GENRE', one(joinGenres(release.genres))],
    ['RELEASETYPE', one(release.releaseType)],
    ['COMMENT', one(release.comment)],
    ['TITLE', one(track.title)],
    ['ARTIST', one(trackArtistValue(track.artists))],
    ['ARTISTS', uniqueArtistNames(track.artists, 'main')],
    ['COMPOSER', uniqueArtistNames(track.artists, 'composer')],
    ['CONDUCTOR', uniqueArtistNames(track.artists, 'conductor')],
    ['REMIXER', uniqueArtistNames(track.artists, 'remixer')],
    ['DJMIXER', uniqueArtistNames(track.artists, 'dj/compiler')],
    ['PRODUCER', uniqueArtistNames(track.artists, 'producer')],
    ['ARRANGER', uniqueArtistNames(track.artists, 'arranger')],
    ['TRACKNUMBER', one(track.trackNumber)],
    ['DISCNUMBER', one(discNumber)],
    ['TRACKTOTAL', one(String(discTrackTotal(tracks, discNumber)))],
    ['DISCTOTAL', one(String(releaseDiscTotal(tracks)))]
  ])
  return cleanValues(values)
}

export function combineManagedAndSourceTags(
  source: Record<string, string[]>,
  managed: Map<string, string[]>
): Record<string, string[]> {
  const combined: Record<string, string[]> = {}
  const drop = managedRemovalKeySet()
  for (const [key, values] of Object.entries(source)) {
    const upper = key.trim().toUpperCase()
    if (!upper || drop.has(upper)) continue
    combined[upper] = [...values]
  }
  for (const [key, values] of managed) {
    combined[key] = [...values]
  }
  return orderedTagRecord(combined)
}

export function dropTranscodeOnlyTags(
  tags: Record<string, string[]>
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(tags)) {
    const upper = key.trim().toUpperCase()
    if (isTranscodeDroppedTag(upper)) continue
    result[upper] = [...values]
  }
  return result
}

export function isTranscodeDroppedTag(key: string): boolean {
  const upper = key.trim().toUpperCase()
  return upper.startsWith('REPLAYGAIN') || upper === 'ENCODER'
}

function orderedTagRecord(tags: Record<string, string[]>): Record<string, string[]> {
  const ordered: Record<string, string[]> = {}
  for (const key of MANAGED_TAG_ORDER) {
    if (key in tags) ordered[key] = tags[key]!
  }
  for (const key of Object.keys(tags).sort()) {
    if (key in ordered) continue
    ordered[key] = tags[key]!
  }
  return ordered
}

function joinGenres(genres: string[] | undefined): string {
  return uniqueStringsStable([...(genres ?? [])])
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .join('; ')
}

function one(value?: string): string[] {
  const trimmed = (value ?? '').trim()
  return trimmed ? [trimmed] : []
}

function cleanValues(values: Map<string, string[]>): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const key of MANAGED_TAG_ORDER) {
    const items = (values.get(key) ?? [])
      .map((item) => item.normalize('NFC'))
      .filter((item) => item !== '')
    if (items.length > 0) result.set(key, items)
  }
  return result
}

function normalizeDisc(value: string | undefined): string {
  return (value ?? '').trim() || '1'
}
