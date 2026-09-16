import { resolve, win32 } from 'node:path'

export async function openPathInShell(
  path: string,
  openPath: (path: string) => Promise<string>,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const resolved = platform === 'win32' ? win32.resolve(path) : resolve(path)
  const error = await openPath(resolved)
  if (error) throw new Error(error)
}
