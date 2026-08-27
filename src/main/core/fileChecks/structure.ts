import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type {
  QuarantinedReleaseEntry,
  ReleaseStructureIssue,
  ReleaseStructureRule,
  ReleaseStructureSummary,
  UploadAudioFormat,
  UploadFormatPayload
} from '@shared/types'
import { removeEmptyDirectories } from '@main/core/tools/directories'
import {
  enumerateReleaseFiles,
  isIgnoredReleaseMetadata
} from '@main/core/tools/releaseFiles'

const AUDIO_EXTENSION_BY_FORMAT: Record<UploadAudioFormat, string> = {
  FLAC: '.flac',
  MP3: '.mp3'
}

const KNOWN_AUDIO_EXTENSIONS = new Set([
  ...Object.values(AUDIO_EXTENSION_BY_FORMAT),
  '.aac', '.ac3', '.aif', '.aiff', '.alac', '.dts', '.m4a', '.m4b', '.ogg',
  '.opus', '.wav', '.wave', '.wma'
])

const ALLOWED_NON_AUDIO_EXTENSIONS = new Set([
  '.accurip', '.chm', '.cue', '.gif', '.htm', '.html', '.jpeg', '.jpg', '.log',
  '.m3u', '.m3u8', '.md5', '.nfo', '.pdf', '.png', '.rtf', '.sfv', '.txt'
])

export interface CheckReleaseStructureOptions {
  expectedFormat: UploadAudioFormat
  approvedPaths?: readonly string[]
  quarantined?: readonly QuarantinedReleaseEntry[]
}

const QUARANTINE_DIRECTORY = '.gravlax-quarantine'

export async function quarantineReleaseEntry(
  workspacePath: string,
  item: ReleaseStructureIssue
): Promise<QuarantinedReleaseEntry> {
  const source = safeReleasePath(workspacePath, item.relativePath)
  await lstat(source)
  const quarantineRoot = join(dirname(workspacePath), QUARANTINE_DIRECTORY)
  await mkdir(quarantineRoot, { recursive: true })
  const storedName = item.id
  const target = join(quarantineRoot, storedName)
  await rm(target, { recursive: true, force: true })
  await rename(source, target)
  await removeEmptyDirectories(workspacePath).catch(() => undefined)
  return {
    id: item.id,
    relativePath: item.relativePath,
    entryKind: item.entryKind,
    storedName
  }
}

export async function restoreQuarantinedReleaseEntry(
  workspacePath: string,
  item: QuarantinedReleaseEntry
): Promise<void> {
  const source = join(dirname(workspacePath), QUARANTINE_DIRECTORY, item.storedName)
  const target = safeReleasePath(workspacePath, item.relativePath)
  await lstat(source)
  await mkdir(dirname(target), { recursive: true })
  try {
    await lstat(target)
    throw new Error(`Cannot restore ${item.relativePath}: that path already exists.`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(source, target)
}

export async function checkReleaseStructure(
  root: string,
  options: CheckReleaseStructureOptions
): Promise<ReleaseStructureSummary> {
  const approved = new Set(options.approvedPaths ?? [])
  const expectedExtension = AUDIO_EXTENSION_BY_FORMAT[options.expectedFormat]
  const issues: ReleaseStructureIssue[] = []
  const emptyDirectories: string[] = []

  async function walk(dir: string): Promise<boolean> {
    const entries = await readdir(dir, { withFileTypes: true })
    if (entries.length === 0 && dir !== root) {
      emptyDirectories.push(toRelative(root, dir))
      return false
    }

    let hasPayload = false
    for (const entry of entries) {
      const absolutePath = join(dir, entry.name)
      const relativePath = toRelative(root, absolutePath)

      if (entry.isSymbolicLink()) {
        issues.push(issue(relativePath, 'symlink', 'symlink', false, approved))
        hasPayload = true
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === '@eaDir') {
          issues.push(issue(relativePath, 'directory', 'illegal-directory', false, approved))
          hasPayload = true
          continue
        }
        if (await walk(absolutePath)) hasPayload = true
        continue
      }
      if (!entry.isFile()) continue
      if (isIgnoredReleaseMetadata(entry.name)) continue

      hasPayload = true
      const extension = extname(entry.name).toLowerCase()
      if (KNOWN_AUDIO_EXTENSIONS.has(extension)) {
        if (extension !== expectedExtension) {
          issues.push(issue(relativePath, 'file', 'mixed-audio', false, approved))
        }
      } else if (!ALLOWED_NON_AUDIO_EXTENSIONS.has(extension)) {
        issues.push(issue(relativePath, 'file', 'suspicious-extension', true, approved))
      }
    }
    return hasPayload
  }

  await walk(root)
  issues.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  emptyDirectories.sort((a, b) => a.localeCompare(b))
  const liveSuspiciousPaths = new Set(
    issues.filter((item) => item.rule === 'suspicious-extension').map((item) => item.relativePath)
  )
  const approvedPaths = [...approved].filter((path) => liveSuspiciousPaths.has(path)).sort()
  return {
    ready: issues.every((item) => item.decision === 'kept'),
    issues,
    approvedPaths,
    emptyDirectories,
    quarantined: [...(options.quarantined ?? [])]
  }
}

export function structureSummaryDetail(
  summary: ReleaseStructureSummary,
  expectedFormat: UploadAudioFormat
): string {
  const lines: string[] = []
  if (summary.issues.length === 0) lines.push('Folder and file rules passed.')
  else {
    lines.push(`${summary.issues.length} folder or file item${summary.issues.length === 1 ? '' : 's'} need attention.`)
    for (const item of summary.issues) {
      lines.push(`- ${item.relativePath}: ${ruleLabel(item.rule, expectedFormat)}${item.decision === 'kept' ? ' (kept)' : ''}`)
    }
  }
  if (summary.emptyDirectories.length > 0) {
    lines.push(`${summary.emptyDirectories.length} empty folder${summary.emptyDirectories.length === 1 ? '' : 's'} will be omitted.`)
  }
  return lines.join('\n')
}

export async function assertReleasePayloadReady(
  root: string,
  options: Pick<CheckReleaseStructureOptions, 'expectedFormat' | 'approvedPaths'>
): Promise<void> {
  const structure = await checkReleaseStructure(root, options)
  const unresolved = structure.issues.find((item) => item.decision !== 'kept')
  if (unresolved) {
    throw new Error(
      `${unresolved.relativePath}: ${ruleLabel(unresolved.rule, options.expectedFormat)}.`
    )
  }
  for (const file of await enumerateReleaseFiles(root)) {
    const length = [...`${basename(root)}/${file.relativePath}`].length
    if (length > 180) {
      throw new Error(`${file.relativePath}: Path is ${length} characters; the limit is 180.`)
    }
  }
}

export async function assertUploadFormatsReady(
  formats: readonly Pick<UploadFormatPayload, 'folderPath' | 'format'>[],
  approvedPaths: readonly string[] = []
): Promise<void> {
  for (const format of formats) {
    await assertReleasePayloadReady(format.folderPath, {
      expectedFormat: format.format,
      approvedPaths
    })
  }
}

function issue(
  relativePath: string,
  entryKind: ReleaseStructureIssue['entryKind'],
  rule: ReleaseStructureRule,
  canKeep: boolean,
  approved: ReadonlySet<string>
): ReleaseStructureIssue {
  const kept = canKeep && approved.has(relativePath)
  return {
    id: stableId(`${rule}:${relativePath}`),
    relativePath,
    entryKind,
    rule,
    decision: kept ? 'kept' : 'pending',
    canKeep
  }
}

function toRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function safeReleasePath(root: string, relativePath: string): string {
  const absolute = resolve(root, ...relativePath.split('/'))
  const rel = relative(resolve(root), absolute)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Unsafe release path: ${relativePath}`)
  }
  return absolute
}

function stableId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `structure-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function ruleLabel(rule: ReleaseStructureRule, expectedFormat: UploadAudioFormat): string {
  switch (rule) {
    case 'suspicious-extension': return 'file type is outside the approved list'
    case 'illegal-directory': return '@eaDir is not allowed'
    case 'mixed-audio': return `audio does not match the declared ${expectedFormat} format`
    case 'symlink': return 'symbolic links are not allowed'
  }
  return rule
}
