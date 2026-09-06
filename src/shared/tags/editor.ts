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
      return 'Original release date'
    case FIELD_YEAR:
      return 'Edition release date'
    case FIELD_EDITION_TITLE:
      return 'Edition Title'
    case FIELD_LABEL:
      return 'Record label'
    case FIELD_CAT_NO:
      return 'Catalogue number'
    case FIELD_UPC:
      return 'Barcode (UPC/EAN)'
    case FIELD_GENRES:
      return 'Genres'
    case FIELD_RELEASE_TYPE:
      return 'Release Type'
    case FIELD_COMMENT:
      return 'Comment'
    case FIELD_URLS:
      return 'Metadata URLs'
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

export function textValueLinesEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return left.length === right.length && left.every(
    (value, index) => value.normalize('NFC') === right[index]!.normalize('NFC')
  )
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
      next.comment = value.normalize('NFC').trim()
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
  const artists = mergeArtistCredits(preferred.artists, fallback.artists)
  return {
    discNumber: preferred.discNumber || fallback.discNumber,
    trackNumber: preferred.trackNumber || fallback.trackNumber,
    title: preferred.title || fallback.title,
    artists: artists.length > 0 ? artists : undefined
  }
}

export function mergeArtistCredits(
  preferred: Artist[] | undefined,
  fallback: Artist[] | undefined
): Artist[] {
  const preferredByRole = artistsByRole(preferred)
  const fallbackByRole = artistsByRole(fallback)
  const roles = [...new Set([...preferredByRole.keys(), ...fallbackByRole.keys()])]
  const merged: Artist[] = []
  const seen = new Set<string>()

  for (const role of roles) {
    const preferredArtists = preferredByRole.get(role) ?? []
    const fallbackArtists = fallbackByRole.get(role) ?? []
    const candidates = role === 'composer' || role === 'conductor'
      ? [...fallbackArtists, ...preferredArtists]
      : preferredArtists.length > 0
        ? preferredArtists
        : fallbackArtists
    for (const artist of candidates) {
      const name = (artist.name ?? '').trim()
      if (!name) continue
      const key = `${artistNameKey(name)}\0${role}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ name, role })
    }
  }
  return merged
}

function artistsByRole(artists: Artist[] | undefined): Map<string, Artist[]> {
  const result = new Map<string, Artist[]>()
  for (const artist of artists ?? []) {
    const role = normalizeArtistRole(artist.role ?? '')
    result.set(role, [...(result.get(role) ?? []), artist])
  }
  return result
}

export function artistNameKey(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export interface ArtistRename {
  from: string
  to: string
}

export interface ArtistEditRow {
  artist: Artist
  sourceName: string | null
}

export function artistRenamesFromRows(rows: readonly ArtistEditRow[]): ArtistRename[] {
  const edits = new Map<string, { from: string; targets: Set<string> }>()
  for (const row of rows) {
    const from = row.sourceName?.trim().normalize('NFC') ?? ''
    const to = (row.artist.name ?? '').trim().normalize('NFC')
    if (!from || !to) continue
    const key = artistNameKey(from)
    const edit = edits.get(key) ?? { from, targets: new Set<string>() }
    edit.targets.add(to)
    edits.set(key, edit)
  }
  return [...edits.values()].flatMap(({ from, targets }) => {
    if (targets.size !== 1) return []
    const [to] = targets
    return to && from !== to ? [{ from, to }] : []
  })
}

export function applyArtistRenamesToTracks(
  release: Release,
  renames: readonly ArtistRename[]
): Release {
  const names = new Map<string, string>()
  for (const rename of renames) {
    const from = artistNameKey(rename.from)
    const to = rename.to.trim().normalize('NFC')
    if (from && to) names.set(from, to)
  }
  if (names.size === 0 || !release.tracks) return release

  let releaseChanged = false
  const tracks = release.tracks.map((track) => {
    let trackChanged = false
    const renamedKeys = new Set<string>()
    const renamed = (track.artists ?? []).map((artist) => {
      const name = names.get(artistNameKey(artist.name ?? ''))
      if (!name) return artist
      trackChanged = true
      const next = { ...artist, name }
      renamedKeys.add(artistCreditKey(next))
      return next
    })
    if (!trackChanged) return track

    releaseChanged = true
    const seen = new Set<string>()
    const artists = renamed.filter((artist) => {
      const key = artistCreditKey(artist)
      if (!renamedKeys.has(key)) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { ...track, artists }
  })
  return releaseChanged ? { ...release, tracks } : release
}

function artistCreditKey(artist: Artist): string {
  return `${artistNameKey(artist.name ?? '')}\0${normalizeArtistRole(artist.role ?? '')}`
}

export function albumArtistDisplayNames(artists: Artist[]): string[] {
  const main: string[] = []
  const seen = new Set<string>()
  for (const artist of artists) {
    const role = normalizeArtistRole(artist.role ?? '')
    const name = artist.name ?? ''
    if (!name || role !== DEFAULT_ARTIST_ROLE) {
      continue
    }
    const key = artistNameKey(name)
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    main.push(name)
  }
  return main.length >= 4 ? ['Various Artists'] : main
}

export function deriveAlbumArtist(artists: Artist[]): string {
  const main = albumArtistDisplayNames(artists)
  switch (main.length) {
    case 0:
      return ''
    case 1:
      return main[0]!
    case 2:
      return `${main[0]} & ${main[1]}`
    default:
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
    const key = `${artistNameKey(name)}\0${role}`
    if (seen.has(key)) continue
    seen.add(key)
    artists.push({ name, role })
  }
  return artists
}

const artistFeatPattern = /(?:^|\s+|[([{])\s*(?:feat(?:\.|uring)?|ft\.?)\s+/i
const listSeparatorTest = /[,;/&]|\band\b|\bvs\.?\b/i
const otherListSeparatorTest = /[;/&]|\band\b|\bvs\.?\b/i

export type SeparatorArtistAction = 'split' | 'reorder' | 'keep'

export interface SeparatorArtistOption {
  action: SeparatorArtistAction
  label: string
}

export function parseArtistCreditValues(values: string[]): Artist[] {
  const artists: Artist[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const parts = value.split(artistFeatPattern)
    const mainName = cleanArtistCreditName(parts[0] ?? '')
    if (mainName) {
      const key = `${artistNameKey(mainName)}\0${DEFAULT_ARTIST_ROLE}`
      if (!seen.has(key)) {
        seen.add(key)
        artists.push({ name: mainName, role: DEFAULT_ARTIST_ROLE })
      }
    }
    if (parts.length < 2) continue
    for (let i = 1; i < parts.length; i++) {
      const name = cleanArtistCreditName(parts[i] ?? '')
      if (!name) continue
      const key = `${artistNameKey(name)}\0guest`
      if (seen.has(key)) continue
      seen.add(key)
      artists.push({ name, role: 'guest' })
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
    const name = cleanArtistCreditName(match[1] ?? '')
    const key = artistNameKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    names.push(name)
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
    artists.map((artist) => artistNameKey(artist.name ?? '')).filter(Boolean)
  )
  let artistsChanged = false
  for (const guest of featured) {
    const key = artistNameKey(guest.name ?? '')
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

function cleanArtistCreditName(value: string): string {
  return value
    .replace(/^[(\[{]+/, '')
    .replace(/[)\]}]+$/, '')
    .trim()
}

export function artistNameHasListSeparator(name: string): boolean {
  return listSeparatorTest.test(name)
}

export function artistCreditIsPending(artist: Artist): boolean {
  if (artist.separatorKept) return false
  return artistNameHasListSeparator(artist.name ?? '')
}

export function pendingSeparatorArtists(release: Release | undefined): string[] {
  if (!release) return []
  const names: string[] = []
  const seen = new Set<string>()
  const consider = (artists: Artist[] | undefined): void => {
    for (const artist of artists ?? []) {
      if (!artistCreditIsPending(artist)) continue
      const name = (artist.name ?? '').trim()
      const key = artistNameKey(name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
  }
  consider(release.artists)
  for (const track of release.tracks ?? []) consider(track.artists)
  return names
}

export function keepSeparatorArtists(artists: Artist[]): Artist[] {
  return artists.map((artist) => {
    if (!artistCreditIsPending(artist)) return artist
    return { ...artist, separatorKept: true }
  })
}

export function separatorArtistOptions(name: string): SeparatorArtistOption[] {
  const parts = splitListSeparatorParts(name)
  const options: SeparatorArtistOption[] = []
  if (parts.length >= 2) {
    if (isCommaOnlyName(name)) {
      const swapped = [parts[1]!, parts[0]!]
      options.push({ action: 'split', label: `Split into ${swapped.join(' + ')}` })
      options.push({ action: 'reorder', label: `Reorder as ${parts[1]} ${parts[0]}` })
    } else {
      options.push({ action: 'split', label: `Split into ${parts.join(' + ')}` })
    }
  }
  options.push({ action: 'keep', label: 'Keep as one artist' })
  return options
}

export function applySeparatorArtistAction(
  release: Release,
  rawName: string,
  action: SeparatorArtistAction
): Release {
  const next = cloneRelease(release)
  const key = artistNameKey(rawName)
  const replace = (artists: Artist[] | undefined): Artist[] | undefined => {
    if (!artists) return artists
    const out: Artist[] = []
    const seen = new Set<string>()
    for (const artist of artists) {
      const replacements =
        artistNameKey(artist.name ?? '') === key
          ? replacementArtists(artist, action)
          : [artist]
      for (const item of replacements) {
        const itemKey = `${artistNameKey(item.name ?? '')}\0${normalizeArtistRole(item.role ?? '')}`
        if (seen.has(itemKey)) continue
        seen.add(itemKey)
        out.push(item)
      }
    }
    return out
  }
  next.artists = replace(next.artists)
  if (next.tracks) {
    next.tracks = next.tracks.map((track) => ({
      ...track,
      artists: replace(track.artists)
    }))
  }
  if (artistNameKey(next.albumArtist ?? '') === key) {
    if (action === 'reorder') {
      const parts = splitListSeparatorParts(rawName)
      next.albumArtist = parts.length === 2 ? `${parts[1]} ${parts[0]}` : rawName
    } else if (action === 'split') {
      next.albumArtist = deriveAlbumArtist(next.artists ?? [])
    }
  }
  return next
}

function isCommaOnlyName(name: string): boolean {
  const commaCount = (name.match(/,/g) ?? []).length
  return commaCount === 1 && !otherListSeparatorTest.test(name)
}

function splitListSeparatorParts(name: string): string[] {
  return name
    .split(/\s*(?:,|;|\/|&|\band\b|\bvs\.?\b)\s*/gi)
    .map((part) => part.trim())
    .filter(Boolean)
}

function replacementArtists(artist: Artist, action: SeparatorArtistAction): Artist[] {
  const name = artist.name ?? ''
  const role = artist.role
  if (action === 'keep') {
    return [{ name, role, separatorKept: true }]
  }
  const parts = splitListSeparatorParts(name)
  if (parts.length < 2) {
    return [{ name, role, separatorKept: true }]
  }
  if (action === 'reorder') {
    return [{ name: `${parts[1]} ${parts[0]}`, role }]
  }
  const splitParts = isCommaOnlyName(name) ? [parts[1]!, parts[0]!] : parts
  return splitParts.map((part) => ({ name: part, role }))
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
  value = value.normalize('NFC')
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
