import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function imageFileBlob(filePath: string): Promise<Blob> {
  const data = await readFile(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const type = ext === '.png' ? 'image/png' : 'image/jpeg'
  return new Blob([Uint8Array.from(data)], { type })
}
