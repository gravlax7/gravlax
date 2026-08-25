import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type {
  QuarantinedReleaseEntry,
  ReleaseStructureIssue,
  ReleaseStructureRule,
  ReleaseStructureSummary
} from '@shared/types'
import { removeEmptyDirectories } from '@main/core/tools/directories'
import { enumerateReleaseFiles } from '@main/core/tools/releaseFiles'

export const ALLOWED_RELEASE_EXTENSIONS = new Set([
  '.ac3', '.accurip', '.chm', '.cue', '.dts', '.flac', '.gif', '.htm', '.html',
  '.jpeg', '.jpg', '.log', '.m3u', '.m3u8', '.m4a', '.m4b', '.md5', '.mp3',
  '.nfo', '.pdf', '.png', '.rtf', '.sfv', '.txt'
])

export const NON_FLAC_AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.m4b', '.ogg', '.opus', '.wav', '.wave', '.aif', '.aiff',
  '.alac', '.aac', '.wma', '.ac3', '.dts'
])

export interface CheckReleaseStructureOptions {
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
  options: CheckReleaseStructureOptions = {}
): Promise<ReleaseStructureSummary> {
  const approved = new Set(options.approvedPaths ?? [])
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

      hasPayload = true
      const extension = extname(entry.name).toLowerCase()
      if (NON_FLAC_AUDIO_EXTENSIONS.has(extension)) {
        issues.push(issue(relativePath, 'file', 'mixed-audio', false, approved))
      } else if (!ALLOWED_RELEASE_EXTENSIONS.has(extension)) {
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

export function structureSummaryDetail(summary: ReleaseStructureSummary): string {
  const lines: string[] = []
  if (summary.issues.length === 0) lines.push('Folder and file rules passed.')
  else {
    lines.push(`${summary.issues.length} folder or file item${summary.issues.length === 1 ? '' : 's'} need attention.`)
    for (const item of summary.issues) {
      lines.push(`- ${item.relativePath}: ${ruleLabel(item.rule)}${item.decision === 'kept' ? ' (kept)' : ''}`)
    }
  }
  if (summary.emptyDirectories.length > 0) {
    lines.push(`${summary.emptyDirectories.length} empty folder${summary.emptyDirectories.length === 1 ? '' : 's'} will be omitted.`)
  }
  return lines.join('\n')
}

export async function assertReleasePayloadReady(
  root: string,
  approvedPaths: readonly string[] = []
): Promise<void> {
  const structure = await checkReleaseStructure(root, { approvedPaths })
  const unresolved = structure.issues.find((item) => item.decision !== 'kept')
  if (unresolved) throw new Error(`${unresolved.relativePath}: ${ruleLabel(unresolved.rule)}.`)
  for (const file of await enumerateReleaseFiles(root)) {
    const length = [...`${basename(root)}/${file.relativePath}`].length
    if (length > 180) {
      throw new Error(`${file.relativePath}: Path is ${length} characters; the limit is 180.`)
    }
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

function ruleLabel(rule: ReleaseStructureRule): string {
  switch (rule) {
    case 'suspicious-extension': return 'file type is outside the approved list'
    case 'illegal-directory': return '@eaDir is not allowed'
    case 'mixed-audio': return 'non-FLAC audio is not allowed in a FLAC release'
    case 'symlink': return 'symbolic links are not allowed'
  }
  return rule
}
