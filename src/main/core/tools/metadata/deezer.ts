import type { Provider, ReleaseResult } from './base'
import {
  formatResult,
  isPlainProviderURL,
  mapValue,
  releaseIDFromRawURL,
  toString
} from './base'
import { fetchJSON, fetchText } from './http'

const DEEZER_NAME = 'Deezer'
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
    formatURL(releaseID, _releaseName, rawURL) {
      if (rawURL) return rawURL
      return `${DEEZER_SITE}/album/${toString(releaseID)}`
    }
  }
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
