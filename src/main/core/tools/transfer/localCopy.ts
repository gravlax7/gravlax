import { copyFile, link, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { enumerateReleaseFiles } from '@main/core/tools/releaseFiles'
import type { TransferProgressCallback } from './progress'

export interface CopyFolderOptions {
  onProgress?: TransferProgressCallback
  signal?: AbortSignal
}

export interface CopyFolderResult {
  destination: string
  /** False as soon as one file had to be copied — the UI reports a rate only then. */
  hardlinked: boolean
  bytesTotal: number
  fileCount: number
}

/**
 * Put a release where a local torrent client can seed it.
 *
 * Hardlinks first and falls back to a byte copy per file: on the same volume a
 * link costs nothing and stores nothing, and across volumes it fails with
 * EXDEV. Mirroring what salmon does, except per file rather than per tree, so a
 * partly-linkable tree still gets links where it can.
 */
export async function copyFolderForSeeding(
  sourceFolder: string,
  destinationRoot: string,
  options: CopyFolderOptions = {}
): Promise<CopyFolderResult> {
  throwIfAborted(options.signal)
  if (!destinationRoot.trim()) {
    throw new Error('Seeding folder is not configured')
  }

  const destination = path.join(destinationRoot, path.basename(sourceFolder))
  const files = await listFilesRecursive(sourceFolder)
  const bytesTotal = files.reduce((sum, file) => sum + file.size, 0)

  let bytesTransferred = 0
  let filesTransferred = 0
  let hardlinked = true

  await mkdir(destination, { recursive: true, mode: 0o755 })

  for (const file of files) {
    throwIfAborted(options.signal)
    const relative = path.relative(sourceFolder, file.path)
    const target = path.join(destination, relative)
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 })

    if (!(await tryHardlink(file.path, target))) {
      hardlinked = false
      await copyFile(file.path, target)
    }

    bytesTransferred += file.size
    filesTransferred += 1
    options.onProgress?.({
      bytesTransferred,
      bytesTotal,
      filesTransferred,
      filesTotal: files.length,
      currentFile: relative
    })
  }

  return { destination, hardlinked, bytesTotal, fileCount: files.length }
}

async function tryHardlink(source: string, target: string): Promise<boolean> {
  try {
    await link(source, target)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EEXIST is a leftover from an earlier attempt: replace it rather than
    // leaving a stale file the client would fail to verify.
    if (code === 'EEXIST') {
      await rm(target, { force: true })
      return tryHardlink(source, target)
    }
    if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP' || code === 'EMLINK') {
      return false
    }
    throw err
  }
}

/**
 * Shared with torrent creation and the SFTP transfer: what lands here has to be
 * exactly the files the torrent lists.
 */
async function listFilesRecursive(dir: string): Promise<Array<{ path: string; size: number }>> {
  const files = await enumerateReleaseFiles(dir)
  return files.map((file) => ({ path: file.absolutePath, size: file.size }))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Copy aborted')
}
