import type { NamingConfig } from '../types/config'
import type { FilesSnapshot, Release, SourceMedia, TranscodeEncoding } from '../types/upload'

export interface PlannedFileName {
  id: string
  currentPath: string
  targetPath: string
  targetFilename: string
  changed: boolean
}

export interface FilesRenamePlan {
  folderName: string
  files: PlannedFileName[]
  errors: string[]
  warnings: string[]
  hash: string
}

const TRACK_KEYS = new Set(['trackNumber', 'discNumber', 'title', 'artist'])
const DISC_KEYS = new Set(['discNumber', 'discTotal'])
const UNICODE_FORMAT_CHARACTERS = /\p{Cf}/gu
const FOLDER_KEYS = new Set([
  'artists', 'albumArtist', 'title', 'year', 'groupYear', 'editionTitle', 'label',
  'catNo', 'upc', 'catNoOrUpc', 'source', 'format', 'encoding', 'releaseType'
])

interface TemplatePart {
  kind: 'field' | 'text'
  value: string
}

function parseNamingTemplate(template: string): { parts: TemplatePart[]; unmatchedBrace: boolean } {
  const parts: TemplatePart[] = []
  let text = ''
  let unmatchedBrace = false

  const pushText = (): void => {
    if (!text) return
    parts.push({ kind: 'text', value: text })
    text = ''
  }

  for (let index = 0; index < template.length;) {
    const character = template[index]
    const next = template[index + 1]

    if (character === '{' && next === '{') {
      text += '{'
      index += 2
      continue
    }
    if (character === '}' && next === '}') {
      text += '}'
      index += 2
      continue
    }
    if (character === '{') {
      const close = template.indexOf('}', index + 1)
      const key = close === -1 ? '' : template.slice(index + 1, close)
      if (close === -1 || !key || key.includes('{')) {
        unmatchedBrace = true
        text += character
        index += 1
        continue
      }
      pushText()
      parts.push({ kind: 'field', value: key })
      index = close + 1
      continue
    }
    if (character === '}') unmatchedBrace = true
    text += character
    index += 1
  }

  pushText()
  return { parts, unmatchedBrace }
}

export function validateNamingTemplate(template: string, allowed: ReadonlySet<string>): string[] {
  const errors: string[] = []
  const parsed = parseNamingTemplate(template)
  for (const part of parsed.parts) {
    if (part.kind === 'field' && !allowed.has(part.value)) {
      errors.push(`Unknown template field {${part.value}}.`)
    }
  }
  if (parsed.unmatchedBrace) errors.push('Template contains an unmatched brace.')
  return errors
}

export const validateTrackFileTemplate = (template: string): string[] => validateNamingTemplate(template, TRACK_KEYS)
export const validateMultiDiscFolderTemplate = (template: string): string[] => validateNamingTemplate(template, DISC_KEYS)
export const validateReleaseFolderTemplate = (template: string): string[] => validateNamingTemplate(template, FOLDER_KEYS)

export function buildFilesRenamePlan(input: {
  release: Release
  files: FilesSnapshot
  naming: NamingConfig
  sourceMedia: SourceMedia | ''
  encoding?: TranscodeEncoding
}): FilesRenamePlan {
  const { release, files, naming } = input
  const warnings: string[] = []
  const errors = [
    ...validateNamingTemplate(naming.trackFileTemplate, TRACK_KEYS),
    ...validateNamingTemplate(naming.multiDiscFolderTemplate, DISC_KEYS),
    ...validateNamingTemplate(naming.releaseFolderTemplate, FOLDER_KEYS)
  ]
  const trackTotal = release.tracks?.length ?? 0
  if (trackTotal !== files.apply.files.length) {
    errors.push(`The release has ${trackTotal} tracks but the folder has ${files.apply.files.length} FLAC files.`)
  }
  const discTotal = Math.max(1, ...(release.tracks ?? []).map((track) => numberValue(track.discNumber)))
  const proposed = files.apply.files.map((file, index): PlannedFileName => {
    const track = release.tracks?.[index] ?? {}
    const manual = file.filenameOverride
    const generated = renderTemplate(naming.trackFileTemplate, {
      trackNumber: padNumber(track.trackNumber, index + 1),
      discNumber: padNumber(track.discNumber, 1),
      title: track.title ?? '',
      artist: mainArtists(track.artists)
    })
    const targetFilename = files.apply.grandfathered
      ? file.currentPath.split('/').at(-1) ?? file.currentPath
      : manual ? normalizeManualFlacName(manual) : `${sanitize(generated)}.flac`
    const manualError = manual ? validateManualName(manual) : undefined
    if (manualError) errors.push(`${file.currentPath}: ${manualError}`)
    if (targetFilename.toLocaleLowerCase() === '.flac') errors.push(`${file.currentPath}: Filename cannot be empty.`)
    const discFolder = discTotal > 1
      ? sanitize(renderTemplate(naming.multiDiscFolderTemplate, {
          discNumber: padNumber(track.discNumber, 1),
          discTotal: String(discTotal).padStart(2, '0')
        }))
      : ''
    const targetPath = files.apply.grandfathered
      ? file.currentPath
      : discFolder ? `${discFolder}/${targetFilename}` : targetFilename
    return { id: file.id, currentPath: file.currentPath, targetPath, targetFilename, changed: file.currentPath !== targetPath }
  })
  const lowered = new Map<string, string>()
  for (const file of proposed) {
    const key = file.targetPath.toLocaleLowerCase()
    const prior = lowered.get(key)
    if (prior && prior !== file.currentPath) errors.push(`Two tracks would be named ${file.targetPath}.`)
    lowered.set(key, file.currentPath)
  }

  const year = release.year || release.groupYear || ''
  const catNo = release.catNo ?? ''
  const upc = release.upc ?? ''
  const generatedFolder = sanitize(renderTemplate(naming.releaseFolderTemplate, {
    artists: mainArtists(release.artists),
    albumArtist: release.albumArtist ?? '',
    title: release.title ?? '',
    year,
    groupYear: release.groupYear ?? '',
    editionTitle: release.editionTitle ?? '',
    label: release.label ?? '',
    catNo,
    upc,
    catNoOrUpc: catNo.trim() ? catNo : upc,
    source: input.sourceMedia,
    format: input.encoding === '24bit Lossless' ? '24bit FLAC' : 'FLAC',
    encoding: input.encoding ?? 'Lossless',
    releaseType: release.releaseType ?? ''
  }))
  const folderName = files.apply.grandfathered
    ? files.apply.currentFolderName
    : files.apply.renameReleaseFolder
    ? (files.apply.folderNameOverride ? normalizeManualName(files.apply.folderNameOverride) : generatedFolder)
    : files.apply.currentFolderName
  const folderError = files.apply.folderNameOverride ? validateManualName(files.apply.folderNameOverride) : undefined
  if (folderError) errors.push(`Release folder: ${folderError}`)
  if (!folderName) errors.push('The release folder name is empty.')
  for (const file of proposed) {
    const length = `${folderName}/${file.targetPath}`.length
    if (length > 250) errors.push(`${file.targetPath}: Path is longer than 250 characters.`)
    else if (length > 180) warnings.push(`${file.targetPath}: Path is longer than 180 characters.`)
  }
  const hash = stableHash(JSON.stringify({ folderName, files: proposed.map((file) => [file.id, file.targetPath]), strip: files.apply.stripEmbeddedCoverArt, release }))
  return { folderName, files: proposed, errors: [...new Set(errors)], warnings: [...new Set(warnings)], hash }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  let value = parseNamingTemplate(template).parts
    .map((part) => part.kind === 'field' ? values[part.value] ?? '' : part.value)
    .join('')
  value = value.replace(/\([^()]*\)/g, (part) => hasUsefulText(part.slice(1, -1)) ? part : '')
  value = value.replace(/\[[^\[\]]*\]/g, (part) => hasUsefulText(part.slice(1, -1)) ? part : '')
  value = value.replace(/\{[^{}]*\}/g, (part) => {
    const content = part.slice(1, -1).replace(/^[\s,;:/_-]+|[\s,;:/_-]+$/g, '')
    return hasUsefulText(content) ? `{${content}}` : ''
  })
  return value.replace(/\s+/g, ' ').replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, '').trim()
}

function hasUsefulText(value: string): boolean {
  return value.replace(/[\s,;:/_-]+/g, '').length > 0
}

function mainArtists(artists?: Release['artists']): string {
  const names = [...new Set((artists ?? []).filter((artist) => !artist.role || artist.role === 'main').map((artist) => artist.name?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b))
  if (names.length > 4) return 'Various'
  if (names.length <= 2 && !names.some((name) => name.includes('&'))) return names.join(' & ')
  return names.join(', ')
}

function padNumber(value: string | undefined, fallback: number): string {
  const parsed = numberValue(value) || fallback
  return String(parsed).padStart(2, '0')
}

function numberValue(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Single source of truth for "does this release span more than one disc".
 *
 * A release is multi-disc when any track carries a disc number above 1. Reading
 * the leading integer means `"1"`, `"01"` and `"1/1"` all count as disc one, the
 * same rule the folder layout above uses (`discTotal > 1`). The tracklist and
 * the Tags screen route through here so all three agree on the same tags.
 */
export function isMultiDisc(discNumbers: Array<string | undefined>): boolean {
  return discNumbers.some((disc) => numberValue(disc) > 1)
}

function sanitize(value: string): string {
  return value
    .replace(UNICODE_FORMAT_CHARACTERS, '')
    .replace(/[\u0000-\u001f:?<>\\*|"/]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
}

function validateManualName(value: string): string | undefined {
  const name = normalizeManualName(value)
  if (!name) return 'Name cannot be empty.'
  if (name === '.' || name === '..') return 'Name is reserved by the filesystem.'
  if (/[\u0000-\u001f:?<>\\*|"/]/.test(name)) return 'Name contains a character which is not allowed.'
  if (/[. ]$/.test(name)) return 'Name cannot end with a dot or space.'
  const stem = name.replace(/\.flac$/i, '').split('.')[0]?.toUpperCase() ?? ''
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) return 'Name is reserved by the filesystem.'
  return undefined
}

function normalizeManualName(value: string): string {
  return value.replace(UNICODE_FORMAT_CHARACTERS, '').trim()
}

function normalizeManualFlacName(value: string): string {
  return `${normalizeManualName(value).replace(/\.flac$/i, '')}.flac`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
