import type { Artist, Release, Track } from '@shared/types'
import {
  deriveAlbumArtist,
  normalizeArtistRole,
  sortedUniqueStrings,
  uniqueStringsStable
} from '@shared/tags/editor'

const NONE_CATNO = new Set(['none', '[none]', '(none)', 'n/a', '[n/a]', '(n/a)'])

const RELEASE_TYPE_MAP: Record<string, string> = {
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  compilation: 'Compilation',
  anthology: 'Anthology',
  soundtrack: 'Soundtrack',
  remix: 'Remix',
  'live album': 'Live Album',
  live: 'Live Album',
  interview: 'Interview',
  'dj-mix': 'DJ Mix',
  'dj mix': 'DJ Mix',
  'mixtape/street': 'Mixtape',
  mixtape: 'Mixtape'
}

export function mapReleaseTypeToken(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ''
  return RELEASE_TYPE_MAP[normalized] ?? ''
}

export function finalizeNormalizedRelease(release: Release): Release {
  const next = { ...release }
  next.artists = mergeReleaseArtists(next.artists ?? [], next.tracks ?? [])
  if (!next.albumArtist) {
    next.albumArtist = deriveAlbumArtist(next.artists ?? [])
  }
  if (next.genres) next.genres = sortedUniqueStrings(next.genres)
  if (next.urls) next.urls = uniqueStringsStable(next.urls)
  if ((!next.trackCount || next.trackCount <= 0) && next.tracks) {
    next.trackCount = next.tracks.length
  }
  next.label = processLabel(next.label ?? '', next.artists ?? [])
  next.catNo = sanitizeCatNo(next.catNo ?? '', next.upc ?? '')
  const determined = determineReleaseType(next)
  next.title = determined.title
  next.releaseType = determined.releaseType
  return next
}

export function inferReleaseType(providerType: string, title: string, trackCount: number): string {
  const mapped = mapReleaseTypeToken(providerType)
  if (mapped) return mapped
  const tracks: Track[] = Array.from({ length: Math.max(0, trackCount) }, (_, index) => ({
    title: `Track ${index + 1}`,
    trackNumber: String(index + 1)
  }))
  return determineReleaseType({
    title,
    releaseType: providerType,
    tracks,
    artists: []
  }).releaseType
}

function sanitizeCatNo(catNo: string, upc: string): string {
  const trimmed = catNo.trim()
  if (!trimmed) return ''
  if (NONE_CATNO.has(trimmed.toLowerCase())) return ''
  if (upc && trimmed.replace(/\s/g, '') === String(upc).replace(/\s/g, '')) return ''
  return trimmed
}

function processLabel(label: string, artists: Artist[]): string {
  const trimmed = label.trim()
  if (!trimmed) return ''
  if (/(not on label|no label|self[- ]?released)/i.test(trimmed)) return 'Self-Released'
  const labelLower = trimmed.toLowerCase()
  for (const artist of artists) {
    if ((artist.role ?? 'main') !== 'main') continue
    const name = (artist.name ?? '').trim().toLowerCase()
    if (!name) continue
    if (labelLower === name || labelLower.startsWith(name)) return 'Self-Released'
  }
  return trimmed
}

function mergeReleaseArtists(existing: Artist[], tracks: Track[]): Artist[] {
  const hasReleaseMain = existing.some(
    (artist) =>
      artistNameKey(artist.name ?? '') && normalizeArtistRole(artist.role ?? '') === 'main'
  )
  const artists: Artist[] = []
  const seen = new Set<string>()
  const push = (artist: Artist, fromTrack: boolean): void => {
    const name = (artist.name ?? '').trim()
    if (!name) return
    const key = artistNameKey(name)
    if (seen.has(key)) return
    seen.add(key)
    const sourceRole = normalizeArtistRole(artist.role ?? '')
    const role = fromTrack && hasReleaseMain && sourceRole === 'main' ? 'guest' : sourceRole
    artists.push({ name, role })
  }
  for (const artist of existing) push(artist, false)
  for (const track of tracks) {
    for (const artist of track.artists ?? []) push(artist, true)
  }
  return artists
}

function artistNameKey(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function determineReleaseType(release: Release): { title: string; releaseType: string } {
  let title = release.title ?? ''
  const tracks = release.tracks ?? []
  const numTracks = tracks.length
  const baseTitles = new Set(
    tracks
      .map((track) => (track.title ?? '').replace(/\s*\(.*?\)/g, '').trim().toLowerCase())
      .filter(Boolean)
  )
  const mainArtists = (release.artists ?? []).filter((artist) => (artist.role ?? 'main') === 'main')
  const providerType = mapReleaseTypeToken(release.releaseType ?? '')
  const releaseType = (release.releaseType ?? '').toLowerCase()

  if (/\bE\.?P\.?\b/i.test(title)) {
    return {
      title: title.replace(/\bE\.?P\.?\b/gi, '').replace(/\s{2,}/g, ' ').trim(),
      releaseType: 'EP'
    }
  }
  if (/-?\s*Single$/i.test(title)) {
    return { title: title.replace(/-?\s*Single$/i, '').trim(), releaseType: 'Single' }
  }
  if (/original.*soundtrack/i.test(title)) {
    return { title, releaseType: 'Soundtrack' }
  }
  if (providerType === 'Soundtrack' || releaseType === 'soundtrack') {
    return { title, releaseType: 'Soundtrack' }
  }
  if (
    (providerType === 'Compilation' || releaseType === 'compilation') &&
    mainArtists.length <= 2
  ) {
    return { title, releaseType: 'Anthology' }
  }
  if (numTracks > 0 && (numTracks <= 3 || baseTitles.size <= 2)) {
    return { title, releaseType: 'Single' }
  }
  if (numTracks > 0 && numTracks <= 7 && (!providerType || providerType === 'EP')) {
    return { title, releaseType: 'EP' }
  }

  const remixCount = tracks.filter((track) => /(mix|remix)/i.test(track.title ?? '')).length
  if (numTracks > 0 && remixCount / numTracks >= 0.5) {
    return { title, releaseType: 'Remix' }
  }
  if (providerType && providerType !== 'Album') {
    return { title, releaseType: providerType }
  }
  if (mainArtists.length >= 6) {
    return { title, releaseType: 'Compilation' }
  }
  if (/\blive\b/i.test(title)) {
    return { title, releaseType: 'Live Album' }
  }
  return { title, releaseType: providerType || 'Album' }
}
