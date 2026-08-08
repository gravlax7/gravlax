import { readdir } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { compareNatural } from '@shared/naturalSort'

export interface FlacFile {
  absolutePath: string
  relativePath: string
}

/**
 * Every .flac under `root`, sorted by relative path (POSIX separators).
 *
 * Sort order here is authoritative for track pairing: it decides tracklist
 * order, spectral numbering, and which duration lines up with which title.
 * Natural comparison keeps "CD2" before "CD10" and "2 - Track" before
 * "10 - Track" — see `compareNatural`.
 */
export async function discoverFLACFiles(root: string): Promise<FlacFile[]> {
  const files: FlacFile[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.flac') {
        continue
      }
      files.push({
        absolutePath: path,
        relativePath: relative(root, path).split(sep).join('/')
      })
    }
  }
  await walk(root)
  files.sort((a, b) => compareNatural(a.relativePath, b.relativePath))
  return files
}
