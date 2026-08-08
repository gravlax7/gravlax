import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, extname, join, relative, sep } from 'node:path'
import { IMAGE_EXTENSIONS, SKIP_EXTENSIONS } from './audioInfo'

export interface CopiedExtra {
  relativePath: string
  action: 'copy' | 'skip'
}

export async function copyExtraFiles(
  sourcePath: string,
  destPath: string,
  options: {
    essentialOnly?: boolean
    skipFlac?: boolean
    skipSources?: ReadonlySet<string>
    skipExtensions?: ReadonlySet<string>
  } = {}
): Promise<CopiedExtra[]> {
  const essentialOnly = options.essentialOnly ?? false
  const skipFlac = options.skipFlac ?? false
  const skipSources = options.skipSources ?? new Set<string>()
  const skipExtensions = options.skipExtensions ?? new Set<string>()
  const results: CopiedExtra[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      if (skipSources.has(path)) continue

      const ext = extname(entry.name).toLowerCase()
      const rel = relative(sourcePath, path).split(sep).join('/')

      if (skipFlac && ext === '.flac') continue
      if (skipExtensions.has(ext)) {
        results.push({ relativePath: rel, action: 'skip' })
        continue
      }
      if (essentialOnly && !IMAGE_EXTENSIONS.has(ext)) {
        results.push({ relativePath: rel, action: 'skip' })
        continue
      }

      const out = join(destPath, relative(sourcePath, path))
      await mkdir(dirname(out), { recursive: true })
      await copyFile(path, out)
      results.push({ relativePath: rel, action: 'copy' })
    }
  }

  await walk(sourcePath)
  return results
}

export { SKIP_EXTENSIONS }
