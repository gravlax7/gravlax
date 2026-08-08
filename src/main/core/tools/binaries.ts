import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

export async function findOnPath(name: string): Promise<boolean> {
  const parts = (process.env.PATH ?? '').split(delimiter)
  for (const part of parts) {
    try {
      await access(join(part, name))
      return true
    } catch {
      /* continue */
    }
    if (process.platform === 'win32') {
      try {
        await access(join(part, `${name}.exe`))
        return true
      } catch {
        /* continue */
      }
    }
  }
  return false
}
