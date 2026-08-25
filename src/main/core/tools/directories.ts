import { readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Removes empty descendants without following links or removing the root. */
export async function removeEmptyDirectories(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name)
    await removeEmptyDirectories(path)
    try {
      await rmdir(path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error
    }
  }
}
