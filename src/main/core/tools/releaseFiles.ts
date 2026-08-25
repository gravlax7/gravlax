import { readdir, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { compareNatural } from '@shared/naturalSort'

export interface ReleaseFile {
  absolutePath: string
  /** Path relative to the release root, POSIX separators, torrent order. */
  relativePath: string
  size: number
}

/**
 * The files that make up a release, for every consumer that has to agree on
 * them.
 *
 * Torrent creation, the SFTP transfer and the local seeding copy must select
 * exactly the same files. If they diverge — a different junk list, a different
 * symlink rule — the torrent ends up demanding a file that was never sent, and
 * the release seeds at 99% forever with no obvious cause. Keeping the decision
 * in one place is what makes that impossible rather than merely unlikely.
 *
 * Folder rules block symbolic links before upload, so this list contains only
 * regular files. Nothing is silently filtered by name or extension.
 */
export async function enumerateReleaseFiles(root: string): Promise<ReleaseFile[]> {
  const files: ReleaseFile[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(full)

      files.push({
        absolutePath: full,
        relativePath: full.slice(root.length + 1).split(sep).join('/'),
        size: info.size
      })
    }
  }

  await walk(root)
  files.sort((a, b) => compareRelativePaths(a.relativePath, b.relativePath))
  return files
}

export async function enumerateReleasePaths(
  root: string
): Promise<{ files: string[]; directories: string[] }> {
  const files: string[] = []
  const directories: string[] = []
  async function walk(dir: string): Promise<boolean> {
    const entries = await readdir(dir, { withFileTypes: true })
    let hasFile = false
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const childHasFile = await walk(full)
        if (childHasFile) {
          directories.push(full.slice(root.length + 1).split(sep).join('/'))
          hasFile = true
        }
        continue
      }
      if (!entry.isFile()) continue
      files.push(full.slice(root.length + 1).split(sep).join('/'))
      hasFile = true
    }
    return hasFile
  }
  await walk(root)
  files.sort(compareRelativePaths)
  directories.sort(compareRelativePaths)
  return { files, directories }
}

/**
 * Component-wise, not by the joined string: "a/b" and "a-1/c" order differently
 * depending on where the separator falls, and clients re-deriving file order
 * walk components.
 *
 * Each component compares naturally (digit runs by value) so "CD2" sorts
 * before "CD10" and "2 - Track" before "10 - Track", instead of codepoint
 * order scrambling multi-disc releases and double-digit track numbers.
 */
export function compareRelativePaths(a: string, b: string): number {
  const left = a.split('/')
  const right = b.split('/')
  const length = Math.min(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const cmp = compareNatural(left[i]!, right[i]!)
    if (cmp !== 0) return cmp
  }
  return left.length - right.length
}

export function totalSize(files: ReleaseFile[]): number {
  return files.reduce((sum, file) => sum + file.size, 0)
}
