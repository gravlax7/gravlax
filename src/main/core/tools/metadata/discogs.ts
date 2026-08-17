import type { Artist, Release, Track } from '@shared/types'
import { stripFeaturedFromTitle } from '@shared/tags/editor'
import type { Provider, ReleaseResult } from './base'
import {
  formatResult,
  isPlainProviderURL,
  mapValue,
  parseYear,
  releaseIDFromRawURL,
  sliceValue,
  toString
} from './base'
import { fetchJSON } from './http'

export const DISCOGS_NAME = 'Discogs'

const DISCOGS_API = 'https://api.discogs.com'
const DISCOGS_SITE = 'https://www.discogs.com'
const DISCOGS_RELEASE_PATH =
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?release\/([1-9]\d*)(?:-[^/]*)?\/?$/i

const VALID_EDITION_TITLES = [
  'Remastered',
  'Reissue',
  'Repress',
  'Club Edition',
  'Deluxe Edition',
  'Enhanced',
  'Limited Edition',
  'Mixed',
  'Partially Mixed',
  'Promo',
  'Special Edition',
  'Mono',
  'Quadraphonic',
  'Ambisonic',
  'Unofficial Release'
] as const

const RELEASE_TYPES: Record<string, string> = {
  Album: 'Album',
  'Mini-Album': 'Album',
  EP: 'EP',
  Sampler: 'EP',
  Single: 'Single',
  'Maxi-Single': 'Single',
  Compilation: 'Compilation',
  Mixtape: 'Mixtape'
}

const ARTIST_ROLES: Record<string, string> = {
  'Composed By': 'composer',
  Producer: 'producer',
  Featuring: 'guest',
  Vocals: 'guest',
  'Featuring [Vocals]': 'guest',
  Remix: 'remixer'
}

const SOURCES: Array<[string, string]> = [
  ['Vinyl', 'Vinyl'],
  ['File', 'WEB'],
  ['CD', 'CD']
]

const VARIOUS_ARTIST_THRESHOLD = 4

interface DiscogsSearchResponse {
  results?: unknown[]
}

export function createDiscogsProvider(token: string, timeoutMs: number): Provider {
  const headers = discogsHeaders(token)
  return {
    name: DISCOGS_NAME,
    releaseIDFromURL: discogsReleaseIDFromURL,
    async healthcheck(signal) {
      await fetchJSON(`${DISCOGS_API}/database/search`, {
        query: { q: 'test', type: 'release', per_page: '1' },
        headers,
        signal,
        timeoutMs
      })
    },
    async searchReleases(search, limit, signal) {
      const response = await fetchJSON<DiscogsSearchResponse>(
        `${DISCOGS_API}/database/search`,
        {
          query: { q: search, type: 'release', per_page: '50' },
          headers,
          signal,
          timeoutMs
        }
      )
      return discogsSearchResults(response.results ?? [], limit)
    },
    async fetchData(releaseURL, releaseID, signal) {
      const id =
        toString(releaseID) || releaseIDFromRawURL(releaseURL, discogsReleaseIDFromURL)
      if (!id) throw new Error('invalid Discogs URL')
      return fetchJSON(`${DISCOGS_API}/releases/${id}`, {
        headers,
        signal,
        timeoutMs
      })
    },
    mapRelease: mapDiscogsRelease,
    formatURL(releaseID, _releaseName, rawURL) {
      if (rawURL) return rawURL
      return `${DISCOGS_SITE}/release/${toString(releaseID)}`
    }
  }
}

function mapDiscogsRelease(raw: Record<string, unknown>, url: string): Release {
  const rawTitle = toString(raw.title)
  const title = stripFeaturedFromTitle(rawTitle) || rawTitle
  const formats = sliceValue(raw.formats).map(mapValue)
  const descriptions = sliceValue(formats[0]?.descriptions).map(toString).filter(Boolean)
  const labels = sliceValue(raw.labels).map(mapValue)
  const label = sanitizeDiscogsArtist(toString(labels[0]?.name)) || 'Not On Label'
  const year = parseYear(toString(raw.year))
  const tracks = mapDiscogsTracks(raw)

  return {
    title,
    year: year ? String(year) : undefined,
    groupYear: year ? String(year) : undefined,
    editionTitle: discogsEditionTitle(descriptions),
    label,
    catNo: toString(labels[0]?.catno),
    genres: sliceValue(raw.genres).map(toString).filter(Boolean),
    releaseType: descriptions.map((value) => RELEASE_TYPES[value]).find(Boolean),
    cover: toString(mapValue(sliceValue(raw.images)[0]).resource_url) || undefined,
    urls: url ? [url] : undefined,
    trackCount: tracks.length || undefined,
    tracks,
    comment: DISCOGS_NAME
  }
}

function discogsHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const trimmed = token.trim()
  if (trimmed) headers.Authorization = `Discogs token=${trimmed}`
  return headers
}

function discogsReleaseIDFromURL(url: URL): string | null {
  if (!isPlainProviderURL(url, ['discogs.com', 'www.discogs.com'])) return null
  return DISCOGS_RELEASE_PATH.exec(url.pathname)?.[1] ?? null
}

function discogsSearchResults(results: unknown[], limit: number): ReleaseResult[] {
  const releases: ReleaseResult[] = []
  for (const raw of results) {
    const release = mapValue(raw)
    const combinedTitle = toString(release.title)
    const separator = combinedTitle.indexOf(' - ')
    const artists = separator >= 0 ? combinedTitle.slice(0, separator) : ''
    const title = separator >= 0 ? combinedTitle.slice(separator + 3) : combinedTitle
    const year = Number(release.year) || undefined
    const formats = sliceValue(release.format).map(toString).filter(Boolean)
    const source = discogsSource(formats)
    const editionTitle = [...new Set(formats)].join(', ')
    const labels = sliceValue(release.label).map(toString).filter(Boolean)
    const label = labels[0] ?? ''
    const catNo = toString(release.catno)
    const edition = [
      year,
      source,
      label && label !== 'Not On Label' ? label : 'Not On Label',
      label && label !== 'Not On Label' ? catNo : ''
    ]
      .filter(Boolean)
      .join(' ')
    const inCollection = mapValue(release.user_data).in_collection === true

    releases.push({
      id: release.id,
      ident: {
        artist: artists,
        album: title,
        year,
        source: source ?? ''
      },
      display: formatResult(artists, title, edition, {
        editionTitle: editionTitle || undefined,
        additionalInfo: inCollection ? 'IN COLLECTION' : undefined
      })
    })
    if (releases.length === limit) break
  }
  return releases
}

function discogsSource(formats: string[]): string | undefined {
  for (const [format, source] of SOURCES) {
    if (formats.some((value) => value.includes(format))) return source
  }
  return undefined
}

function discogsEditionTitle(descriptions: string[]): string | undefined {
  const valid = descriptions.filter((description) =>
    VALID_EDITION_TITLES.some((title) => description.includes(title))
  )
  return valid.length > 0 ? valid.join(' / ') : undefined
}

function mapDiscogsTracks(raw: Record<string, unknown>): Track[] {
  const releaseArtists = mapDiscogsMainArtists(sliceValue(raw.artists))
  const tracks: Track[] = []
  let discNumber = 1

  for (const entry of sliceValue(raw.tracklist)) {
    const track = mapValue(entry)
    const type = toString(track.type_)
    if (type === 'heading') {
      if (tracks.length > 0) discNumber++
      continue
    }
    if (type !== 'track') continue

    const artists = mapDiscogsTrackArtists(track, releaseArtists)
    tracks.push({
      discNumber: String(discNumber),
      trackNumber: toString(track.position).toUpperCase(),
      title: appendDiscogsRemixers(toString(track.title), artists),
      artists
    })
  }
  return tracks
}

function mapDiscogsTrackArtists(
  track: Record<string, unknown>,
  releaseArtists: Artist[]
): Artist[] {
  const trackArtists = sliceValue(track.artists)
  const artists =
    trackArtists.length > 0
      ? mapDiscogsMainArtists(trackArtists)
      : releaseArtists.map((artist) => ({ ...artist }))

  for (const raw of sliceValue(track.extraartists)) {
    const extra = mapValue(raw)
    const name = sanitizeDiscogsArtist(toString(extra.name))
    if (!name) continue
    for (const rawRole of toString(extra.role).split(',')) {
      const role = ARTIST_ROLES[rawRole.trim()]
      if (role) artists.push({ name, role })
    }
  }

  const specificNames = new Set(
    artists
      .filter((artist) => (artist.role ?? 'main') !== 'main')
      .map((artist) => (artist.name ?? '').toLowerCase())
  )
  const seen = new Set<string>()
  return artists.filter((artist) => {
    const name = artist.name ?? ''
    const role = artist.role ?? 'main'
    if (role === 'main' && specificNames.has(name.toLowerCase())) return false
    const key = `${name.toLowerCase()}\0${role}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mapDiscogsMainArtists(entries: unknown[]): Artist[] {
  return entries
    .map(mapValue)
    .filter((artist) => toString(artist.name) !== 'Various')
    .map((artist) => ({
      name: sanitizeDiscogsArtist(toString(artist.name)),
      role: 'main'
    }))
    .filter((artist) => Boolean(artist.name))
}

function sanitizeDiscogsArtist(name: string): string {
  return name.replace(/\*+$/, '').replace(/ \(\d+\)$/, '')
}

function appendDiscogsRemixers(title: string, artists: Artist[]): string {
  if (/(?:remix|mix)/i.test(title)) return title
  const remixers = artists
    .filter((artist) => artist.role === 'remixer')
    .map((artist) => artist.name ?? '')
    .filter(Boolean)
  if (remixers.length >= VARIOUS_ARTIST_THRESHOLD) return `${title} (Remixed)`
  if (remixers.length > 0) return `${title} (${remixers.join(' & ')} Remix)`
  return title
}
