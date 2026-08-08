import { readdir } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { SourceMedia } from '@shared/types'

export async function detectSourceMedia(root: string): Promise<SourceMedia | null> {
  if (!root) return null
  const logs = await discoverLogFiles(root)
  if (logs.length > 0) return 'CD'
  return null
}

export async function discoverLogFiles(
  root: string
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  if (!root) return []
  const files: Array<{ absolutePath: string; relativePath: string }> = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      if (extname(entry.name).toLowerCase() !== '.log') continue
      files.push({
        absolutePath: path,
        relativePath: relative(root, path).split(sep).join('/')
      })
    }
  }
  try {
    await walk(root)
  } catch {
    return []
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return files
}
