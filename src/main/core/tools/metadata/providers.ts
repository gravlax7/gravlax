import type { Config } from '@shared/types/config'
import type { Provider } from './base'
import {
  formatResult,
  isPlainProviderURL,
  mapValue,
  parseYear,
  releaseIDFromRawURL,
  sliceValue,
  toString
} from './base'
import { fetchJSON, timeoutMsFromConfig } from './http'
import { createDeezerProvider } from './deezer'

const MUSICBRAINZ_RELEASE_PATH =
  /^\/release\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i

export interface ProviderDefinition {
  name: string
  enabled: boolean
}

export function providerDefinitions(cfg: Config): ProviderDefinition[] {
  const m = cfg.metadataProviders
  return [
    { name: 'MusicBrainz', enabled: m.musicBrainz.enabled },
    { name: 'Deezer', enabled: m.deezer.enabled }
  ]
}

export function createProviders(cfg: Config): Provider[] {
  const timeoutMs = timeoutMsFromConfig(cfg.metadataProviders.requestTimeoutSeconds)
  return [createMusicBrainz(timeoutMs), createDeezerProvider(timeoutMs)]
}

function createMusicBrainz(timeoutMs: number): Provider {
  const searchURL = 'https://musicbrainz.org/ws/2/release'
  const siteURL = 'https://musicbrainz.org'
  return {
    name: 'MusicBrainz',
    releaseIDFromURL: musicBrainzReleaseIDFromURL,
    async healthcheck(signal) {
      await fetchJSON(searchURL, {
        query: { query: 'test', limit: '1', fmt: 'json' },
        headers: { Accept: 'application/json' },
        signal,
        timeoutMs
      })
    },
    async searchReleases(search, limit, signal) {
      const response = await fetchJSON<{ releases?: unknown[] }>(searchURL, {
        query: { query: search, limit: String(limit), fmt: 'json' },
        headers: { Accept: 'application/json' },
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
      return fetchJSON(`${siteURL}/ws/2/release/${id}`, {
        query: {
          fmt: 'json',
          inc: 'artists+labels+recordings+release-groups+media+artist-credits+artist-rels+recording-level-rels'
        },
        headers: { Accept: 'application/json' },
        signal,
        timeoutMs
      })
    },
    formatURL(releaseID, _releaseName, rawURL) {
      if (rawURL) return rawURL
      return `${siteURL}/release/${toString(releaseID)}`
    }
  }
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
