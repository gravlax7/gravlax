import type { UploadArtist } from '@shared/types'
import { uniqueStringsStable } from '@shared/tags/editor'
import { isNamedMainArtist } from './artists'

const titleCleanupPattern = /\s*(?:- )?(?:EP|Single)\b/gi
const featCleanupPattern = /\s*\(?feat(?:\.|uring)? [^)]*\)?/gi
const editionParenPattern =
  /[([{][^)\]}]*?(?:Edition|Version|Deluxe|Original|Reissue|Remaster|Vol|Mix|Edit)[^)\]}]*?[)\]}]/gi
const remixesParenPattern = /[([{][^)\]}]*Remixes[^)\]}]*?[)\]}]/gi
const remixParenPattern = /[([{][^)\]}]*Remix[^)\]}]*?[)\]}]/gi
const volAbbrevPattern = /vol[^u]\S*/i

export function cleanReleaseTitle(title: string): string {
  title = title.trim()
  title = title.replace(featCleanupPattern, '')
  title = title.replace(titleCleanupPattern, '')
  title = title.replace(/^[-()[\] ]+|[-()[\] ]+$/g, '').trim()
  return title.split(/\s+/).filter(Boolean).join(' ')
}

export function buildQueryStrings(artists: string[], title: string): string[] {
  let cleanTitle = cleanReleaseTitle(title)
  if (!cleanTitle) cleanTitle = title.trim()
  if (!cleanTitle) return []

  if (artists.length === 0) {
    return [cleanTitle]
  }
  if (artists.length === 1) {
    return [`${artists[0]} ${cleanTitle}`.trim()]
  }
  if (artists.length <= 3) {
    const queries: string[] = []
    for (const artist of artists) {
      const trimmed = artist.trim()
      if (!trimmed) continue
      queries.push(`${trimmed} ${cleanTitle}`.trim())
    }
    return uniqueStringsStable(queries)
  }
  return [cleanTitle]
}

export function normalizeAccents(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '')
}

export function sanitizeAlbumForDupeCheck(album: string | undefined | null): string {
  if (!album) return ''
  let next = album.replace(featCleanupPattern, '')
  next = next.replace(remixesParenPattern, 'remixes')
  next = next.replace(remixParenPattern, 'remix')
  next = next.replace(editionParenPattern, '')
  return next.trim()
}

export function filterUnnecessarySearchstrs(searchstrs: string[]): string[] {
  const pastWordSets: Set<string>[] = []
  const next: string[] = []
  for (const stri of [...searchstrs].sort((a, b) => a.length - b.length)) {
    const wordSet = new Set(stri.split(/\s+/).filter(Boolean))
    let redundant = false
    for (const prev of pastWordSets) {
      let contained = true
      for (const word of prev) {
        if (!wordSet.has(word)) {
          contained = false
          break
        }
      }
      if (contained) {
        redundant = true
        break
      }
    }
    if (redundant) continue
    next.push(stri)
    pastWordSets.push(wordSet)
  }
  return next
}

export function mainArtistNames(artists: UploadArtist[] | undefined): string[] {
  const names = (artists ?? []).filter(isNamedMainArtist).map((a) => a.name.trim())
  const various = names.some((a) => /various/i.test(a))
  if (various || names.length > 3) return []
  return names
}

export function buildDupeSearchStrings(input: {
  artists?: UploadArtist[]
  title?: string
  catalogueNumber?: string
}): string[] {
  const album = sanitizeAlbumForDupeCheck(input.title)
  const artists = mainArtistNames(input.artists)
  const catno = (input.catalogueNumber ?? '').trim()
  const searchstrs: string[] = []

  const pushForAlbum = (albumTitle: string): void => {
    for (const q of buildQueryStrings(artists, albumTitle)) {
      searchstrs.push(normalizeAccents(q))
    }
  }

  pushForAlbum(album)

  if (album && volAbbrevPattern.test(album)) {
    pushForAlbum(album.replace(/vol[^ ]+/gi, 'volume'))
  }
  if (album && album.toLowerCase().includes('untitled')) {
    pushForAlbum(catno || '')
  }
  if (album && album.includes('/')) {
    pushForAlbum(album.split('/')[0] ?? album)
  } else if (catno && album && album.toLowerCase().includes(catno.toLowerCase())) {
    pushForAlbum('untitled')
  }

  return filterUnnecessarySearchstrs(uniqueStringsStable(searchstrs.filter((s) => s.trim())))
}

export function groupSearchFingerprint(input: {
  artists?: UploadArtist[]
  title?: string
  catalogueNumber?: string
  trackerIds: string[]
}): string {
  const artists = mainArtistNames(input.artists).join('\0')
  const title = (input.title ?? '').trim()
  const catno = (input.catalogueNumber ?? '').trim()
  const trackers = [...input.trackerIds].sort().join(',')
  return `${artists}\n${title}\n${catno}\n${trackers}`
}

export function parseTorrentPageRef(raw: string): { groupId?: number; torrentId?: number } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const asNumber = Number.parseInt(trimmed, 10)
  if (Number.isFinite(asNumber) && String(asNumber) === trimmed) {
    return { groupId: asNumber }
  }

  try {
    const url = new URL(trimmed)
    const groupIdRaw = url.searchParams.get('id')
    const torrentIdRaw = url.searchParams.get('torrentid')
    const groupId = groupIdRaw ? Number.parseInt(groupIdRaw, 10) : NaN
    const torrentId = torrentIdRaw ? Number.parseInt(torrentIdRaw, 10) : NaN
    const result: { groupId?: number; torrentId?: number } = {}
    if (Number.isFinite(groupId)) result.groupId = groupId
    if (Number.isFinite(torrentId)) result.torrentId = torrentId
    if (result.groupId === undefined && result.torrentId === undefined) return null
    return result
  } catch {
    return null
  }
}
