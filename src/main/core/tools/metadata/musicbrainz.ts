import type { Provider } from './base'
import type { Artist, Release } from '@shared/types'
import packageJSON from '../../../../../package.json'
import {
  applyFeaturedArtistsFromTitle,
  joinphraseIndicatesFeatured,
  normalizeArtistRole,
  parseArtistCreditValues,
  stripFeaturedFromTitle
} from '@shared/tags/editor'
import {
  formatResult,
  isPlainProviderURL,
  mapValue,
  parseYear,
  releaseIDFromRawURL,
  sliceValue,
  toString
} from './base'
import { fetchJSON, HTTPStatusError } from './http'
import { mapReleaseTypeToken } from './normalization'
import {
  type MusicBrainzRateLimiter,
  sharedMusicBrainzRateLimiter
} from './musicbrainzRateLimit'

const MUSICBRAINZ_RELEASE_PATH =
  /^\/release\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i

export const MUSICBRAINZ_NAME = 'MusicBrainz'
export const MUSICBRAINZ_USER_AGENT =
  `gravlax/${packageJSON.version} ( gravlax.unfreeze415@passfwd.com )`

const MUSICBRAINZ_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': MUSICBRAINZ_USER_AGENT
}

export function createMusicBrainzProvider(
  timeoutMs: number,
  rateLimiter: MusicBrainzRateLimiter = sharedMusicBrainzRateLimiter
): Provider {
  const searchURL = 'https://musicbrainz.org/ws/2/release'
  const siteURL = 'https://musicbrainz.org'
  const request = <T = unknown>(
    url: string,
    options: Parameters<typeof fetchJSON>[1]
  ): Promise<T> =>
    rateLimiter.schedule(
      async () => {
        try {
          return await fetchJSON<T>(url, {
            ...options,
            headers: { ...options?.headers, ...MUSICBRAINZ_HEADERS }
          })
        } catch (err) {
          if (err instanceof HTTPStatusError && (err.status === 429 || err.status === 503)) {
            rateLimiter.backOff()
          }
          throw err
        }
      },
      options?.signal
    )

  return {
    name: MUSICBRAINZ_NAME,
    releaseIDFromURL: musicBrainzReleaseIDFromURL,
    async healthcheck(signal) {
      await request(searchURL, {
        query: { query: 'test', limit: '1', fmt: 'json' },
        signal,
        timeoutMs
      })
    },
    async searchReleases(search, limit, signal) {
      const response = await request<{ releases?: unknown[] }>(searchURL, {
        query: { query: search, limit: String(limit), fmt: 'json' },
        signal,
        timeoutMs
      })
      const results = []
      for (const raw of response.releases ?? []) {
        const release = mapValue(raw)
        const artists = joinMusicBrainzArtists(sliceValue(release['artist-credit']))
        const title = toString(release.title)
        const trackCount = musicBrainzTrackCount(release)
        const media = sliceValue(release.media).map(mapValue)
        const labelInfo = sliceValue(release['label-info']).map(mapValue)
        const label = toString(mapValue(labelInfo[0]?.label).name)
        const catno = toString(labelInfo[0]?.['catalog-number'])
        const source = toString(media.find((m) => m.format)?.format)
        const year = parseYear(toString(release.date))
        const country = toString(release.country)
        const disambiguation = toString(release.disambiguation)
        const edition = `${year ?? ''} ${label} ${catno}`.trim()
        results.push({
          id: release.id,
          ident: {
            artist: artists,
            album: title,
            year,
            trackCount,
            source
          },
          display: formatResult(artists, title, edition, {
            trackCount,
            editionTitle: source,
            countryCode: country || undefined,
            additionalInfo: disambiguation || undefined
          })
        })
        if (results.length === limit) break
      }
      return results
    },
    async fetchData(releaseURL, releaseID, signal) {
      const id =
        toString(releaseID) || releaseIDFromRawURL(releaseURL, musicBrainzReleaseIDFromURL)
      if (!id) throw new Error('invalid MusicBrainz URL')
      return request(`${siteURL}/ws/2/release/${id}`, {
        query: {
          fmt: 'json',
          inc: 'artists+labels+recordings+release-groups+media+artist-credits+artist-rels+recording-level-rels+genres'
        },
        signal,
        timeoutMs
      })
    },
    mapRelease: mapMusicBrainzRelease,
    formatURL(releaseID, _releaseName, rawURL) {
      if (rawURL) return rawURL
      return `${siteURL}/release/${toString(releaseID)}`
    }
  }
}

function mapMusicBrainzRelease(raw: Record<string, unknown>, url: string): Release {
  const rawTitle = toString(raw.title)
  const title = stripFeaturedFromTitle(rawTitle) || rawTitle
  const artists = mapMusicBrainzArtists(sliceValue(raw['artist-credit']))
  const releaseGroup = mapValue(raw['release-group'])
  const year = parseYear(toString(raw.date))
  const groupYear = parseYear(toString(releaseGroup['first-release-date'])) ?? year
  const labelInfo = sliceValue(raw['label-info']).map(mapValue)
  const label = toString(mapValue(labelInfo[0]?.label).name)
  const upc = toString(raw.barcode)
  const catNo = toString(labelInfo[0]?.['catalog-number'])
  const tracks = mapMusicBrainzTracks(raw)
  const coverArchive = mapValue(raw['cover-art-archive'])
  const hasFrontCover = coverArchive.front === true || coverArchive.front === 'true'
  const id = toString(raw.id)
  const cover = hasFrontCover && id ? `https://coverartarchive.org/release/${id}/front` : ''

  return {
    title,
    artists,
    year: year ? String(year) : undefined,
    groupYear: groupYear ? String(groupYear) : undefined,
    label,
    catNo,
    upc,
    genres: [
      ...musicBrainzStrings(raw.genres),
      ...musicBrainzStrings(releaseGroup.genres)
    ],
    releaseType: musicBrainzReleaseType(releaseGroup) || undefined,
    cover: cover || undefined,
    urls: url ? [url] : undefined,
    trackCount: tracks.length || Number(raw['track-count'] ?? 0) || undefined,
    tracks,
    comment: MUSICBRAINZ_NAME
  }
}

function mapMusicBrainzTracks(raw: Record<string, unknown>): NonNullable<Release['tracks']> {
  const tracks: NonNullable<Release['tracks']> = []
  sliceValue(raw.media).forEach((medium, discIndex) => {
    const mappedMedium = mapValue(medium)
    const discNumber = toString(mappedMedium.position) || String(discIndex + 1)
    sliceValue(mappedMedium.tracks).forEach((track, trackIndex) => {
      const mappedTrack = mapValue(track)
      const recording = mapValue(mappedTrack.recording)
      const trackArtists = mapMusicBrainzArtists(sliceValue(mappedTrack['artist-credit']))
      const recordingArtists = mapMusicBrainzArtists(sliceValue(recording['artist-credit']))
      tracks.push(
        applyFeaturedArtistsFromTitle({
          discNumber,
          trackNumber:
            toString(mappedTrack.number ?? mappedTrack.position) || String(trackIndex + 1),
          title: toString(mappedTrack.title ?? recording.title),
          artists: trackArtists.length > 0 ? trackArtists : recordingArtists
        })
      )
    })
  })
  return tracks
}

function musicBrainzReleaseType(releaseGroup: Record<string, unknown>): string {
  const priority = [
    'live',
    'compilation',
    'soundtrack',
    'remix',
    'dj-mix',
    'mixtape/street',
    'interview'
  ]
  for (const secondary of musicBrainzStrings(releaseGroup['secondary-types'])) {
    if (priority.includes(secondary.trim().toLowerCase())) {
      return mapReleaseTypeToken(secondary)
    }
  }
  return mapReleaseTypeToken(toString(releaseGroup['primary-type'] ?? releaseGroup.type))
}

function mapMusicBrainzArtists(credits: unknown[]): Artist[] {
  const artists: Artist[] = []
  const seen = new Set<string>()
  const push = (name: string, role: string): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    const normalizedRole = musicBrainzArtistRole(role)
    const key = `${trimmed.toLowerCase()}\0${normalizedRole}`
    if (seen.has(key)) return
    seen.add(key)
    artists.push({ name: trimmed, role: normalizedRole })
  }

  let featuredFromJoinphrase = false
  for (const credit of credits) {
    if (typeof credit === 'string' || typeof credit === 'number') {
      for (const artist of parseArtistCreditValues([toString(credit)])) {
        push(artist.name ?? '', artist.role ?? '')
      }
      featuredFromJoinphrase = false
      continue
    }

    const mapped = mapValue(credit)
    const name = toString(mapped.name) || toString(mapValue(mapped.artist).name)
    const role = toString(mapped.role) || (featuredFromJoinphrase ? 'guest' : '')
    if (name) push(name, role)
    featuredFromJoinphrase = joinphraseIndicatesFeatured(toString(mapped.joinphrase))
  }
  return artists
}

function musicBrainzArtistRole(role: string): string {
  const normalized = role.trim().toLowerCase()
  if (!normalized || normalized === 'primary') return 'main'
  if (['featured', 'featuring', 'feat', 'ft', 'ft.'].includes(normalized)) return 'guest'
  return normalizeArtistRole(normalized)
}

function musicBrainzStrings(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [toString(value)]
  return sliceValue(value)
    .map((entry) =>
      typeof entry === 'string' || typeof entry === 'number'
        ? toString(entry)
        : toString(mapValue(entry).name)
    )
    .filter(Boolean)
}

function musicBrainzReleaseIDFromURL(url: URL): string | null {
  if (!isPlainProviderURL(url, ['musicbrainz.org', 'www.musicbrainz.org'])) return null
  return MUSICBRAINZ_RELEASE_PATH.exec(url.pathname)?.[1]?.toLowerCase() ?? null
}

function joinMusicBrainzArtists(credits: unknown[]): string {
  let out = ''
  for (const credit of credits) {
    const c = mapValue(credit)
    const name = toString(c.name) || toString(mapValue(c.artist).name)
    out += name + toString(c.joinphrase)
  }
  return out
}

function musicBrainzTrackCount(release: Record<string, unknown>): number | undefined {
  const direct = Number(release['track-count'])
  if (direct > 0) return direct
  let total = 0
  for (const medium of sliceValue(release.media).map(mapValue)) {
    total += Number(medium['track-count'] ?? 0)
  }
  return total > 0 ? total : undefined
}
