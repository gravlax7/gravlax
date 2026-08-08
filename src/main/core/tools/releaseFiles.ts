import { readdir, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { isJunk } from 'junk'
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
 * Symlinks are followed, not skipped: the workspace copy preserves them
 * (`copyFolderToUploadWorkspace`), and dropping a symlinked track would ship an
 * incomplete release. Directory cycles are broken by tracking real paths.
 */
export async function enumerateReleaseFiles(root: string): Promise<ReleaseFile[]> {
  const files: ReleaseFile[] = []
  const visited = new Set<string>()

  async function walk(dir: string): Promise<void> {
    let real: string
    try {
      real = await realpath(dir)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (isJunk(entry.name)) continue
      const full = join(dir, entry.name)

      // stat rather than the dirent flags: a Dirent reports the link itself,
      // so a symlinked FLAC would read as neither file nor directory.
      let info
      try {
        info = await stat(full)
      } catch {
        // A broken symlink is not a file anyone can seed.
        continue
      }

      if (info.isDirectory()) {
        await walk(full)
        continue
      }
      if (!info.isFile()) continue

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
