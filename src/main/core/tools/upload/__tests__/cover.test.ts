import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  downloadCoverIfNonexistent,
  getCoverFromPath,
  isValidCoverImage
} from '../cover'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('getCoverFromPath', () => {
  it('finds cover.jpg case-insensitively', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    await writeFile(path.join(dir, 'Cover.JPG'), JPEG)
    expect(await getCoverFromPath(dir)).toBe(path.join(dir, 'Cover.JPG'))
  })

  it('finds folder.png', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    await writeFile(path.join(dir, 'folder.png'), PNG)
    expect(await getCoverFromPath(dir)).toBe(path.join(dir, 'folder.png'))
  })

  it('ignores nested and differently named images', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    await mkdir(path.join(dir, 'art'))
    await writeFile(path.join(dir, 'art', 'cover.jpg'), JPEG)
    await writeFile(path.join(dir, 'front.jpg'), JPEG)
    expect(await getCoverFromPath(dir)).toBeNull()
  })
})

describe('isValidCoverImage', () => {
  it('accepts jpeg and png magic', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    const jpegPath = path.join(dir, 'a.jpg')
    const pngPath = path.join(dir, 'b.png')
    await writeFile(jpegPath, JPEG)
    await writeFile(pngPath, PNG)
    expect(await isValidCoverImage(jpegPath)).toBe(true)
    expect(await isValidCoverImage(pngPath)).toBe(true)
  })

  it('rejects non-images', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    const file = path.join(dir, 'cover.jpg')
    await writeFile(file, Buffer.from('not an image'))
    expect(await isValidCoverImage(file)).toBe(false)
  })
})

describe('downloadCoverIfNonexistent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns existing local cover without downloading', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    const existing = path.join(dir, 'cover.jpg')
    await writeFile(existing, JPEG)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadCoverIfNonexistent(dir, 'https://example.com/x.jpg')
    expect(result).toEqual({ path: existing, downloaded: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads cover when missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JPEG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      )
    )

    const result = await downloadCoverIfNonexistent(dir, 'https://example.com/art.jpg')
    expect(result.downloaded).toBe(true)
    expect(result.path).toBe(path.join(dir, 'cover.jpg'))
    expect(await isValidCoverImage(result.path!)).toBe(true)
  })

  it('rejects downloaded non-image payloads', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-cover-'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('html', { status: 200 }))
    )

    const result = await downloadCoverIfNonexistent(dir, 'https://example.com/art.jpg')
    expect(result).toEqual({ path: null, downloaded: false })
    expect(await getCoverFromPath(dir)).toBeNull()
  })
})
