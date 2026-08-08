/** Coercions for Gazelle API payloads, which are typed as `unknown` on arrival. */

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Gazelle returns group and artist names HTML-escaped. */
export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Release type 7 is Gazelle's Compilation; those and 4+ artists collapse to VA. */
export function compileArtists(artists: unknown[], releaseType: number): string {
  if (releaseType === 7 || artists.length > 3) return 'Various Artists'
  return artists
    .map((a) => String(asRecord(a).name ?? ''))
    .filter(Boolean)
    .join(' & ')
}
