import type { Config } from '@shared/types/config'
import type { Artist, Release, Track } from '@shared/types'
import {
  applyFeaturedArtistsFromTitle,
  deriveAlbumArtist,
  joinphraseIndicatesFeatured,
  normalizeArtistRole,
  parseArtistCreditValues,
  sortedUniqueStrings,
  stripFeaturedFromTitle,
  uniqueStringsStable
} from '@shared/tags/editor'
import { createProviders } from './providers'
import { deserializeReleaseID } from './search'
import { mapValue, parseCopyrightLabel, parseYear, sliceValue, toString } from './base'

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

const SECONDARY_TYPE_PRIORITY = [
  'live',
  'compilation',
  'soundtrack',
  'remix',
  'dj-mix',
  'mixtape/street',
  'interview'
]

export async function fetchNormalizedRelease(
  cfg: Config,
  providerName: string,
  releaseID: string,
  releaseURL: string,
  signal?: AbortSignal
): Promise<Release> {
  const provider = createProviders(cfg).find((p) => p.name === providerName)
  if (!provider) {
    throw new Error(`unknown provider ${providerName}`)
  }
  const id = deserializeReleaseID(releaseID)
  const raw = await provider.fetchData(releaseURL, id, signal)
  return normalizeProviderRelease(raw, providerName, releaseURL)
}

export function normalizeProviderRelease(
  raw: Record<string, unknown>,
  provider: string,
  url: string
): Release {
  return finalizeNormalizedRelease(normalizeGeneric(raw, provider, url))
}

function normalizeGeneric(raw: Record<string, unknown>, provider: string, url: string): Release {
  const rawTitle = toString(raw.title ?? raw.name ?? mapValue(raw.release).title)
  const title = stripFeaturedFromTitle(rawTitle) || rawTitle
  const artists = extractArtists(raw)
  const releaseGroup = mapValue(raw['release-group'])
  const year =
    parseYear(toString(raw.date ?? raw.year ?? raw.release_date ?? '')) ??
    (Number(raw.year) || undefined)
  const groupYear =
    parseYear(toString(releaseGroup['first-release-date'] ?? '')) ?? year
  const genres = extractStrings(raw.genres ?? raw.genre)
  const tracks = extractTracks(raw)
  const labelInfo = sliceValue(raw['label-info']).map(mapValue)
  const labelFromInfo = toString(mapValue(labelInfo[0]?.label).name)
  const catNoFromInfo = toString(labelInfo[0]?.['catalog-number'])
  const labelDirect =
    typeof raw.label === 'string' || typeof raw.label === 'number'
      ? toString(raw.label)
      : toString(mapValue(raw.label).name)
  const label =
    (typeof raw.label === 'string' ? parseCopyrightLabel(labelDirect) || labelDirect : labelDirect) ||
    labelFromInfo
  const upc = toString(raw.upc ?? raw.barcode)
  const catNo = sanitizeCatNo(
    toString(raw.catno ?? raw.catalog_number ?? raw['catalog-number']) || catNoFromInfo,
    upc
  )
  const providerType = extractProviderReleaseType(raw)
  const cover = extractCoverUrl(raw, provider)
  return {
    title,
    artists,
    albumArtist: deriveAlbumArtist(artists ?? []),
    year: year ? String(year) : undefined,
    groupYear: groupYear ? String(groupYear) : undefined,
    label,
    catNo,
    upc,
    genres,
    releaseType: providerType || undefined,
    cover: cover || undefined,
    urls: url ? [url] : undefined,
    trackCount: tracks.length || Number(raw.track_count ?? raw['track-count'] ?? 0) || undefined,
    tracks,
    comment: provider
  }
}

function extractCoverUrl(raw: Record<string, unknown>, provider: string): string {
  const deezerCover = toString(raw.cover_xl)
  if (deezerCover) return deezerCover

  if (provider === 'MusicBrainz' || raw['cover-art-archive'] != null) {
    const caa = mapValue(raw['cover-art-archive'])
    const front = caa.front === true || caa.front === 'true'
    const id = toString(raw.id)
    if (front && id) return `https://coverartarchive.org/release/${id}/front`
  }

  return toString(raw.cover)
}

function extractProviderReleaseType(raw: Record<string, unknown>): string {
  const recordType = toString(raw.record_type)
  if (recordType) return mapReleaseTypeToken(recordType)

  const releaseGroup = mapValue(raw['release-group'])
  for (const secondary of extractStrings(releaseGroup['secondary-types'])) {
    const key = secondary.trim().toLowerCase()
    if (SECONDARY_TYPE_PRIORITY.includes(key)) {
      return mapReleaseTypeToken(secondary)
    }
  }

  return mapReleaseTypeToken(
    toString(
      raw.type ??
        raw['primary-type'] ??
        releaseGroup['primary-type'] ??
        releaseGroup.type ??
        ''
    )
  )
}

function extractArtists(raw: Record<string, unknown>): NonNullable<Release['artists']> {
  const deezerArtists = extractDeezerArtists(raw)
  if (deezerArtists.length > 0) return deezerArtists

  const artists: NonNullable<Release['artists']> = []
  const seen = new Set<string>()

  const pushArtist = (name: string, role?: string): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    const normalizedRole = mapProviderArtistRole(role ?? '')
    const key = `${trimmed.toLowerCase()}\0${normalizedRole}`
    if (seen.has(key)) return
    seen.add(key)
    artists.push({ name: trimmed, role: normalizedRole })
  }

  let featuredFromJoinphrase = false
  for (const credit of artistCreditEntries(raw)) {
    if (typeof credit === 'string' || typeof credit === 'number') {
      for (const artist of parseArtistCreditValues([toString(credit)])) {
        pushArtist(artist.name ?? '', artist.role)
      }
      featuredFromJoinphrase = false
      continue
    }
    const c = mapValue(credit)
    const name = toString(c.name) || toString(mapValue(c.artist).name) || toString(c.ART_NAME)
    const explicitRole = toString(c.role) || featuredRoleFromAttributes(c.attributes)
    const role = explicitRole || (featuredFromJoinphrase ? 'guest' : '')
    if (name) pushArtist(name, role)
    featuredFromJoinphrase = joinphraseIndicatesFeatured(toString(c.joinphrase))
  }

  return artists
}

function extractDeezerArtists(raw: Record<string, unknown>): Artist[] {
  const contributors = mapValue(raw.SNG_CONTRIBUTORS)
  const hasContributors = Object.keys(contributors).length > 0
  const defaultArtists = sliceValue(raw.ARTISTS)
  if (!hasContributors && defaultArtists.length === 0) return []

  const artists: Artist[] = []
  const seen = new Set<string>()
  const push = (name: string, role: string): void => {
    for (const artist of parseArtistCreditValues([name])) {
      const resolvedRole = role === 'guest' ? 'guest' : mapProviderArtistRole(artist.role ?? role)
      const trimmed = (artist.name ?? '').trim()
      if (!trimmed) continue
      const key = `${trimmed.toLowerCase()}\0${resolvedRole}`
      if (seen.has(key)) continue
      seen.add(key)
      artists.push({ name: trimmed, role: resolvedRole })
    }
  }

  if (hasContributors) {
    for (const name of [
      ...extractStrings(contributors.mainartist),
      ...extractStrings(contributors.main_artist)
    ]) {
      push(name, 'main')
    }
    for (const name of [
      ...extractStrings(contributors.featuredartist),
      ...extractStrings(contributors.featuring)
    ]) {
      push(name, 'guest')
    }
  } else {
    for (const entry of defaultArtists) {
      const name = toString(mapValue(entry).ART_NAME) || toString(mapValue(entry).name)
      if (name) push(name, 'main')
    }
  }

  return artists
}

function artistCreditEntries(raw: Record<string, unknown>): unknown[] {
  const preferred = raw['artist-credit'] ?? raw.artists ?? raw.contributors
  const fromPreferred = sliceValue(preferred)
  const extras = sliceValue(raw.extraartists)
  if (fromPreferred.length > 0 || extras.length > 0) {
    return [...fromPreferred, ...extras]
  }

  const artist = raw.artist
  if (artist == null) return []
  if (typeof artist === 'string' || typeof artist === 'number') {
    return [artist]
  }
  if (Array.isArray(artist)) return artist
  return [artist]
}

function featuredRoleFromAttributes(value: unknown): string {
  for (const entry of sliceValue(value)) {
    const attr = toString(entry).trim().toLowerCase()
    if (
      attr === 'guest' ||
      attr === 'featured' ||
      attr === 'featuring' ||
      attr === 'feat' ||
      attr === 'ft' ||
      attr === 'ft.'
    ) {
      return 'guest'
    }
  }
  return ''
}

function mapProviderArtistRole(role: string): string {
  const normalized = role.trim().toLowerCase()
  if (!normalized || normalized === 'primary') return normalizeArtistRole('main')
  if (
    normalized === 'featured' ||
    normalized === 'featuring' ||
    normalized === 'feat' ||
    normalized === 'ft' ||
    normalized === 'ft.'
  ) {
    return normalizeArtistRole('guest')
  }
  return normalizeArtistRole(normalized)
}

function extractStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') return [toString(value)]
  const list = asList(value)
  return list
    .map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? toString(entry) : toString(mapValue(entry).name)))
    .filter(Boolean)
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const mapped = mapValue(value)
  return Array.isArray(mapped.data) ? mapped.data : []
}

function extractTracks(raw: Record<string, unknown>): NonNullable<Release['tracks']> {
  const media = sliceValue(raw.media)
  const tracks: NonNullable<Release['tracks']> = []
  if (media.length > 0) {
    media.forEach((medium, discIndex) => {
      const m = mapValue(medium)
      const discNumber = toString(m.position) || String(discIndex + 1)
      sliceValue(m.tracks).forEach((track, trackIndex) => {
        const t = mapValue(track)
        const recording = mapValue(t.recording)
        const artists = extractArtists(t).length ? extractArtists(t) : extractArtists(recording)
        tracks.push(
          applyFeaturedArtistsFromTitle({
            discNumber,
            trackNumber: toString(t.number ?? t.position) || String(trackIndex + 1),
            title: toString(t.title ?? recording.title),
            artists
          })
        )
      })
    })
    return tracks
  }

  asList(raw.tracklist ?? raw.tracks).forEach((track, index) => {
    const t = mapValue(track)
    const title = deezerTrackTitle(t)
    const artists = extractArtists(t)
    tracks.push(
      applyFeaturedArtistsFromTitle({
        discNumber: toString(t.DISK_NUMBER ?? t.disk_number ?? t.discNumber) || '1',
        trackNumber:
          toString(t.TRACK_NUMBER ?? t.track_number ?? t.trackNumber ?? t.track_position) ||
          String(index + 1),
        title,
        artists
      })
    )
  })
  return tracks
}

function deezerTrackTitle(track: Record<string, unknown>): string {
  const base = toString(track.SNG_TITLE ?? track.title ?? track.name)
  const version = toString(track.VERSION ?? track.title_version ?? track.version).replace(
    /[()[\]]/g,
    ''
  )
  if (!version) return base
  if (!base) return version
  if (version.toLowerCase() === base.toLowerCase()) return base
  if (base.toLowerCase().includes(version.toLowerCase())) return base
  if (
    ['original mix', 'original', 'remastered', 'clean', 'album edition', 'album mix'].includes(
      version.toLowerCase()
    )
  ) {
    return base
  }
  return `${base} (${version})`
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
  const rlsType = (release.releaseType ?? '').toLowerCase()

  if (/\bE\.?P\.?\b/i.test(title)) {
    return { title: title.replace(/\bE\.?P\.?\b/gi, '').replace(/\s{2,}/g, ' ').trim(), releaseType: 'EP' }
  }
  if (/-?\s*Single$/i.test(title)) {
    return { title: title.replace(/-?\s*Single$/i, '').trim(), releaseType: 'Single' }
  }
  if (/original.*soundtrack/i.test(title)) {
    return { title, releaseType: 'Soundtrack' }
  }

  if (providerType === 'Soundtrack' || rlsType === 'soundtrack') {
    return { title, releaseType: 'Soundtrack' }
  }
  if ((providerType === 'Compilation' || rlsType === 'compilation') && mainArtists.length <= 2) {
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

function mapReleaseTypeToken(providerType: string): string {
  const normalized = providerType.trim().toLowerCase()
  if (!normalized) return ''
  return RELEASE_TYPE_MAP[normalized] ?? ''
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
