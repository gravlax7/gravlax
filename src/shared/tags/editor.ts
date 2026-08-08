import type { Artist, Release, Track } from '@shared/types'
import { isMultiDisc } from '@shared/upload/naming'
import {
  ARTIST_ROLE_PRESETS,
  DEFAULT_ARTIST_ROLE,
  DISPLAY_EMPTY,
  DISPLAY_MIXED,
  FIELD_ALBUM_ARTIST,
  FIELD_ARTISTS,
  FIELD_CAT_NO,
  FIELD_COMMENT,
  FIELD_DISC_NUMBER,
  FIELD_EDITION_TITLE,
  FIELD_GENRES,
  FIELD_GROUP_YEAR,
  FIELD_LABEL,
  FIELD_RELEASE_TYPE,
  FIELD_TITLE,
  FIELD_TRACK_COUNT,
  FIELD_TRACK_NUMBER,
  FIELD_UPC,
  FIELD_URLS,
  FIELD_YEAR
} from '@shared/types/upload'

export function cloneTrack(track: Track): Track {
  return {
    ...track,
    artists: track.artists ? track.artists.map((a) => ({ ...a })) : undefined
  }
}

export function cloneRelease(r: Release): Release {
  const cloned: Release = { ...r }
  if (r.artists) {
    cloned.artists = r.artists.map((a) => ({ ...a }))
  }
  if (r.genres) {
    cloned.genres = [...r.genres]
  }
  if (r.urls) {
    cloned.urls = [...r.urls]
  }
  if (r.tracks) {
    cloned.tracks = r.tracks.map(cloneTrack)
  }
  if (r.mixed) {
    cloned.mixed = { ...r.mixed }
  }
  return cloned
}

export function fieldDisplayName(field: string): string {
  switch (field) {
    case FIELD_ARTISTS:
      return 'Artists'
    case FIELD_ALBUM_ARTIST:
      return 'Album Artist'
    case FIELD_TITLE:
      return 'Title'
    case FIELD_GROUP_YEAR:
      return 'Group Year'
    case FIELD_YEAR:
      return 'Year'
    case FIELD_EDITION_TITLE:
      return 'Edition Title'
    case FIELD_LABEL:
      return 'Label'
    case FIELD_CAT_NO:
      return 'CatNo'
    case FIELD_UPC:
      return 'UPC'
    case FIELD_GENRES:
      return 'Genres'
    case FIELD_RELEASE_TYPE:
      return 'Release Type'
    case FIELD_COMMENT:
      return 'Comment'
    case FIELD_URLS:
      return 'URLs'
    case FIELD_TRACK_COUNT:
      return 'Track Count'
    case FIELD_DISC_NUMBER:
      return 'Disc'
    case FIELD_TRACK_NUMBER:
      return 'Track'
    default:
      return field
  }
}

export function fieldEditable(field: string): boolean {
  return field !== FIELD_TRACK_COUNT
}

export function fieldMultiline(field: string): boolean {
  switch (field) {
    case FIELD_ARTISTS:
    case FIELD_GENRES:
    case FIELD_COMMENT:
    case FIELD_URLS:
      return true
    default:
      return false
  }
}

export function isMixed(r: Release, field: string): boolean {
  return Boolean(r.mixed?.[field])
}

export function displayValueLines(r: Release, field: string): string[] {
  if (isMixed(r, field)) {
    return [DISPLAY_MIXED]
  }
  const lines = editorValueLines(r, field)
  if (lines.length === 0) {
    return [DISPLAY_EMPTY]
  }
  return lines
}

export function editorValue(r: Release, field: string): string {
  return editorValueLines(r, field).join('\n')
}

export function editorValueLines(r: Release, field: string): string[] {
  switch (field) {
    case FIELD_ARTISTS:
      return formatArtists(r.artists ?? [])
    case FIELD_ALBUM_ARTIST:
      return nonEmptyLines(r.albumArtist ?? '')
    case FIELD_TITLE:
      return nonEmptyLines(r.title ?? '')
    case FIELD_GROUP_YEAR:
      return nonEmptyLines(r.groupYear ?? '')
    case FIELD_YEAR:
      return nonEmptyLines(r.year ?? '')
    case FIELD_EDITION_TITLE:
      return nonEmptyLines(r.editionTitle ?? '')
    case FIELD_LABEL:
      return nonEmptyLines(r.label ?? '')
    case FIELD_CAT_NO:
      return nonEmptyLines(r.catNo ?? '')
    case FIELD_UPC:
      return nonEmptyLines(r.upc ?? '')
    case FIELD_GENRES:
      return [...(r.genres ?? [])]
    case FIELD_RELEASE_TYPE:
      return nonEmptyLines(r.releaseType ?? '')
    case FIELD_COMMENT:
      return splitMultiline(r.comment ?? '')
    case FIELD_URLS:
      return [...(r.urls ?? [])]
    case FIELD_TRACK_COUNT:
      if (!r.trackCount || r.trackCount <= 0) {
        return []
      }
      return [String(r.trackCount)]
    default:
      return []
  }
}

export function setFieldEditorValue(r: Release, field: string, value: string): Release {
  const next = cloneRelease(r)
  const lines = cleanLines(value, field === FIELD_COMMENT)
  switch (field) {
    case FIELD_ARTISTS:
      next.artists = parseArtists(lines)
      break
    case FIELD_ALBUM_ARTIST:
      next.albumArtist = firstOrEmpty(lines)
      break
    case FIELD_TITLE:
      next.title = firstOrEmpty(lines)
      break
    case FIELD_GROUP_YEAR:
      next.groupYear = firstOrEmpty(lines)
      break
    case FIELD_YEAR:
      next.year = firstOrEmpty(lines)
      break
    case FIELD_EDITION_TITLE:
      next.editionTitle = firstOrEmpty(lines)
      break
    case FIELD_LABEL:
      next.label = firstOrEmpty(lines)
      break
    case FIELD_CAT_NO:
      next.catNo = firstOrEmpty(lines)
      break
    case FIELD_UPC:
      next.upc = firstOrEmpty(lines)
      break
    case FIELD_GENRES:
      next.genres = [...lines]
      break
    case FIELD_RELEASE_TYPE:
      next.releaseType = firstOrEmpty(lines)
      break
    case FIELD_COMMENT:
      next.comment = value.trim()
      break
    case FIELD_URLS:
      next.urls = [...lines]
      break
    case FIELD_TRACK_COUNT:
      throw new Error(`field "${field}" is read-only`)
    default:
      throw new Error(`unknown field "${field}"`)
  }
  if (next.mixed) {
    delete next.mixed[field]
    if (Object.keys(next.mixed).length === 0) {
      next.mixed = undefined
    }
  }
  return next
}

export function displayTrackValueLines(track: Track | undefined, field: string): string[] {
  const lines = editorTrackValueLines(track ?? {}, field)
  if (lines.length === 0) {
    return [DISPLAY_EMPTY]
  }
  return lines
}

export function editorTrackValue(track: Track | undefined, field: string): string {
  return editorTrackValueLines(track ?? {}, field).join('\n')
}

export function editorTrackValueLines(track: Track, field: string): string[] {
  switch (field) {
    case FIELD_ARTISTS:
      return formatArtists(track.artists ?? [])
    case FIELD_TITLE:
      return nonEmptyLines(track.title ?? '')
    case FIELD_DISC_NUMBER:
      return nonEmptyLines(track.discNumber ?? '')
    case FIELD_TRACK_NUMBER:
      return nonEmptyLines(track.trackNumber ?? '')
    default:
      return []
  }
}

export function setTrackFieldEditorValue(
  r: Release,
  trackIndex: number,
  field: string,
  value: string
): Release {
  if (trackIndex < 0) {
    throw new Error(`invalid track index "${trackIndex}"`)
  }
  const next = cloneRelease(r)
  const tracks = [...(next.tracks ?? [])]
  while (tracks.length <= trackIndex) {
    tracks.push({})
  }
  const track = cloneTrack(tracks[trackIndex] ?? {})
  const lines = cleanLines(value, false)
  switch (field) {
    case FIELD_ARTISTS:
      track.artists = parseArtists(lines)
      break
    case FIELD_TITLE:
      track.title = firstOrEmpty(lines)
      break
    case FIELD_DISC_NUMBER:
      track.discNumber = firstOrEmpty(lines)
      break
    case FIELD_TRACK_NUMBER:
      track.trackNumber = firstOrEmpty(lines)
      break
    default:
      throw new Error(`unknown track field "${field}"`)
  }
  tracks[trackIndex] = track
  next.tracks = tracks
  return next
}

export function isMultiDiscTracks(tracks: Track[]): boolean {
  return isMultiDisc(tracks.map((track) => track.discNumber))
}

export function trackHeading(track: Track | undefined, index: number, multiDisc: boolean): string {
  const trackNumber = (track?.trackNumber ?? '').trim() || String(index + 1)
  const discNumber = (track?.discNumber ?? '').trim() || '1'
  const title = (track?.title ?? '').trim() || 'Untitled'
  const number = multiDisc ? `${discNumber}-${trackNumber}` : trackNumber
  return `${number}. ${title}`
}

export function mergeTrackFields(preferred: Track, fallback: Track): Track {
  return {
    discNumber: preferred.discNumber || fallback.discNumber,
    trackNumber: preferred.trackNumber || fallback.trackNumber,
    title: preferred.title || fallback.title,
    artists:
      preferred.artists && preferred.artists.length > 0
        ? preferred.artists.map((a) => ({ ...a }))
        : fallback.artists
          ? fallback.artists.map((a) => ({ ...a }))
          : undefined
  }
}

export function deriveAlbumArtist(artists: Artist[]): string {
  const main: string[] = []
  const seen = new Set<string>()
  for (const artist of artists) {
    const role = normalizeArtistRole(artist.role ?? '')
    const name = artist.name ?? ''
    if (!name || role !== DEFAULT_ARTIST_ROLE) {
      continue
    }
    const key = name.trim().toLowerCase()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    main.push(name)
  }
  switch (main.length) {
    case 0:
      return ''
    case 1:
      return main[0]!
    case 2:
      return `${main[0]} & ${main[1]}`
    default:
      if (main.length >= 4) {
        return 'Various Artists'
      }
      return main.join(', ')
  }
}

export function parseArtists(lines: string[]): Artist[] {
  const artists: Artist[] = []
  const seen = new Set<string>()
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let name = line
    let role = DEFAULT_ARTIST_ROLE
    const open = line.lastIndexOf('[')
    if (open >= 0 && line.endsWith(']')) {
      const candidateName = line.slice(0, open).trim()
      const candidateRole = line.slice(open + 1, -1).trim()
      if (candidateName && candidateRole) {
        name = candidateName
        role = normalizeArtistRole(candidateRole)
      }
    }
    const key = `${name.toLowerCase()}\0${role}`
    if (seen.has(key)) continue
    seen.add(key)
    artists.push({ name, role })
  }
  return artists
}

const artistSplitPattern = /\s*(?:,|;|\/|&|\band\b|\bfeat(?:\.|uring)?\b|\bft\.?\b|\bvs\.?\b)\s*/gi
const artistFeatPattern = /\s*[([{]?\s*(?:feat(?:\.|uring)?|ft\.?)\s+/i

export function parseArtistCreditValues(values: string[]): Artist[] {
  const artists: Artist[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const parts = value.split(artistFeatPattern)
    const mainArtists = splitArtistCreditNames(parts[0] ?? '')
    for (const name of mainArtists) {
      const key = `${name.toLowerCase()}\0${DEFAULT_ARTIST_ROLE}`
      if (seen.has(key)) continue
      seen.add(key)
      artists.push({ name, role: DEFAULT_ARTIST_ROLE })
    }
    if (parts.length < 2) continue
    for (let i = 1; i < parts.length; i++) {
      for (const name of splitArtistCreditNames(parts[i] ?? '')) {
        const key = `${name.toLowerCase()}\0guest`
        if (seen.has(key)) continue
        seen.add(key)
        artists.push({ name, role: 'guest' })
      }
    }
  }
  return artists
}

export function joinphraseIndicatesFeatured(joinphrase: string): boolean {
  return /\b(?:feat(?:\.|uring)?|ft\.?)\b/i.test(joinphrase)
}

const titleFeatPattern = /(?:^|[\s([{])(?:feat(?:\.|uring)?|ft\.?)\s+([^)\]}]+)/gi
const titleFeatParenPattern = /\s*[([{]\s*(?:feat(?:\.|uring)?|ft\.?)\s+[^)\]}]+[)\]}]/gi
const titleFeatBarePattern = /\s+(?:feat(?:\.|uring)?|ft\.?)\s+.+$/i

export function featuredArtistsFromTitle(title: string): Artist[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of title.matchAll(titleFeatPattern)) {
    for (const name of splitArtistCreditNames(match[1] ?? '')) {
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
  }
  return names.map((name) => ({ name, role: 'guest' }))
}

export function stripFeaturedFromTitle(title: string): string {
  let next = title.trim()
  if (!next) return ''
  next = next.replace(titleFeatParenPattern, '')
  next = next.replace(titleFeatBarePattern, '')
  next = next.replace(/^[-–—:|]+|[-–—:|]+$/g, '').trim()
  return next.split(/\s+/).filter(Boolean).join(' ')
}

export function applyFeaturedArtistsFromTitle(track: Track): Track {
  const originalTitle = track.title ?? ''
  const featured = featuredArtistsFromTitle(originalTitle)
  const nextTitle = stripFeaturedFromTitle(originalTitle)
  const titleChanged = nextTitle !== originalTitle

  const artists = track.artists ? track.artists.map((a) => ({ ...a })) : []
  const seen = new Set(
    artists.map((artist) => (artist.name ?? '').trim().toLowerCase()).filter(Boolean)
  )
  let artistsChanged = false
  for (const guest of featured) {
    const key = (guest.name ?? '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    artists.push({ ...guest })
    artistsChanged = true
  }

  if (!artistsChanged && !titleChanged) return track
  return {
    ...track,
    title: titleChanged ? nextTitle : track.title,
    artists: artistsChanged ? artists : track.artists
  }
}

function splitArtistCreditNames(value: string): string[] {
  value = value.trim()
  if (!value) return []
  const parts = value.split(artistSplitPattern)
  const names: string[] = []
  for (const part of parts) {
    const trimmed = cleanArtistCreditName(part)
    if (trimmed) names.push(trimmed)
  }
  return uniqueStringsStable(names)
}

function cleanArtistCreditName(value: string): string {
  return value
    .replace(/^[(\[{]+/, '')
    .replace(/[)\]}]+$/, '')
    .trim()
}

export function formatArtists(artists: Artist[]): string[] {
  if (artists.length === 0) return []
  const lines: string[] = []
  for (const artist of artists) {
    if (!(artist.name ?? '').trim()) continue
    lines.push(`${artist.name} [${normalizeArtistRole(artist.role ?? '')}]`)
  }
  return lines
}

export function normalizeArtistRole(role: string): string {
  role = role.trim().toLowerCase()
  if (!role) return DEFAULT_ARTIST_ROLE
  return role
}

export function artistHasMainRole(artist: Artist): boolean {
  return normalizeArtistRole(artist.role ?? '') === DEFAULT_ARTIST_ROLE
}

export function hasMainArtist(artists: Artist[]): boolean {
  return artists.some(artistHasMainRole)
}

export function hasNamedMainArtist(artists: Artist[]): boolean {
  return artists.some((artist) => artistHasMainRole(artist) && Boolean((artist.name ?? '').trim()))
}

export function artistRoleLabel(role: string): string {
  switch (normalizeArtistRole(role)) {
    case 'main':
      return 'Main'
    case 'guest':
      return 'Guest'
    case 'composer':
      return 'Composer'
    case 'conductor':
      return 'Conductor'
    case 'dj/compiler':
      return 'DJ / Compiler'
    case 'remixer':
      return 'Remixer'
    case 'producer':
      return 'Producer'
    case 'arranger':
      return 'Arranger'
    default: {
      const normalized = normalizeArtistRole(role)
      return normalized.charAt(0).toUpperCase() + normalized.slice(1)
    }
  }
}

export function cycleArtistRole(role: string, delta: number): string {
  const presets = ARTIST_ROLE_PRESETS as readonly string[]
  if (presets.length === 0) {
    return normalizeArtistRole(role)
  }
  const current = normalizeArtistRole(role)
  let index = presets.indexOf(current)
  if (index < 0) {
    return delta < 0 ? presets[presets.length - 1]! : presets[0]!
  }
  index = (index + delta) % presets.length
  if (index < 0) index += presets.length
  return presets[index]!
}

export function uniqueStringsStable(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
  }
  return unique
}

export function sortedUniqueStrings(values: string[]): string[] {
  return uniqueStringsStable(values).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  )
}

function cleanLines(value: string, preserveParagraphs: boolean): string[] {
  if (preserveParagraphs) {
    value = value.replace(/\r\n/g, '\n')
    const lines = value.trim().split('\n').map((line) => line.replace(/[ \t]+$/g, ''))
    return trimEmptyEdges(lines)
  }
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const cleaned: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) cleaned.push(trimmed)
  }
  return cleaned
}

function splitMultiline(value: string): string[] {
  const lines = cleanLines(value, true)
  return lines.length === 0 ? [] : lines
}

function trimEmptyEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start]!.trim()) start++
  while (end > start && !lines[end - 1]!.trim()) end--
  return lines.slice(start, end)
}

function nonEmptyLines(value: string): string[] {
  value = value.trim()
  return value ? [value] : []
}

function firstOrEmpty(lines: string[]): string {
  return lines[0] ?? ''
}
