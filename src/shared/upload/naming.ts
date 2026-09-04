import type { NamingConfig } from '../types/config'
import type { FilesSnapshot, PayloadPathState, Release, SourceMedia, TranscodeEncoding } from '../types/upload'
import { dateYear } from '../tags/dates'

export interface PlannedFileName {
  id: string
  currentPath: string
  targetPath: string
  targetFilename: string
  changed: boolean
}

export interface PlannedPayloadPath {
  id: string
  kind: 'file' | 'directory'
  currentPath: string
  targetPath: string
  targetName: string
  changed: boolean
  track: boolean
}

export interface FilesRenamePlan {
  folderName: string
  files: PlannedFileName[]
  payloadFiles?: PlannedPayloadPath[]
  folders?: PlannedPayloadPath[]
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
  const proposedTracks = files.apply.files.map((file, index): PlannedFileName => {
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
  const year = dateYear(release.year || release.groupYear)
  const catNo = release.catNo ?? ''
  const upc = release.upc ?? ''
  const generatedFolder = sanitize(renderTemplate(naming.releaseFolderTemplate, {
    artists: mainArtists(release.artists),
    albumArtist: release.albumArtist ?? '',
    title: release.title ?? '',
    year,
    groupYear: dateYear(release.groupYear),
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
  const payloadState: PayloadPathState[] = files.apply.payloadPaths ?? proposedTracks.map((file) => ({
    id: file.id,
    kind: 'file' as const,
    currentPath: file.currentPath,
    originalPath: file.currentPath
  }))
  const sourceDirTargets = new Map<string, Set<string>>()
  for (const track of proposedTracks) {
    const sourceDir = dirnamePosix(track.currentPath)
    const targetDir = dirnamePosix(track.targetPath)
    if (!sourceDir || sourceDir === targetDir) continue
    const targets = sourceDirTargets.get(sourceDir) ?? new Set<string>()
    targets.add(targetDir)
    sourceDirTargets.set(sourceDir, targets)
  }

  const folderStates = payloadState
    .filter((item) => item.kind === 'directory')
    .sort((a, b) => pathDepth(a.currentPath) - pathDepth(b.currentPath))
  const folderTargets = new Map<string, string>()
  const folders: PlannedPayloadPath[] = []
  for (const folder of folderStates) {
    const parent = dirnamePosix(folder.currentPath)
    const mapped = sourceDirTargets.get(folder.currentPath)
    const defaultTarget = mapped?.size === 1
      ? [...mapped][0]!
      : joinPosix(folderTargets.get(parent) ?? parent, basenamePosix(folder.currentPath))
    if (!defaultTarget) {
      folderTargets.set(folder.currentPath, '')
      continue
    }
    const targetName = folder.nameOverride
      ? normalizeManualName(folder.nameOverride)
      : basenamePosix(defaultTarget)
    const manualError = folder.nameOverride ? validateManualName(folder.nameOverride) : undefined
    if (manualError) errors.push(`${folder.currentPath}: ${manualError}`)
    const targetPath = joinPosix(dirnamePosix(defaultTarget), targetName)
    folderTargets.set(folder.currentPath, targetPath)
    folders.push({
      id: folder.id,
      kind: 'directory',
      currentPath: folder.currentPath,
      targetPath,
      targetName,
      changed: folder.currentPath !== targetPath,
      track: false
    })
  }

  const trackById = new Map(proposedTracks.map((file) => [file.id, file]))
  const payloadFiles = payloadState.filter((item) => item.kind === 'file').map((item): PlannedPayloadPath => {
    const track = trackById.get(item.id)
    if (track) {
      const sourceDir = dirnamePosix(item.currentPath)
      const targetDir = folderTargets.get(sourceDir) ?? dirnamePosix(track.targetPath)
      const targetPath = joinPosix(targetDir, track.targetFilename)
      return {
        id: item.id,
        kind: 'file',
        currentPath: item.currentPath,
        targetPath,
        targetName: track.targetFilename,
        changed: item.currentPath !== targetPath,
        track: true
      }
    }
    const manual = item.nameOverride
    const targetName = manual ? normalizeManualName(manual) : basenamePosix(item.currentPath)
    const manualError = manual ? validateManualName(manual) : undefined
    if (manualError) errors.push(`${item.currentPath}: ${manualError}`)
    const sourceDir = dirnamePosix(item.currentPath)
    const targetPath = joinPosix(folderTargets.get(sourceDir) ?? sourceDir, targetName)
    return {
      id: item.id,
      kind: 'file',
      currentPath: item.currentPath,
      targetPath,
      targetName,
      changed: item.currentPath !== targetPath,
      track: false
    }
  })
  const targetById = new Map(payloadFiles.filter((item) => item.track).map((item) => [item.id, item.targetPath]))
  const proposed = proposedTracks.map((file) => {
    const targetPath = targetById.get(file.id) ?? file.targetPath
    return { ...file, targetPath, changed: file.currentPath !== targetPath }
  })

  const lowered = new Map<string, string>()
  for (const file of payloadFiles) {
    const key = unicodePathKey(file.targetPath)
    const prior = lowered.get(key)
    if (prior && prior !== file.currentPath) errors.push(`Two files would be named ${file.targetPath}.`)
    lowered.set(key, file.currentPath)
  }
  const projectedFolders = projectedOutputFolderNames(folderName)
  for (const file of payloadFiles) {
    const longest = Math.max(...projectedFolders.map((name) => unicodeLength(`${name}/${file.targetPath}`)))
    if (longest > 180) {
      errors.push(`${file.targetPath}: Path would be ${longest} characters; the limit is 180.`)
    }
  }
  const hash = stableHash(JSON.stringify({
    folderName,
    files: proposed.map((file) => [file.id, file.targetPath]),
    payloadFiles: payloadFiles.map((file) => [file.id, file.targetPath]),
    folders: folders.map((folder) => [folder.id, folder.targetPath]),
    strip: files.apply.stripEmbeddedCoverArt,
    release
  }))
  return {
    folderName,
    files: proposed,
    payloadFiles,
    folders,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    hash
  }
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
    .normalize('NFC')
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
  return value.normalize('NFC').replace(UNICODE_FORMAT_CHARACTERS, '').trim()
}

function normalizeManualFlacName(value: string): string {
  return `${normalizeManualName(value).replace(/\.flac$/i, '')}.flac`
}

function dirnamePosix(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function basenamePosix(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function joinPosix(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child
}

function pathDepth(path: string): number {
  return path ? path.split('/').length : 0
}

function unicodeLength(value: string): number {
  return [...value].length
}

function unicodePathKey(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase()
}

/** Every folder form a later transcode can create from the base FLAC name. */
function projectedOutputFolderNames(folderName: string): string[] {
  const values = new Set([folderName])
  for (const bitrate of ['V0', '320']) values.add(projectMp3FolderName(folderName, bitrate))
  values.add(projectDownconvertFolderName(folderName, 16, null))
  values.add(projectDownconvertFolderName(folderName, 24, 88))
  values.add(projectDownconvertFolderName(folderName, 24, 96))
  return [...values]
}

export function projectMp3FolderName(folderName: string, bitrate: string): string {
  const flac = /(24 ?bit )?FLAC/i
  const lossless = /Lossless/i
  let value = folderName
  if (flac.test(value)) {
    if (lossless.test(value)) return value.replace(flac, 'MP3').replace(lossless, bitrate)
    return value.replace(flac, `MP3 ${bitrate}`)
  }
  if (lossless.test(value)) return `${value.replace(lossless, bitrate)} [MP3]`
  return `${value} [MP3 ${bitrate}]`
}

export function projectDownconvertFolderName(
  folderName: string,
  bitDepth: number,
  sampleRateKhz: number | null
): string {
  let value = folderName
  if (/(24 ?bit )FLAC/i.test(value)) value = value.replace(/(24 ?bit )FLAC/i, 'FLAC')
  else if (/FLAC/i.test(value)) value = value.replace(/FLAC/i, '16bit FLAC')
  else value += ' [FLAC]'
  if (sampleRateKhz && bitDepth === 24) value = value.replace(/FLAC/i, `24-${sampleRateKhz}`)
  return value
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
