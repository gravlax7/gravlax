import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { IMAGE_EXTENSIONS } from './audioInfo'

/**
 * Copies non-converted files into the output folder. With `essentialOnly`, only
 * FLACs and images are kept, and only in folders that hold audio, so folders
 * like `Artwork/` are dropped.
 */
export async function copyExtraFiles(
  sourcePath: string,
  destPath: string,
  options: {
    essentialOnly?: boolean
    skipFlac?: boolean
    skipSources?: ReadonlySet<string>
    skipExtensions?: ReadonlySet<string>
  } = {}
): Promise<void> {
  const files = (await readdir(sourcePath, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))

  const audioDirs = new Set<string>()
  for (const file of files) {
    if (extname(file).toLowerCase() !== '.flac') continue
    for (let dir = dirname(file); !audioDirs.has(dir); dir = dirname(dir)) {
      audioDirs.add(dir)
      if (dir === sourcePath) break
    }
  }

  for (const file of files) {
    const ext = extname(file).toLowerCase()
    if (options.skipSources?.has(file)) continue
    if (options.skipFlac && ext === '.flac') continue
    if (options.skipExtensions?.has(ext)) continue
    if (options.essentialOnly) {
      if (ext !== '.flac' && !IMAGE_EXTENSIONS.has(ext)) continue
      if (!audioDirs.has(dirname(file))) continue
    }

    const out = join(destPath, relative(sourcePath, file))
    await mkdir(dirname(out), { recursive: true })
    await copyFile(file, out)
  }
}
