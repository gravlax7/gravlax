import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'

const COVER_NAME_RE = /^(cover|folder)\.(jpe?g|png)$/i
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

export async function getCoverFromPath(dir: string): Promise<string | null> {
  if (!dir) return null
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  for (const filename of entries) {
    if (COVER_NAME_RE.test(filename)) {
      return path.join(dir, filename)
    }
  }
  return null
}

export async function isValidCoverImage(filePath: string): Promise<boolean> {
  try {
    const buf = await readFile(filePath)
    if (buf.length < 4) return false
    if (buf.subarray(0, 3).equals(JPEG_MAGIC)) return true
    if (buf.subarray(0, 4).equals(PNG_MAGIC)) return true
    return false
  } catch {
    return false
  }
}

export async function downloadCoverIfNonexistent(
  dir: string,
  coverUrl: string | undefined | null
): Promise<{ path: string | null; downloaded: boolean }> {
  const existing = await getCoverFromPath(dir)
  if (existing) return { path: existing, downloaded: false }

  const url = (coverUrl ?? '').trim()
  if (!url) return { path: null, downloaded: false }

  const coverPath = await downloadCover(dir, url)
  if (!coverPath) return { path: null, downloaded: false }
  return { path: coverPath, downloaded: true }
}

async function downloadCover(dir: string, coverUrl: string): Promise<string | null> {
  let ext = path.extname(new URL(coverUrl).pathname)
  if (!/^\.(jpe?g|png)$/i.test(ext)) ext = '.jpg'
  const coverPath = path.join(dir, `cover${ext.toLowerCase()}`)

  try {
    const response = await fetch(coverUrl, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow'
    })
    if (!response.ok) return null
    const data = Buffer.from(await response.arrayBuffer())
    await writeFile(coverPath, data)
  } catch {
    return null
  }

  if (!(await isValidCoverImage(coverPath))) {
    try {
      await unlink(coverPath)
    } catch {
      /* ignore */
    }
    return null
  }
  return coverPath
}
