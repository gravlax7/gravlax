import type { Provider, ReleaseResult } from './base'
import type { Artist, Release } from '@shared/types'
import {
  applyFeaturedArtistsFromTitle,
  normalizeArtistRole,
  parseArtistCreditValues,
  stripFeaturedFromTitle
} from '@shared/tags/editor'
import {
  formatResult,
  isPlainProviderURL,
  mapValue,
  parseCopyrightLabel,
  parseYear,
  releaseIDFromRawURL,
  sliceValue,
  toString
} from './base'
import { fetchJSON, fetchText } from './http'
import { mapReleaseTypeToken } from './normalization'

export const DEEZER_NAME = 'Deezer'
const DEEZER_API = 'https://api.deezer.com'
const DEEZER_SITE = 'https://www.deezer.com'
const DEEZER_LOCALE = /^[a-z]{2}(?:-[a-z]{2})?$/i

interface DeezerSearchResponse {
  data?: Array<{
    id?: number | string
    title?: string
    nb_tracks?: number
    artist?: { name?: string }
  }>
}

export function createDeezerProvider(timeoutMs: number): Provider {
  return {
    name: DEEZER_NAME,
    releaseIDFromURL: deezerReleaseIDFromURL,
    async healthcheck(signal) {
      await fetchJSON(`${DEEZER_API}/search/album`, {
        query: { q: 'test' },
        signal,
        timeoutMs
      })
    },
    async searchReleases(search, limit, signal) {
      const response = await fetchJSON<DeezerSearchResponse>(`${DEEZER_API}/search/album`, {
        query: { q: search },
        signal,
        timeoutMs
      })
      const results: ReleaseResult[] = []
      for (const release of response.data ?? []) {
        const artists = toString(release.artist?.name)
        const title = toString(release.title)
        const trackCount = Number(release.nb_tracks ?? 0) || undefined
        results.push({
          id: release.id,
          ident: {
            artist: artists,
            album: title,
            trackCount,
            source: 'WEB'
          },
          display: formatResult(artists, title, '', { trackCount })
        })
        if (results.length === limit) break
      }
      return results
    },
    async fetchData(releaseURL, releaseID, signal) {
      const id = resolveDeezerID(releaseURL, releaseID)
      if (!id) throw new Error('invalid Deezer URL')
      const album = await fetchJSON<Record<string, unknown>>(`${DEEZER_API}/album/${id}`, {
        signal,
        timeoutMs
      })
      try {
        const internal = await scrapeDeezerInternal(id, timeoutMs, signal)
        const songs = mapValue(internal.SONGS).data
        if (songs != null) album.tracklist = songs
        const picture = toString(mapValue(internal.DATA).ALB_PICTURE)
        if (picture) {
          album.cover_xl = `https://e-cdns-images.dzcdn.net/images/cover/${picture}/1000x1000-000000-100-0-0.jpg`
        }
      } catch {
        /* public album payload is enough for search selection */
      }
      return album
    },
    mapRelease: mapDeezerRelease,
    formatURL(releaseID, _releaseName, rawURL) {
      if (rawURL) return rawURL
      return `${DEEZER_SITE}/album/${toString(releaseID)}`
    }
  }
}

function mapDeezerRelease(raw: Record<string, unknown>, url: string): Release {
  const rawTitle = toString(raw.title ?? raw.name)
  const title = stripFeaturedFromTitle(rawTitle) || rawTitle
  const artists = deezerArtists(raw)
  const year = parseYear(toString(raw.release_date ?? raw.year))
  const labelValue =
    typeof raw.label === 'string' || typeof raw.label === 'number'
      ? toString(raw.label)
      : toString(mapValue(raw.label).name)
  const label = parseCopyrightLabel(labelValue) || labelValue
  const upc = toString(raw.upc)
  const tracks = mapDeezerTracks(raw)

  return {
    title,
    artists,
    year: year ? String(year) : undefined,
    groupYear: year ? String(year) : undefined,
    label,
    catNo: toString(raw.catno ?? raw.catalog_number),
    upc,
    genres: deezerStrings(raw.genres ?? raw.genre),
    releaseType: mapReleaseTypeToken(toString(raw.record_type ?? raw.type)) || undefined,
    cover: toString(raw.cover_xl ?? raw.cover) || undefined,
    urls: url ? [url] : undefined,
    trackCount: tracks.length || Number(raw.track_count ?? 0) || undefined,
    tracks,
    comment: DEEZER_NAME
  }
}

function mapDeezerTracks(raw: Record<string, unknown>): NonNullable<Release['tracks']> {
  const tracks: NonNullable<Release['tracks']> = []
  deezerList(raw.tracklist ?? raw.tracks).forEach((track, index) => {
    const mapped = mapValue(track)
    tracks.push(
      applyFeaturedArtistsFromTitle({
        discNumber: toString(mapped.DISK_NUMBER ?? mapped.disk_number) || '1',
        trackNumber:
          toString(mapped.TRACK_NUMBER ?? mapped.track_number ?? mapped.track_position) ||
          String(index + 1),
        title: deezerTrackTitle(mapped),
        artists: deezerArtists(mapped)
      })
    )
  })
  return tracks
}

function deezerArtists(raw: Record<string, unknown>): Artist[] {
  const internal = deezerInternalArtists(raw)
  if (internal.length > 0) return internal

  for (const value of [raw.contributors, raw.artists, raw.artist]) {
    const entries = Array.isArray(value) ? value : value == null ? [] : [value]
    const artists = mapDeezerPublicArtists(entries)
    if (artists.length > 0) return artists
  }
  return []
}

function deezerInternalArtists(raw: Record<string, unknown>): Artist[] {
  const contributors = mapValue(raw.SNG_CONTRIBUTORS)
  const hasContributors = Object.keys(contributors).length > 0
  const defaultArtists = sliceValue(raw.ARTISTS)
  if (!hasContributors && defaultArtists.length === 0) return []

  const artists: Artist[] = []
  const seen = new Set<string>()
  const push = (name: string, role: string): void => {
    for (const artist of parseArtistCreditValues([name])) {
      const resolvedRole = role === 'guest' ? 'guest' : deezerArtistRole(artist.role ?? role)
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
      ...deezerStrings(contributors.mainartist),
      ...deezerStrings(contributors.main_artist)
    ]) {
      push(name, 'main')
    }
    for (const name of [
      ...deezerStrings(contributors.featuredartist),
      ...deezerStrings(contributors.featuring)
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

function mapDeezerPublicArtists(entries: unknown[]): Artist[] {
  const artists: Artist[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      for (const parsed of parseArtistCreditValues([toString(entry)])) {
        pushDeezerArtist(artists, seen, parsed.name ?? '', parsed.role ?? '')
      }
      continue
    }
    const mapped = mapValue(entry)
    pushDeezerArtist(artists, seen, toString(mapped.name), toString(mapped.role))
  }
  return artists
}

function pushDeezerArtist(
  artists: Artist[],
  seen: Set<string>,
  name: string,
  role: string
): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const normalizedRole = deezerArtistRole(role)
  const key = `${trimmed.toLowerCase()}\0${normalizedRole}`
  if (seen.has(key)) return
  seen.add(key)
  artists.push({ name: trimmed, role: normalizedRole })
}

function deezerArtistRole(role: string): string {
  const normalized = role.trim().toLowerCase()
  if (!normalized || normalized === 'main' || normalized === 'primary') return 'main'
  if (['featured', 'featuring', 'feat', 'ft', 'ft.'].includes(normalized)) return 'guest'
  return normalizeArtistRole(normalized)
}

function deezerStrings(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [toString(value)]
  return deezerList(value)
    .map((entry) =>
      typeof entry === 'string' || typeof entry === 'number'
        ? toString(entry)
        : toString(mapValue(entry).name)
    )
    .filter(Boolean)
}

function deezerList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const mapped = mapValue(value)
  return Array.isArray(mapped.data) ? mapped.data : []
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

function resolveDeezerID(releaseURL: string, releaseID: unknown): string {
  const direct = toString(releaseID)
  if (direct) return direct
  return releaseIDFromRawURL(releaseURL, deezerReleaseIDFromURL)
}

function deezerReleaseIDFromURL(url: URL): string | null {
  if (!isPlainProviderURL(url, ['deezer.com', 'www.deezer.com'])) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length === 3 && DEEZER_LOCALE.test(parts[0] ?? '')) parts.shift()
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'album') return null
  return /^[1-9]\d*$/.test(parts[1] ?? '') ? parts[1]! : null
}

async function scrapeDeezerInternal(
  id: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const page = await fetchText(`${DEEZER_SITE}/album/${id}`, {
    headers: {
      'Content-Language': 'en-US',
      'Cache-Control': 'max-age=0',
      Accept: '*/*',
      'Accept-Charset': 'utf-8,ISO-8859-1;q=0.7,*;q=0.3',
      'Accept-Language': 'en'
    },
    signal,
    timeoutMs
  })
  const match = /window\.__DZR_APP_STATE__ = ({.*?}})<\/script>/.exec(page.replace(/\n/g, ''))
  if (!match?.[1]) throw new Error('failed to scrape Deezer track data')
  let raw = match[1].replace(/{(\s*)type: +'([^']+)'/g, '{$1type: "$2"')
  raw = raw.replace(/\t+([^:]+): /g, '"$1":')
  return JSON.parse(raw) as Record<string, unknown>
}
