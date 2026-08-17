import type { Release } from '@shared/types'

export const ERR_FETCH_NOT_IMPLEMENTED = new Error('fetch data is not implemented for this provider')

export interface IdentData {
  artist: string
  album: string
  year?: number
  trackCount?: number
  source: string
}

export interface ReleaseResult {
  id: unknown
  ident: IdentData
  display: string
}

export interface Provider {
  name: string
  healthcheck(signal?: AbortSignal): Promise<void>
  searchReleases(search: string, limit: number, signal?: AbortSignal): Promise<ReleaseResult[]>
  releaseIDFromURL(url: URL): unknown | null
  fetchData(releaseURL: string, releaseID: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>
  mapRelease(raw: Record<string, unknown>, releaseURL: string): Release
  formatURL(releaseID: unknown, releaseName: string, rawURL: string): string
}

export function isPlainProviderURL(url: URL, hosts: string[]): boolean {
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    hosts.includes(url.hostname.toLowerCase()) &&
    !url.port &&
    !url.username &&
    !url.password
  )
}

export function releaseIDFromRawURL(
  rawURL: string,
  parse: (url: URL) => string | null
): string {
  try {
    return parse(new URL(rawURL)) ?? ''
  } catch {
    return ''
  }
}

export interface FormatOptions {
  trackCount?: number
  editionTitle?: string
  countryCode?: string
  explicit?: boolean
  clean?: boolean
  additionalInfo?: string
}

const copyrightSearchPatterns = [
  /.* \d{4} (.*)$/i,
  /marketed by (.+?) under/i,
  /(?:, )?under(?: exclusive)? licen(?:s|c)e to ([^,]+)/i,
  /d\/b\/a (.+)/i
]

const copyrightSubPatterns = [
  /.*(℗|©|\([pc]\))+/i,
  /^(19|20)\d{2}/,
  /(, )?a division of.+/i,
  /(, )?a .+company.+/i,
  /all rights reserved.*/i,
  /(,? )?llc/i,
  /(,? )ltd/i,
  /distributed by.+/i,
  / inc.+$/i,
  /, a division of.+/i,
  / +for the.+/i,
  /[,\.]$/,
  /^ *, */,
  /^Copyright /i,
  /(- )?(an )?imprint of.+/i,
  /\d+ records dk2?/i
]

const stripHTMLTagsPattern = /<[^>]+>/g
const releaseSlugPattern = /[^-a-z\d]/g
const multiDashPattern = /-+/g
const countryCodePrefixPattern = /^\[[^\]]+\] /

export function formatResult(
  artists: string,
  title: string,
  edition: string,
  options: FormatOptions = {}
): string {
  let result = `${artists.trim()} - ${title.trim()}`
  if (options.trackCount != null) {
    result += ` {${options.trackCount} Tracks}`
  }
  if (options.editionTitle) {
    result += ` {${options.editionTitle}}`
  }
  if (edition) {
    result += ` ${edition}`
  }
  if (options.explicit) {
    result = `[E] ${result}`
  }
  if (options.clean) {
    result = `[C] ${result}`
  }
  if (options.countryCode) {
    result = `[${options.countryCode}] ${result}`
  }
  if (options.additionalInfo) {
    result += ` ${options.additionalInfo}`
  }
  return result
}

export function parseYear(value: string): number | undefined {
  const match = /(\d{4})/.exec(value)
  if (!match?.[1]) return undefined
  const year = Number(match[1])
  return Number.isFinite(year) ? year : undefined
}

export function parseCopyrightLabel(value: string): string {
  if (!value) return ''
  for (const pattern of copyrightSearchPatterns) {
    const matches = pattern.exec(value)
    if (matches?.[1]) value = matches[1]
  }
  for (const pattern of copyrightSubPatterns) {
    value = value.replace(pattern, '').trim()
  }
  if (value.includes('/')) {
    value = value.split('/')[0]!.trim()
  }
  return value.trim()
}

export function stripHTMLTags(value: string): string {
  return htmlText(value.replace(stripHTMLTagsPattern, ' '))
}

export function htmlText(value: string): string {
  return decodeHTMLEntities(value.trim())
}

function decodeHTMLEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function urlFormatReleaseName(name: string): string {
  let formatted = name.trim().toLowerCase().replace(/ /g, '-')
  formatted = formatted.replace(releaseSlugPattern, '')
  formatted = formatted.replace(multiDashPattern, '-')
  return formatted.replace(/^-+|-+$/g, '')
}

export function displayIdentifier(display: string): string {
  return display.replace(countryCodePrefixPattern, '').trim()
}

export function toString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(Math.trunc(value))
  if (typeof value === 'boolean') return String(value)
  return String(value)
}

export function mapValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function sliceValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function mapPath(
  root: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | null {
  let current: unknown = root
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  const mapped = mapValue(current)
  return Object.keys(mapped).length > 0 || current ? mapped : null
}
