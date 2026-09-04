import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  lstat,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SourceFingerprint, SourceFingerprintFile, UploadFlowSnapshot } from '@shared/types'
import { sourceRestoreUnavailableMessage } from '@shared/upload/sourceRestore'
import { pathKey } from '@main/core/config/paths'
import { QUARANTINE_DIRECTORY } from '@main/core/fileChecks/structure'

const WORKSPACE_DIR_NAME = 'workspace'
const UPLOAD_WORKSPACE_METADATA_FILE = '.gravlax-upload.json'
const UPLOAD_FLOW_STATE_FILE = 'upload-flow.json'

export type SourceRestoreStatus =
  | { available: true }
  | { available: false; reason: 'moved' | 'changed' | 'unknown' }

export type CopyProgressCallback = (current: number, total: number, label: string) => void

interface UploadWorkspaceMetadata {
  sourcePath: string
  stagedName?: string
  previousStagedName?: string
  fingerprint?: SourceFingerprint
}

export interface UploadWorkspaceEntry {
  workspaceRootPath: string
  workspacePath: string
  sourcePath: string
  updatedAt: number
  snapshot?: UploadFlowSnapshot
}

export function workspaceRoot(userDataPath: string): string {
  return join(userDataPath, WORKSPACE_DIR_NAME)
}

export async function workspaceSize(userDataPath: string): Promise<number> {
  const root = workspaceRoot(userDataPath)
  let total = 0
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (entry.isSymbolicLink()) {
        try {
          const info = await stat(path)
          if (info.isFile()) total += info.size
        } catch {
          /* ignore */
        }
        continue
      }
      if (entry.isFile()) {
        const info = await stat(path)
        total += info.size
      }
    }
  }
  await walk(root)
  return total
}

export async function createUploadWorkspace(userDataPath: string): Promise<string> {
  const root = workspaceRoot(userDataPath)
  await mkdir(root, { recursive: true, mode: 0o755 })
  return mkdtemp(join(root, 'upload-'))
}

export async function copyFolderToUploadWorkspace(
  userDataPath: string,
  sourcePath: string
): Promise<string> {
  const info = await stat(sourcePath)
  if (!info.isDirectory()) {
    throw new Error(`source folder "${sourcePath}" is not a directory`)
  }
  const workspace = await createUploadWorkspace(userDataPath)
  try {
    const destination = join(workspace, basename(sourcePath))
    const files = await copyDirectory(sourcePath, destination)
    await writeWorkspaceMetadata(workspace, {
      sourcePath,
      stagedName: basename(sourcePath),
      fingerprint: { path: resolve(sourcePath), files }
    })
    return destination
  } catch (err) {
    await removeUploadWorkspace(workspace)
    throw err
  }
}

export async function sourceRestoreStatus(workspaceRootPath: string): Promise<SourceRestoreStatus> {
  const metadata = await readUploadWorkspaceMetadata(workspaceRootPath).catch(() => undefined)
  const fingerprint = metadata?.fingerprint
  if (!fingerprint) return { available: false, reason: 'unknown' }
  return verifySourceFingerprint(fingerprint)
}

export async function replaceWorkingCopyFromSource(
  workspacePath: string,
  sourcePath: string,
  onProgress?: CopyProgressCallback
): Promise<string> {
  const root = uploadWorkspaceRootForPath(workspacePath)
  const status = await sourceRestoreStatus(root)
  if (!status.available) {
    throw new Error(sourceRestoreUnavailableMessage(status.reason))
  }
  const destination = join(root, basename(sourcePath))
  const temp = join(root, `.gravlax-restore-${Date.now()}`)
  try {
    await copyDirectory(sourcePath, temp, onProgress)
    await rm(workspacePath, { recursive: true, force: true })
    await rename(temp, destination)
    await finishStagedFolderRename(root, basename(sourcePath))
    await rm(join(root, QUARANTINE_DIRECTORY), { recursive: true, force: true })
    return destination
  } catch (err) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

/** Lists every saved upload without choosing one as the app-wide session. */
export async function listUploadWorkspaces(userDataPath: string): Promise<UploadWorkspaceEntry[]> {
  const root = workspaceRoot(userDataPath)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const result: UploadWorkspaceEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const workspaceRootPath = join(root, entry.name)
    const snapshot = await readUploadFlow(workspaceRootPath).catch(() => undefined)
    const metadata = await readUploadWorkspaceMetadata(workspaceRootPath).catch(() => undefined)
    const sourcePath = snapshot?.sourcePath || metadata?.sourcePath || ''
    if (!sourcePath) continue
    const stagedName = metadata?.stagedName || basename(sourcePath)
    const workspacePath = join(workspaceRootPath, stagedName)
    const info = await stat(join(workspaceRootPath, UPLOAD_FLOW_STATE_FILE)).catch(() =>
      stat(workspaceRootPath)
    )
    result.push({
      workspaceRootPath,
      workspacePath,
      sourcePath,
      updatedAt: info.mtimeMs,
      snapshot
    })
  }
  return result
}

export async function readUploadWorkspaceSource(workspaceRootPath: string): Promise<string> {
  const snapshot = await readUploadFlow(workspaceRootPath).catch(() => undefined)
  if (snapshot?.sourcePath) return snapshot.sourcePath
  return (await readUploadWorkspaceMetadata(workspaceRootPath)).sourcePath
}

export function uploadWorkspaceBelongsToUserData(userDataPath: string, workspacePath: string): boolean {
  const root = workspaceRoot(userDataPath)
  const candidateRoot = dirname(workspacePath)
  return dirname(candidateRoot) === root
}

export async function removeUploadWorkspace(path: string): Promise<void> {
  if (!path) return
  await rm(path, { recursive: true, force: true })
}

export async function removeOtherUploadWorkspacesForSource(
  userDataPath: string,
  sourcePath: string,
  keepWorkspacePath: string
): Promise<void> {
  const keepRoot = uploadWorkspaceRootForPath(keepWorkspacePath)
  const sourceKey = pathKey(sourcePath)
  const workspaces = await listUploadWorkspaces(userDataPath)
  for (const workspace of workspaces) {
    if (pathKey(workspace.workspaceRootPath) === pathKey(keepRoot)) continue
    if (pathKey(workspace.sourcePath) !== sourceKey) continue
    await removeUploadWorkspace(workspace.workspaceRootPath)
  }
}

/** Moves finished music folders out of the workspace without touching its other files. */
export async function archiveMusicFolders(
  destinationRoot: string,
  sourceFolders: string[]
): Promise<string[]> {
  const root = resolve(destinationRoot)
  const sources = [...new Set(sourceFolders.map((folder) => resolve(folder)))]
  const destinations = sources.map((source) => join(root, basename(source)))

  for (const source of sources) {
    const fromSource = relative(source, root)
    if (
      fromSource === '' ||
      (!isAbsolute(fromSource) && fromSource !== '..' && !fromSource.startsWith(`..${sep}`))
    ) {
      throw new Error('The archive folder cannot be inside a music folder.')
    }
    const info = await stat(source)
    if (!info.isDirectory()) throw new Error(`Music folder is not a directory: ${source}`)
  }

  if (new Set(destinations).size !== destinations.length) {
    throw new Error('Two music folders have the same name and cannot share one archive folder.')
  }

  await mkdir(root, { recursive: true, mode: 0o755 })
  for (const destination of destinations) {
    if (await pathExists(destination)) {
      throw new Error(`A folder named "${basename(destination)}" already exists in the archive.`)
    }
  }

  const moved: Array<{ source: string; destination: string }> = []
  try {
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index]!
      const destination = destinations[index]!
      await moveDirectory(source, destination)
      moved.push({ source, destination })
    }
  } catch (err) {
    for (const item of moved.reverse()) {
      await moveDirectory(item.destination, item.source).catch(() => undefined)
    }
    throw err
  }
  return destinations
}

async function moveDirectory(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination)
    return
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
  }

  try {
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false })
    await rm(source, { recursive: true })
  } catch (err) {
    await rm(destination, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

export function uploadWorkspaceRootForPath(path: string): string {
  if (!path) return ''
  return dirname(path)
}

export async function clearWorkspace(userDataPath: string): Promise<void> {
  const root = workspaceRoot(userDataPath)
  await rm(root, { recursive: true, force: true })
}

async function verifySourceFingerprint(fingerprint: SourceFingerprint): Promise<SourceRestoreStatus> {
  try {
    const info = await stat(fingerprint.path)
    if (!info.isDirectory()) return { available: false, reason: 'moved' }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { available: false, reason: 'moved' }
    throw err
  }
  const current = await collectSourceFingerprint(fingerprint.path)
  if (!sameFingerprintFiles(fingerprint.files, current)) return { available: false, reason: 'changed' }
  return { available: true }
}

function sameFingerprintFiles(a: SourceFingerprintFile[], b: SourceFingerprintFile[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!
    const right = b[index]!
    if (left.relativePath !== right.relativePath) return false
    if (left.size !== right.size) return false
    if (left.mtimeMs !== right.mtimeMs) return false
    if ((left.symlink ?? '') !== (right.symlink ?? '')) return false
  }
  return true
}

async function collectSourceFingerprint(sourcePath: string): Promise<SourceFingerprintFile[]> {
  const files: SourceFingerprintFile[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      const relativePath = relative(sourcePath, path).split(sep).join('/')
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (entry.isSymbolicLink()) {
        const info = await lstat(path)
        files.push({
          relativePath,
          size: info.size,
          mtimeMs: Math.round(info.mtimeMs),
          symlink: await readlink(path)
        })
        continue
      }
      if (entry.isFile()) {
        const info = await stat(path)
        files.push({ relativePath, size: info.size, mtimeMs: Math.round(info.mtimeMs) })
      }
    }
  }
  await walk(sourcePath)
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export async function prepareStagedFolderRename(workspacePath: string, currentName: string, targetName: string): Promise<void> {
  const metadata = await readUploadWorkspaceMetadata(workspacePath)
  await writeWorkspaceMetadata(workspacePath, { ...metadata, stagedName: targetName, previousStagedName: currentName })
}

export async function finishStagedFolderRename(workspacePath: string, targetName: string): Promise<void> {
  const metadata = await readUploadWorkspaceMetadata(workspacePath)
  await writeWorkspaceMetadata(workspacePath, { ...metadata, stagedName: targetName, previousStagedName: undefined })
}

async function writeWorkspaceMetadata(workspacePath: string, metadata: UploadWorkspaceMetadata): Promise<void> {
  const target = join(workspacePath, UPLOAD_WORKSPACE_METADATA_FILE)
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(metadata))
  await rename(temporary, target)
}

async function readUploadWorkspaceMetadata(workspacePath: string): Promise<UploadWorkspaceMetadata> {
  const payload = await readFile(join(workspacePath, UPLOAD_WORKSPACE_METADATA_FILE), 'utf8')
  return JSON.parse(payload) as UploadWorkspaceMetadata
}

export async function readUploadFlow(workspaceRootPath: string): Promise<UploadFlowSnapshot> {
  const payload = await readFile(join(workspaceRootPath, UPLOAD_FLOW_STATE_FILE), 'utf8')
  return JSON.parse(payload) as UploadFlowSnapshot
}

export async function writeUploadFlow(
  workspaceRootPath: string,
  snapshot: UploadFlowSnapshot
): Promise<void> {
  const payload = `${JSON.stringify(snapshot, null, 2)}\n`
  const target = join(workspaceRootPath, UPLOAD_FLOW_STATE_FILE)
  // Write to a sibling then rename, so a crash or an overlapping write can never
  // leave a half-written snapshot that fails to parse on resume.
  const temporary = `${target}.tmp`
  await writeFile(temporary, payload)
  await rename(temporary, target)
}

async function copyDirectory(
  sourcePath: string,
  destinationPath: string,
  onProgress?: CopyProgressCallback
): Promise<SourceFingerprintFile[]> {
  const total = onProgress ? (await collectSourceFingerprint(sourcePath)).length : 0
  const progress = { current: 0, total }
  const files = await copyDirectoryContents(sourcePath, destinationPath, sourcePath, progress, onProgress)
  await mkdir(destinationPath, { recursive: true })
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function copyDirectoryContents(
  sourcePath: string,
  destinationPath: string,
  rootPath: string,
  progress: { current: number; total: number },
  onProgress?: CopyProgressCallback
): Promise<SourceFingerprintFile[]> {
  const entries = await readdir(sourcePath, { withFileTypes: true })
  const files: SourceFingerprintFile[] = []
  for (const entry of entries) {
    const path = join(sourcePath, entry.name)
    const targetPath = join(destinationPath, entry.name)
    const relativePath = relative(rootPath, path).split(sep).join('/')
    if (entry.isDirectory()) {
      files.push(...await copyDirectoryContents(path, targetPath, rootPath, progress, onProgress))
    } else if (entry.isSymbolicLink()) {
      await mkdir(destinationPath, { recursive: true })
      const linkTarget = await readlink(path)
      const info = await lstat(path)
      await symlink(linkTarget, targetPath)
      files.push({ relativePath, size: info.size, mtimeMs: Math.round(info.mtimeMs), symlink: linkTarget })
      progress.current += 1
      onProgress?.(progress.current, progress.total, `Restoring ${relativePath}`)
    } else if (entry.isFile()) {
      await mkdir(destinationPath, { recursive: true })
      const info = await stat(path)
      await copyFile(path, targetPath)
      files.push({ relativePath, size: info.size, mtimeMs: Math.round(info.mtimeMs) })
      progress.current += 1
      onProgress?.(progress.current, progress.total, `Restoring ${relativePath}`)
    } else {
      throw new Error(`copy "${path}": unsupported file mode`)
    }
  }
  return files
}
