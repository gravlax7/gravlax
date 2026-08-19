import type { Artist, Release } from '@shared/types/upload'
import { normalizeArtistRole } from '@shared/tags/editor'
import { isMultiDisc as discNumbersAreMultiDisc } from '@shared/upload/naming'
import { getDescriptionTemplate } from '@shared/upload/templates'
import { renderTemplate, type TemplateContext } from '@shared/upload/templateRender'

export interface TrackDescInput {
  discNumber?: string
  trackNumber?: string
  title?: string
  artists?: Artist[]
  durationSeconds: number
}

export interface AlbumDescMetadata {
  artists?: Artist[]
  title?: string
  year?: string
  label?: string
  catNo?: string
  genres?: string[]
  formats?: string
  country?: string
  comment?: string
  urls?: string[]
  sourceUrl?: string
  templateId?: string
}

export interface ReleaseDescInput {
  bitDepth?: number
  sampleRate?: number
  hybrid?: boolean
  releaseDate?: string
  lossyMaster?: boolean
  lossyComment?: string
  sourceUrl?: string
  metadataUrls?: string[]
  tracks?: TrackDescInput[]
  includeTracklist?: boolean
  version: string
}

const KNOWN_PROVIDERS: Array<{ name: string; match: RegExp }> = [
  { name: 'Bandcamp', match: /bandcamp\.com/i },
  { name: 'Beatport', match: /beatport\.com/i },
  { name: 'Deezer', match: /deezer\.com/i },
  { name: 'Discogs', match: /discogs\.com/i },
  { name: 'Junodownload', match: /junodownload\.com/i },
  { name: 'MusicBrainz', match: /musicbrainz\.org/i },
  { name: 'Qobuz', match: /qobuz\.com/i },
  { name: 'Tidal', match: /tidal\.com/i }
]

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function padTrackNumber(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return '00'
  const asInt = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(asInt)) return trimmed.padStart(2, '0')
  return String(asInt).padStart(2, '0')
}

export function isMultiDisc(tracks: TrackDescInput[]): boolean {
  return discNumbersAreMultiDisc(tracks.map((t) => t.discNumber))
}

export function providerLabelForUrl(url: string): string {
  for (const provider of KNOWN_PROVIDERS) {
    if (provider.match.test(url)) return provider.name
  }
  const hostname = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)
  return hostname?.[1] ?? url
}

export function generateSourceLinks(urls: string[] | undefined, excludeUrl?: string): string {
  const excluded = excludeUrl?.trim() ?? ''
  const links: string[] = []
  for (const raw of urls ?? []) {
    const url = raw.trim()
    if (!url || url === excluded) continue
    const label = providerLabelForUrl(url)
    links.push(`[url=${url}]${label}[/url]`)
  }
  return links.join(' | ')
}

/**
 * Stands in for the spectral BBCode until submit, when the images are actually
 * hosted. `substituteSpectralBbcode` swaps it for the real thing, so this exact
 * string has to survive round-tripping through the release description field.
 */
export const SPECTRAL_PLACEHOLDER =
  '[hide=Spectrals]\nSpectral images will be hosted and inserted at submit time.\n[/hide]\n'

export function spectralsPlaceholderBbcode(): string {
  return SPECTRAL_PLACEHOLDER
}

export interface SpectralBbcodeEntry {
  filename: string
  fullUrl: string
  zoomUrl: string
}

export function makeSpectralBbcode(entries: SpectralBbcodeEntry[]): string {
  if (entries.length === 0) return ''
  let bbcode = '[hide=Spectrals]'
  for (const entry of entries) {
    // Brackets inside a [hide=…] label terminate the tag early.
    const filename = entry.filename.replace(/[[\]]/g, '_')
    bbcode += `[b]${filename} Full[/b]\n[img=${entry.fullUrl}]\n[hide=Zoomed][img=${entry.zoomUrl}][/hide]\n\n`
  }
  return `${bbcode}[/hide]\n`
}

/**
 * Replace the placeholder with the hosted spectrals.
 *
 * A description the user edited the placeholder out of is left alone: they
 * removed it on purpose, and re-inserting it somewhere arbitrary is worse than
 * honouring the edit.
 */
export function substituteSpectralBbcode(description: string, bbcode: string): string {
  if (!description.includes(SPECTRAL_PLACEHOLDER)) return description
  return description.replace(SPECTRAL_PLACEHOLDER, bbcode)
}

export const SOURCE_TORRENT_PLACEHOLDER = 'FLAC torrent URL will be inserted at submit.'

export function substituteSourceTorrentUrl(description: string, url: string): string {
  if (!description.includes(SOURCE_TORRENT_PLACEHOLDER)) return description
  return description.replace(SOURCE_TORRENT_PLACEHOLDER, url)
}

export interface LossyMasterCommentInput {
  comment?: string
  spectralBbcode?: string
}

/** The body of a lossy master / lossy web approval report. */
export function buildLossyMasterComment(input: LossyMasterCommentInput): string {
  let out = (input.comment ?? '').trim()
  if (out) out += '\n\n'
  out += input.spectralBbcode ?? ''
  return out
}

/**
 * Transcodes are reported against the original's approval, so the report points
 * at the source torrent and folds the original comment away.
 */
export function wrapTranscodeLossyComment(sourceUrl: string, comment: string): string {
  const body = comment.trim()
  if (!body) return `Transcode of ${sourceUrl}\n`
  return `Transcode of ${sourceUrl}\n[hide=Lossy comment of original torrent]${body}[/hide]\n`
}

function artistNames(artists: Artist[] | undefined): string[] {
  return (artists ?? []).map((a) => (a.name ?? '').trim()).filter(Boolean)
}

function formatArtistList(artists: Artist[] | undefined): string {
  return artistNames(artists).join(', ')
}

function formatArtistBbcode(artists: Artist[] | undefined): string {
  return artistNames(artists)
    .map((name) => `[artist]${name}[/artist]`)
    .join(' & ')
}

function trackNumberLabel(track: TrackDescInput, multiDisc: boolean): string {
  if (multiDisc) {
    return `${padTrackNumber(track.discNumber)}-${padTrackNumber(track.trackNumber)}`
  }
  return padTrackNumber(track.trackNumber)
}

function guestArtistNames(artists: Artist[] | undefined): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const artist of artists ?? []) {
    if (normalizeArtistRole(artist.role ?? '') !== 'guest') continue
    const name = (artist.name ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

export function formatTrackTitle(track: TrackDescInput): string {
  const title = (track.title ?? '').trim() || 'Unknown Title'
  const guests = guestArtistNames(track.artists)
  if (guests.length === 0) return title
  const feat = guests.map((name) => `[artist]${name}[/artist]`).join(', ')
  return `${title} (feat. ${feat})`
}

function buildTrackRows(tracks: TrackDescInput[]): Array<Record<string, string>> {
  const multiDisc = isMultiDisc(tracks)
  return tracks.map((track) => {
    const duration =
      track.durationSeconds > 0 ? formatDuration(track.durationSeconds) : ''
    return {
      number: trackNumberLabel(track, multiDisc),
      title: formatTrackTitle(track),
      duration
    }
  })
}

function buildTracklist(rows: Array<Record<string, string>>): string {
  return rows
    .map((row) => {
      const durationPart = row.duration ? ` [i](${row.duration})[/i]` : ''
      return `[b]${row.number}.[/b] ${row.title}${durationPart}`
    })
    .join('\n')
}

export function buildAlbumDescriptionContext(
  tracks: TrackDescInput[],
  metadata: AlbumDescMetadata
): TemplateContext {
  const rows = buildTrackRows(tracks)
  const mainArtists = (metadata.artists ?? []).filter(
    (artist) => normalizeArtistRole(artist.role ?? '') === 'main'
  )
  const sourceUrl =
    (metadata.sourceUrl ?? '').trim() ||
    (metadata.urls ?? []).map((u) => u.trim()).find(Boolean) ||
    ''
  const year = (metadata.year ?? '').trim()
  const genres = (metadata.genres ?? []).map((g) => g.trim()).filter(Boolean).join(', ')
  return {
    artist: formatArtistList(mainArtists),
    artist_bbcode: formatArtistBbcode(mainArtists),
    album: (metadata.title ?? '').trim(),
    year,
    label: (metadata.label ?? '').trim(),
    catalog: (metadata.catNo ?? '').trim(),
    genres,
    formats: (metadata.formats ?? '').trim(),
    country: (metadata.country ?? '').trim(),
    tracks: rows,
    tracklist: buildTracklist(rows),
    source_url: sourceUrl,
    source: sourceUrl ? providerLabelForUrl(sourceUrl) : '',
    comment: (metadata.comment ?? '').trim()
  }
}

export function albumDescMetadataFromRelease(
  release: Release | undefined,
  extras?: { sourceUrl?: string; formats?: string; country?: string; templateId?: string }
): AlbumDescMetadata {
  return {
    artists: release?.artists,
    title: release?.title,
    year: release?.year || release?.groupYear,
    label: release?.label,
    catNo: release?.catNo,
    genres: release?.genres,
    formats: extras?.formats,
    country: extras?.country,
    comment: release?.comment,
    urls: release?.urls,
    sourceUrl: extras?.sourceUrl,
    templateId: extras?.templateId
  }
}

export function generateAlbumDescription(
  tracks: TrackDescInput[],
  metadata: AlbumDescMetadata
): string {
  const template = getDescriptionTemplate(metadata.templateId)
  const context = buildAlbumDescriptionContext(tracks, metadata)
  return renderTemplate(template.content, context)
}

export function generateReleaseDescription(input: ReleaseDescInput): string {
  let description = spectralsPlaceholderBbcode()

  if (!input.hybrid) {
    const sampleRate = (input.sampleRate ?? 0) / 1000
    if (input.bitDepth && sampleRate > 0) {
      description += `[b]${input.bitDepth} bit [color=#2E86C1]${sampleRate.toFixed(1)}[/color] kHz[/b]\n`
    } else if (sampleRate > 0) {
      description += `${sampleRate.toFixed(1)} kHz\n`
    }
  }

  if (input.releaseDate) {
    description += `Released on [b]${input.releaseDate}[/b]\n`
  }

  if (input.includeTracklist || input.hybrid) {
    for (const track of input.tracks ?? []) {
      description += `${formatTrackTitle(track)} [i](${formatDuration(track.durationSeconds)})[/i]\n`
    }
    if ((input.tracks ?? []).length > 0) description += '\n'
  }

  if (input.lossyMaster) {
    const note = (input.lossyComment ?? '').trim() || 'Reported as lossy master.'
    description += `[u]Lossy Notes:[/u]\n${note}\n\n`
  }

  if (input.sourceUrl) {
    const label = providerLabelForUrl(input.sourceUrl)
    description += `[b]More info:[/b] [url=${input.sourceUrl}]${label}[/url]\n`
  }

  const moreInfo = generateSourceLinks(input.metadataUrls, input.sourceUrl)
  if (moreInfo) {
    description += `[b]More info:[/b] ${moreInfo}\n`
  }

  description += `[hr]Uploaded with [b]gravlax[/b] v${input.version}`
  return description
}
