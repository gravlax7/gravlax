import { open, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { Artist, Release, Track } from '@shared/types'
import { discoverFLACFiles, type FlacFile } from '@main/core/tools/flacFiles'
import {
  FIELD_ALBUM_ARTIST,
  FIELD_ARTISTS,
  FIELD_CAT_NO,
  FIELD_COMMENT,
  FIELD_EDITION_TITLE,
  FIELD_GENRES,
  FIELD_LABEL,
  FIELD_RELEASE_TYPE,
  FIELD_TITLE,
  FIELD_UPC,
  FIELD_URLS,
  FIELD_YEAR
} from '@shared/types/upload'
import {
  applyFeaturedArtistsFromTitle,
  deriveAlbumArtist,
  formatArtists,
  parseArtistCreditValues,
  sortedUniqueStrings,
  uniqueStringsStable
} from '@shared/tags/editor'

interface FlacTags {
  values: Record<string, string[]>
  pictureCount: number
}

const urlTagKeys = ['URL', 'URLS', 'WWW', 'WEBSITE']

export async function extractAlbumRelease(path: string): Promise<Release> {
  return (await extractAlbumReleaseWithEmbeddedCoverArt(path)).release
}

export async function extractAlbumReleaseWithEmbeddedCoverArt(
  path: string
): Promise<{ release: Release; embeddedCoverArtCount: number }> {
  const files = await discoverFLACInput(path)
  if (files.length === 0) {
    throw new Error('no tagged FLAC files were found in the workspace')
  }

  const tagSets: FlacTags[] = []
  const tracks: Track[] = []
  let embeddedCoverArtCount = 0
  for (const file of files) {
    const tagSet = await readFLACTags(file.absolutePath)
    tagSets.push(tagSet)
    tracks.push(buildTrack(tagSet))
    embeddedCoverArtCount += tagSet.pictureCount + (tagSet.values.COVERART?.length ?? 0)
  }

  const mixed: Record<string, boolean> = {}
  const release: Release = {
    trackCount: files.length,
    tracks,
    mixed
  }

  release.title = sharedScalar(tagSets, mixed, FIELD_TITLE, 'ALBUM')
  const year = sharedYear(tagSets, mixed, FIELD_YEAR, 'DATE', 'YEAR')
  release.year = year
  release.groupYear = year
  release.label = sharedScalar(tagSets, mixed, FIELD_LABEL, 'LABEL')
  release.catNo = sharedScalar(tagSets, mixed, FIELD_CAT_NO, 'CATALOGNUMBER', 'CATALOG NUMBER', 'CATNO')
  release.upc = sharedScalar(tagSets, mixed, FIELD_UPC, 'UPC', 'BARCODE')
  release.comment = sharedScalar(tagSets, mixed, FIELD_COMMENT, 'COMMENT', 'DESCRIPTION')
  release.editionTitle = sharedScalar(tagSets, mixed, FIELD_EDITION_TITLE, 'EDITIONTITLE', 'EDITION TITLE')
  release.releaseType = sharedScalar(tagSets, mixed, FIELD_RELEASE_TYPE, 'RELEASETYPE', 'RELEASE TYPE')
  release.genres = sharedList(tagSets, mixed, FIELD_GENRES, splitGenreValues, 'GENRE')
  release.urls = sharedList(tagSets, mixed, FIELD_URLS, splitURLValues, ...urlTagKeys)

  const albumArtists = commonArtistTagSet(tagSets, 'ALBUMARTIST', 'ALBUM ARTIST')
  if (albumArtists.ok) {
    release.artists = albumArtists.artists
    if (albumArtists.mixed) {
      mixed[FIELD_ARTISTS] = true
    }
  } else {
    const aggregated = aggregateTrackArtists(tracks)
    if (aggregated.artists.length > 0) {
      release.artists = aggregated.artists
      if (aggregated.mixed) {
        mixed[FIELD_ARTISTS] = true
      }
    } else {
      mixed[FIELD_ARTISTS] = false
    }
  }

  const albumArtist = sharedScalar(tagSets, null, FIELD_ALBUM_ARTIST, 'ALBUMARTIST', 'ALBUM ARTIST')
  release.albumArtist = albumArtist || deriveAlbumArtist(release.artists ?? [])

  if (Object.keys(mixed).length === 0) {
    release.mixed = undefined
  }
  return { release, embeddedCoverArtCount }
}

async function discoverFLACInput(path: string): Promise<FlacFile[]> {
  const info = await stat(path)
  if (info.isDirectory()) {
    return discoverFLACFiles(path)
  }
  if (extname(info.isFile() ? basename(path) : '').toLowerCase() !== '.flac') {
    throw new Error(`tag input "${path}" must be a directory or FLAC file`)
  }
  return [{ absolutePath: path, relativePath: basename(path) }]
}

export async function readFLACTags(path: string): Promise<FlacTags> {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(4)
    await readExact(handle, header, 0)
    if (header.toString('utf8') !== 'fLaC') {
      throw new Error('not a FLAC file')
    }

    let position = 4
    let values: Record<string, string[]> = {}
    let pictureCount = 0
    for (;;) {
      const blockHeader = Buffer.alloc(4)
      await readExact(handle, blockHeader, position)
      position += blockHeader.length
      const isLast = (blockHeader[0]! & 0x80) !== 0
      const blockType = blockHeader[0]! & 0x7f
      const blockLength = (blockHeader[1]! << 16) | (blockHeader[2]! << 8) | blockHeader[3]!
      if (blockType === 4) {
        const payload = Buffer.alloc(blockLength)
        await readExact(handle, payload, position)
        values = parseVorbisComments(payload).values
      } else if (blockType === 6) {
        pictureCount += 1
      }
      position += blockLength
      if (isLast) break
    }
    return { values, pictureCount }
  } finally {
    await handle.close()
  }
}

async function readExact(
  handle: Awaited<ReturnType<typeof open>>,
  buf: Buffer,
  position: number
): Promise<void> {
  let offset = 0
  while (offset < buf.length) {
    const { bytesRead } = await handle.read(buf, offset, buf.length - offset, position + offset)
    if (bytesRead === 0) {
      throw new Error('unexpected EOF')
    }
    offset += bytesRead
  }
}

function parseVorbisComments(payload: Buffer): FlacTags {
  let offset = 0
  const readUint32 = (): number => {
    const value = payload.readUInt32LE(offset)
    offset += 4
    return value
  }
  const readString = (): string => {
    const length = readUint32()
    const value = payload.subarray(offset, offset + length).toString('utf8')
    offset += length
    return value
  }

  readString()
  const commentCount = readUint32()
  const values: Record<string, string[]> = {}
  for (let i = 0; i < commentCount; i++) {
    const comment = readString()
    const eq = comment.indexOf('=')
    if (eq < 0) continue
    const key = comment.slice(0, eq).trim().toUpperCase()
    const value = comment.slice(eq + 1).trim()
    if (!key || !value) continue
    ;(values[key] ??= []).push(value)
  }
  return { values, pictureCount: 0 }
}

function buildTrack(tagSet: FlacTags): Track {
  let discNumber = firstTagValue(tagSet, 'DISCNUMBER', 'DISC NUMBER')
  if (!discNumber) discNumber = '1'
  const trackNumber = firstTagValue(tagSet, 'TRACKNUMBER', 'TRACK NUMBER')
  const title = firstTagValue(tagSet, 'TITLE')
  let artists = parseArtistCreditValues(tagValues(tagSet, 'ARTIST'))
  if (artists.length === 0) {
    artists = parseArtistCreditValues(tagValues(tagSet, 'ALBUMARTIST', 'ALBUM ARTIST'))
  }
  return applyFeaturedArtistsFromTitle({
    discNumber: sanitizeNumberTag(discNumber),
    trackNumber: sanitizeNumberTag(trackNumber),
    title,
    artists
  })
}

function commonArtistTagSet(
  tagSets: FlacTags[],
  ...keys: string[]
): { artists: Artist[]; ok: boolean; mixed: boolean } {
  let normalized = ''
  let artists: Artist[] = []
  let mixed = false
  let found = false
  for (const tagSet of tagSets) {
    const currentArtists = parseArtistCreditValues(tagValues(tagSet, ...keys))
    const current = formatArtists(currentArtists).join('\n')
    if (!current) continue
    if (!found) {
      found = true
      normalized = current.toLowerCase()
      artists = currentArtists
      continue
    }
    if (normalized !== current.toLowerCase()) {
      mixed = true
    }
  }
  return { artists, ok: found, mixed }
}

function aggregateTrackArtists(tracks: Track[]): { artists: Artist[]; mixed: boolean } {
  const aggregated: Artist[] = []
  const seen = new Set<string>()
  let firstSet = ''
  let mixed = false
  for (const track of tracks) {
    const rendered = formatArtists(track.artists ?? []).join('\n')
    if (rendered) {
      if (!firstSet) {
        firstSet = rendered.toLowerCase()
      } else if (firstSet !== rendered.toLowerCase()) {
        mixed = true
      }
    }
    for (const artist of track.artists ?? []) {
      const key = `${(artist.name ?? '').trim().toLowerCase()}\0${artist.role ?? ''}`
      if (seen.has(key) || !(artist.name ?? '').trim()) continue
      seen.add(key)
      aggregated.push(artist)
    }
  }
  return { artists: aggregated, mixed }
}

function sharedScalar(
  tagSets: FlacTags[],
  mixed: Record<string, boolean> | null,
  field: string,
  ...keys: string[]
): string {
  let found = false
  let consistent = ''
  let isMixedFlag = false
  for (const tagSet of tagSets) {
    const current = firstTagValue(tagSet, ...keys)
    if (!current) continue
    if (!found) {
      found = true
      consistent = current
      continue
    }
    if (consistent.trim().toLowerCase() !== current.trim().toLowerCase()) {
      isMixedFlag = true
    }
  }
  if (mixed && isMixedFlag) {
    mixed[field] = true
  }
  return consistent.trim()
}

function sharedYear(
  tagSets: FlacTags[],
  mixed: Record<string, boolean> | null,
  field: string,
  ...keys: string[]
): string {
  let found = false
  let consistent = ''
  let isMixedFlag = false
  for (const tagSet of tagSets) {
    const current = extractYear(firstTagValue(tagSet, ...keys))
    if (!current) continue
    if (!found) {
      found = true
      consistent = current
      continue
    }
    if (consistent !== current) {
      isMixedFlag = true
    }
  }
  if (mixed && isMixedFlag) {
    mixed[field] = true
  }
  return consistent
}

function sharedList(
  tagSets: FlacTags[],
  mixed: Record<string, boolean> | null,
  field: string,
  split: (values: string[]) => string[],
  ...keys: string[]
): string[] {
  let found = false
  let consistent: string[] = []
  let isMixedFlag = false
  for (const tagSet of tagSets) {
    const current = split(tagValues(tagSet, ...keys))
    if (current.length === 0) continue
    if (!found) {
      found = true
      consistent = current
      continue
    }
    if (!equalFoldSlices(consistent, current)) {
      isMixedFlag = true
    }
  }
  if (mixed && isMixedFlag) {
    mixed[field] = true
  }
  return [...consistent]
}

function firstTagValue(tagSet: FlacTags, ...keys: string[]): string {
  for (const key of keys) {
    const values = tagSet.values[key.toUpperCase()] ?? []
    for (const value of values) {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
  }
  return ''
}

function tagValues(tagSet: FlacTags, ...keys: string[]): string[] {
  const values: string[] = []
  for (const key of keys) {
    values.push(...(tagSet.values[key.toUpperCase()] ?? []))
  }
  return values
}

function splitGenreValues(values: string[]): string[] {
  const genres: string[] = []
  for (const value of values) {
    for (const part of value.split(/[;/]/)) {
      const trimmed = part.trim()
      if (trimmed) genres.push(trimmed)
    }
  }
  return sortedUniqueStrings(genres)
}

function splitURLValues(values: string[]): string[] {
  const urls: string[] = []
  for (const value of values) {
    for (const part of value.split(/[\n;]/)) {
      const trimmed = part.trim()
      if (trimmed) urls.push(trimmed)
    }
  }
  return uniqueStringsStable(urls)
}

function sanitizeNumberTag(value: string): string {
  value = value.trim()
  if (!value) return ''
  const slash = value.indexOf('/')
  if (slash >= 0) {
    value = value.slice(0, slash)
  }
  return value.trim()
}

function extractYear(value: string): string {
  value = value.trim()
  if (!value) return ''
  const match = /(\d{4})/.exec(value)
  if (!match?.[1]) return ''
  if (Number.isNaN(Number(match[1]))) return ''
  return match[1]
}

function equalFoldSlices(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i]!.trim().toLowerCase() !== right[i]!.trim().toLowerCase()) {
      return false
    }
  }
  return true
}
