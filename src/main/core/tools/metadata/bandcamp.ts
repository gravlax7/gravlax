import { parse, type HTMLElement } from 'node-html-parser'
import type { Artist, Release, Track } from '@shared/types'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import type { Provider, ReleaseResult } from './base'
import { formatResult, isPlainHttpURL, parseYear, toString } from './base'
import { fetchText, HTTPStatusError } from './http'

export const BANDCAMP_NAME = 'Bandcamp'
const BANDCAMP_SEARCH = 'https://bandcamp.com/search/'
const RELEASE_URL_RE = /^https?:\/\/([^/]+)\/(album|track)\/([^/?#]+)/i
const CATNO_PREFIX_RE =
  /^(?<catno>(?=.*\d)[A-Za-z0-9][A-Za-z0-9 ._-]{1,31})\s*\/\s*(?<title>.+)$/
const BRACKETED_CATNO_PREFIX_RE =
  /^[[(](?<catno>(?=.*\d)[A-Za-z0-9][A-Za-z0-9 ._-]{1,31})[\])]\s*(?<title>.+)$/
const TITLE_ARTIST_PREFIX_RE = /^(?<artist>.+?)\s+-\s+(?<title>.+)$/
const TRACK_SIDE_PREFIX_RE = /^(?<prefix>[A-Z]{1,3}\d{1,2}[A-Z]?)\s+(?<artist>.+)$/i
const RE_FEAT = / [([{]?(?:f(?:ea)?t(?:uring)?\.?|with\.) ([^)\]}]+)[)\]}]?/i
const ARTIST_SPLIT_RE = / \\ |\/|; | & |, /

export type BandcampReleaseID = [host: string, type: 'album' | 'track', slug: string]

interface ReleaseContext {
  artist: string
  title: string
  catno: string | null
  accountTitle: string | null
}

export function createBandcampProvider(timeoutMs: number): Provider {
  return {
    name: BANDCAMP_NAME,
    releaseIDFromURL: bandcampReleaseIDFromURL,
    async healthcheck(signal) {
      await fetchSearchPage('test', timeoutMs, signal)
    },
    async searchReleases(search, limit, signal) {
      const html = await fetchSearchPage(search, timeoutMs, signal)
      if (!html) return []
      try {
        return parseSearchResults(html, limit)
      } catch (err) {
        throw new Error(`Failed to parse Bandcamp search results: ${String(err)}`)
      }
    },
    async fetchData(releaseURL, releaseID, signal) {
      const url = resolveBandcampURL(releaseURL, releaseID)
      if (!url) throw new Error('invalid Bandcamp URL')
      const html = await fetchText(url, { signal, timeoutMs })
      return { html }
    },
    mapRelease: mapBandcampRelease,
    formatURL(releaseID, _releaseName, rawURL) {
      if (rawURL) return rawURL
      return formatBandcampURL(asBandcampID(releaseID))
    }
  }
}

export function bandcampReleaseIDFromURL(url: URL): BandcampReleaseID | null {
  if (!isPlainHttpURL(url)) return null
  if (isOtherProviderHost(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  const type = parts[0]?.toLowerCase()
  const slug = parts[1]
  if ((type !== 'album' && type !== 'track') || !slug) return null
  return [url.hostname, type, slug]
}

function isOtherProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'deezer.com' ||
    host.endsWith('.deezer.com') ||
    host === 'musicbrainz.org' ||
    host.endsWith('.musicbrainz.org')
  )
}

function mapBandcampRelease(raw: Record<string, unknown>, url: string): Release {
  const html = toString(raw.html)
  if (!html) throw new Error('Failed to parse scraped title.')
  const root = parse(html)
  const context = resolveReleaseContext(root)
  const year = parseReleaseYear(root)
  const yearText = year ? String(year) : undefined
  const tracks = parseTracks(root, context)
  const artists = /various/i.test(context.artist)
    ? []
    : splitArtistNames(context.artist).map((name) => ({ name, role: 'main' }))

  return {
    title: context.title,
    artists,
    year: yearText,
    groupYear: yearText,
    label: parseReleaseLabel(context),
    catNo: parseReleaseCatno(root, context) ?? '',
    genres: parseGenres(root),
    cover: parseCoverUrl(root),
    urls: url ? [url] : undefined,
    trackCount: tracks.length || undefined,
    tracks,
    comment: BANDCAMP_NAME
  }
}

function parseSearchResults(html: string, limit: number): ReleaseResult[] {
  const root = parse(html)
  const results: ReleaseResult[] = []
  for (const meta of root.querySelectorAll('.result-items .searchresult.data-search .result-info')) {
    try {
      const itemUrl = textOf(meta.querySelector('.itemurl a'))
      if (!itemUrl) continue
      const parsed = parseReleaseURLString(itemUrl)
      if (!parsed) continue

      const [host, type] = parsed
      let title = textOf(meta.querySelector('.heading a'))
      if (title.length > 100) title = `${title.slice(0, 98)}..`

      const subhead = textOf(meta.querySelector('.subhead'))
      const subheadMatch = /by (.+)/.exec(subhead)
      const artists = subheadMatch?.[1]?.trim() ?? ''

      const lengthText = textOf(meta.querySelector('.length'))
      if (!lengthText) continue
      const lengthMatch = /(\d+) tracks?/.exec(lengthText)
      const trackCount = type === 'track' ? 1 : lengthMatch?.[1] ? Number(lengthMatch[1]) : 1

      const releaser = host.split('.bandcamp.com')[0] ?? host
      const date = textOf(meta.querySelector('.released'))
      if (!date) continue
      const year = parseYear(date)
      const edition = [year, releaser].filter((part) => part != null && part !== '').join(' ')

      results.push({
        id: parsed,
        ident: {
          artist: artists,
          album: title,
          year,
          trackCount,
          source: 'WEB'
        },
        display: formatResult(artists, title, edition, { trackCount })
      })
      if (results.length === limit) break
    } catch {
      continue
    }
  }
  return results
}

function parseReleaseURLString(raw: string): BandcampReleaseID | null {
  try {
    const fromURL = bandcampReleaseIDFromURL(new URL(raw.trim()))
    if (fromURL) return fromURL
  } catch {
  }
  const match = RELEASE_URL_RE.exec(raw.trim())
  if (!match?.[1] || !match[2] || !match[3]) return null
  const type = match[2].toLowerCase()
  if (type !== 'album' && type !== 'track') return null
  return [match[1].replace(/\?.+$/, ''), type, match[3]]
}

function resolveBandcampURL(releaseURL: string, releaseID: unknown): string {
  const fromID = formatBandcampURL(asBandcampID(releaseID))
  if (fromID) return fromID
  const trimmed = releaseURL.trim()
  if (!trimmed) return ''
  try {
    const parsed = bandcampReleaseIDFromURL(new URL(trimmed))
    if (parsed) return formatBandcampURL(parsed)
  } catch {
    return trimmed
  }
  return trimmed
}

function formatBandcampURL(id: BandcampReleaseID | null): string {
  if (!id) return ''
  return `https://${id[0]}/${id[1]}/${id[2]}`
}

function asBandcampID(value: unknown): BandcampReleaseID | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const host = value[0]
  const type = value[1]
  const slug = value[2]
  if (typeof host !== 'string' || typeof slug !== 'string') return null
  if (type !== 'album' && type !== 'track') return null
  return [host, type, slug]
}

async function fetchSearchPage(
  search: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  const parsed = new URL(BANDCAMP_SEARCH)
  parsed.searchParams.set('q', search)
  const headers = new Headers()
  headers.set('User-Agent', DEFAULT_USER_AGENT)
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  const signals = [signal, timeout].filter(Boolean) as AbortSignal[]
  const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
  const response = await fetch(parsed.toString(), {
    signal: combined,
    redirect: 'manual',
    headers
  })
  if (response.status >= 300 && response.status < 400) return ''
  const body = await response.text()
  if (response.status < 200 || response.status >= 300) {
    throw new HTTPStatusError(response.status, body)
  }
  return body
}

function resolveReleaseContext(root: HTMLElement): ReleaseContext {
  const rawTitle = parseRawReleaseTitle(root)
  const pageArtist = parsePageArtist(root)
  const accountTitle = parseAccountTitle(root)
  const [catno, cleanTitle] = extractCatnoAndTitle(rawTitle, pageArtist)
  let releaseArtist = pageArtist
  let releaseTitle = cleanTitle

  if (
    pageArtist &&
    accountTitle &&
    normalizeReleaseKey(pageArtist) === normalizeReleaseKey(accountTitle)
  ) {
    const splitTitle = splitArtistPrefixedTitle(cleanTitle)
    if (
      splitTitle &&
      normalizeReleaseKey(splitTitle[0]) !== normalizeReleaseKey(pageArtist) &&
      tracklistSupportsReleaseTitle(root, splitTitle[1])
    ) {
      releaseArtist = splitTitle[0]
      releaseTitle = splitTitle[1]
    }
  }

  return {
    artist: releaseArtist,
    title: releaseTitle,
    catno,
    accountTitle
  }
}

function parseRawReleaseTitle(root: HTMLElement): string {
  const title = textOf(root.querySelector('#name-section .trackTitle'))
  if (!title) throw new Error('Failed to parse scraped title.')
  return title
}

function parsePageArtist(root: HTMLElement): string {
  for (const section of root.querySelectorAll('#name-section')) {
    const span = section.querySelector('span')
    if (span) return textOf(span)
  }
  return ''
}

function parseAccountTitle(root: HTMLElement): string | null {
  const title = textOf(root.querySelector('#band-name-location .title'))
  return title || null
}

function extractCatnoAndTitle(rawTitle: string, artist?: string): [string | null, string] {
  const title = rawTitle.trim()
  const match = CATNO_PREFIX_RE.exec(title) ?? BRACKETED_CATNO_PREFIX_RE.exec(title)
  if (!match?.groups) return [null, title]

  let cleanTitle = (match.groups.title ?? '').trim()
  if (artist) {
    const escaped = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const artistMatch = new RegExp(`^${escaped}\\s*-\\s*(?<title>.+)$`, 'i').exec(cleanTitle)
    if (artistMatch?.groups?.title) {
      cleanTitle = artistMatch.groups.title.trim()
    }
  }
  return [(match.groups.catno ?? '').trim(), cleanTitle]
}

function normalizeReleaseKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function splitArtistPrefixedTitle(title: string): [string, string] | null {
  const match = TITLE_ARTIST_PREFIX_RE.exec(title || '')
  if (!match?.groups) return null
  return [(match.groups.artist ?? '').trim(), (match.groups.title ?? '').trim()]
}

function tracklistSupportsReleaseTitle(root: HTMLElement, releaseTitle: string): boolean {
  const candidate = normalizeReleaseKey(releaseTitle)
  if (!candidate) return false
  const trackTitles = root
    .querySelectorAll('#track_table tr.track_row_view .track-title')
    .map((track) => normalizeReleaseKey(textOf(track)))
    .filter(Boolean)
  if (trackTitles.length === 0) return false
  return trackTitles.filter((title) => title.startsWith(candidate)).length >= 2
}

function parseReleaseLabel(context: ReleaseContext): string {
  const label = context.accountTitle
  if (label && normalizeReleaseKey(context.artist) !== normalizeReleaseKey(label)) {
    return label
  }
  return ''
}

function parseReleaseCatno(root: HTMLElement, context: ReleaseContext): string | null {
  if (context.catno) return context.catno
  const currentKey = normalizeReleaseKey(context.title)
  const artistKey = normalizeReleaseKey(context.artist)
  for (const album of root.querySelectorAll(
    'li.recommended-album.footer-ar[data-albumtitle][data-artist]'
  )) {
    const footerTitle = (album.getAttribute('data-albumtitle') ?? '').trim()
    const footerArtist = (album.getAttribute('data-artist') ?? '').trim()
    const [footerCatno, footerCleanTitle] = extractCatnoAndTitle(footerTitle, footerArtist)
    if (
      footerCatno &&
      normalizeReleaseKey(footerArtist) === artistKey &&
      normalizeReleaseKey(footerCleanTitle) === currentKey
    ) {
      return footerCatno
    }
  }
  return null
}

function parseCoverUrl(root: HTMLElement): string | undefined {
  const src = root.querySelector('#tralbumArt img')?.getAttribute('src')?.trim()
  return src || undefined
}

function parseGenres(root: HTMLElement): string[] {
  const genres: string[] = []
  const seen = new Set<string>()
  for (const anchor of root.querySelectorAll('.tralbumData.tralbum-tags a')) {
    const tag = textOf(anchor)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    genres.push(tag)
  }
  return genres
}

function parseReleaseYear(root: HTMLElement): number | undefined {
  const credits = textOf(root.querySelector('.tralbumData.tralbum-credits'))
  if (!credits) return undefined
  const match = /release(?:d|s) ([^\d]+ \d+, \d{4})/.exec(credits)
  if (!match?.[1]) return undefined
  return parseYear(match[1])
}

function parseTracks(root: HTMLElement, context: ReleaseContext): Track[] {
  const rows = root.querySelectorAll('#track_table tr.track_row_view')
  if (rows.length === 0) {
    return [
      {
        discNumber: '1',
        trackNumber: '1',
        title: context.title,
        artists: splitArtistNames(context.artist).map((name) => ({ name, role: 'main' }))
      }
    ]
  }

  const tracks: Track[] = []
  for (const row of rows) {
    const numText = textOf(row.querySelector('.track-number-col .track_number')).replace(/\.+$/, '')
    const num = Number(numText)
    if (!Number.isFinite(num)) throw new Error('Could not parse tracks.')
    const title = extractTrackTitle(row)
    const [trackArtists, stripArtistPrefix] = parseTrackArtists(
      context.artist,
      title,
      context.title
    )
    tracks.push({
      discNumber: '1',
      trackNumber: String(num),
      title: parseTrackTitle(title, stripArtistPrefix),
      artists: trackArtists
    })
  }
  return tracks
}

function extractTrackTitle(track: HTMLElement): string {
  const titleNode = track.querySelector('.title-col .track-title')
  if (titleNode) {
    const text = textOf(titleNode)
    if (text) return text
  }

  const titleContainer = track.querySelector('.title-col .title')
  if (titleContainer) {
    for (const child of titleContainer.childNodes) {
      if (child.rawTagName !== 'span') continue
      const element = child as HTMLElement
      if (element.classList.contains('time')) continue
      const text = textOf(element)
      if (text) return text
    }
  }
  throw new Error('Could not parse track title.')
}

function parseTrackArtists(
  artist: string,
  title: string,
  releaseTitle?: string
): [Artist[], boolean] {
  const featArtists = RE_FEAT.exec(title)
  const artists: Artist[] = []
  let stripArtistPrefix = false
  if (featArtists?.[1]) {
    const featPart = featArtists[1].split(' - ')[0] ?? ''
    for (const name of splitArtistNames(featPart)) {
      artists.push({ name, role: 'guest' })
    }
  }
  if (title.includes(' - ')) {
    let trackArtists = title.split(' - ')[0] ?? ''
    if (featArtists?.[0]) {
      trackArtists = trackArtists.replace(featArtists[0].split(' - ')[0] ?? '', '').trim()
    }
    const normalizedTrackArtist = normalizeReleaseKey(trackArtists)
    const normalizedReleaseTitle = releaseTitle ? normalizeReleaseKey(releaseTitle) : ''
    const normalizedReleaseArtist = normalizeReleaseKey(artist)
    if (
      normalizedTrackArtist &&
      normalizedTrackArtist !== normalizedReleaseTitle &&
      normalizedTrackArtist !== normalizedReleaseArtist
    ) {
      if (artist.toLowerCase().includes('various')) {
        trackArtists = stripTrackSidePrefix(trackArtists)
      }
      for (const name of splitArtistNames(trackArtists)) {
        artists.push({ name, role: 'main' })
      }
      stripArtistPrefix = true
    }
  }
  if (!artist.toLowerCase().includes('various')) {
    for (const name of splitArtistNames(artist)) {
      if (!artists.some((entry) => entry.name === name && entry.role === 'main')) {
        artists.push({ name, role: 'main' })
      }
    }
  }
  return [artists, stripArtistPrefix]
}

function parseTrackTitle(title: string, stripArtistPrefix: boolean): string {
  let next = title
  if (stripArtistPrefix && next.includes(' - ')) {
    next = next.split(' - ').slice(1).join(' - ')
  }
  return next.replace(RE_FEAT, '').replace(/\s+$/, '')
}

function stripTrackSidePrefix(trackArtists: string): string {
  const match = TRACK_SIDE_PREFIX_RE.exec(trackArtists.trim())
  if (!match?.groups?.artist) return trackArtists.trim()
  return match.groups.artist.trim()
}

function splitArtistNames(value: string): string[] {
  return value
    .split(ARTIST_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)
}

function textOf(element: HTMLElement | null): string {
  return element?.text.trim() ?? ''
}
