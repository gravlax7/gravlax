import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

type OutputFolderState = 'missing' | 'complete' | 'partial'

export async function inspectOutputFolder(
  root: string,
  expectedPaths: readonly string[],
  extension: string
): Promise<OutputFolderState> {
  if (!(await directoryExists(root))) return 'missing'

  const expected = expectedPaths.map((path) => outputKey(root, path))
  const existing = await collectOutputKeys(root, extension)
  return expected.length > 0 && expected.every((name) => existing.has(name))
    ? 'complete'
    : 'partial'
}

function outputKey(root: string, path: string): string {
  // Include the relative directory so equal track names on separate discs do not collide.
  return relative(root, path).split(sep).join('/').toLowerCase()
}

async function collectOutputKeys(root: string, extension: string): Promise<Set<string>> {
  const keys = new Set<string>()
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(extension)) continue
      keys.add(outputKey(root, path))
    }
  }
  await walk(root)
  return keys
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}
