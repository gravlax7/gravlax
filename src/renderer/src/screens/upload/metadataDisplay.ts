import type { MetadataSearchResult } from '@shared/types'

export function metadataDisplayText(result: MetadataSearchResult): string {
  const raw = (result.display ?? '').trim()
  const value = raw || [result.artist, result.album].filter(Boolean).join(' - ')
  return value.replace(/\{Tracks:\s*(\d+)\}/gi, '{$1 Tracks}')
}

export function styleMetadataDisplay(
  display: string,
  result: MetadataSearchResult
): Array<{ text: string; color: string }> {
  const spans: Array<{ start: number; end: number; color: string }> = []
  const artist = result.artist ?? ''
  const album = result.album ?? ''
  let albumEnd = 0

  if (artist) {
    const artistStart = display.indexOf(artist)
    if (artistStart >= 0) {
      const artistEnd = artistStart + artist.length
      spans.push({ start: artistStart, end: artistEnd, color: 'var(--info)' })
      albumEnd = artistEnd
      if (album) {
        const albumRel = display.indexOf(album, artistEnd)
        if (albumRel >= 0) {
          albumEnd = albumRel + album.length
          spans.push({ start: albumRel, end: albumEnd, color: 'var(--warning)' })
        }
      }
    }
  } else if (album) {
    const albumStart = display.indexOf(album)
    if (albumStart >= 0) {
      albumEnd = albumStart + album.length
      spans.push({ start: albumStart, end: albumEnd, color: 'var(--warning)' })
    }
  }

  const braceRe = /\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = braceRe.exec(display)) != null) {
    const content = match[1] ?? ''
    const start = match.index
    const end = start + match[0].length
    if (/\d+\s+Tracks$/i.test(content) || content.startsWith('Tracks:')) {
      spans.push({ start, end, color: 'var(--fg-secondary)' })
    } else {
      spans.push({ start, end, color: 'var(--progress)' })
    }
  }

  if (albumEnd < display.length) {
    const tail = display.slice(albumEnd)
    const afterBraces = tail.includes('}') ? albumEnd + tail.lastIndexOf('}') + 1 : albumEnd
    if (afterBraces < display.length) {
      spans.push({ start: afterBraces, end: display.length, color: 'var(--meta-label)' })
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end)

  const merged: Array<{ start: number; end: number; color: string }> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.start < last.end) {
      if (span.end > last.end) last.end = span.end
      continue
    }
    merged.push({ ...span })
  }

  const segments: Array<{ text: string; color: string }> = []
  let cursor = 0
  for (const span of merged) {
    if (cursor < span.start) {
      segments.push({ text: display.slice(cursor, span.start), color: 'var(--fg-primary)' })
    }
    segments.push({ text: display.slice(span.start, span.end), color: span.color })
    cursor = span.end
  }
  if (cursor < display.length) {
    segments.push({ text: display.slice(cursor), color: 'var(--fg-primary)' })
  }
  return segments
}

export function providerStatusTone(
  status?: string
): 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'queued':
      return 'info'
    case 'running':
      return 'accent'
    case 'matched':
      return 'success'
    case 'empty':
      return 'neutral'
    case 'failed':
      return 'error'
    case 'inactive':
      return 'neutral'
    default:
      return 'neutral'
  }
}
