import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferProgress } from '../progress'

const link = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, link: (...args: Parameters<typeof actual.link>) => link(...args) }
})

const { copyFolderForSeeding } = await import('../localCopy')

let root = ''
let source = ''
let destination = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-copy-'))
  source = join(root, 'Artist - Album [FLAC]')
  destination = join(root, 'seed')
  await mkdir(join(source, 'CD1'), { recursive: true })
  await mkdir(destination, { recursive: true })
  await writeFile(join(source, 'cover.jpg'), 'cover')
  await writeFile(join(source, 'CD1', '01.flac'), 'audio-one')

  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  link.mockImplementation(actual.link)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  link.mockReset()
})

describe('copyFolderForSeeding', () => {
  it('mirrors the tree under a folder named after the source', async () => {
    const result = await copyFolderForSeeding(source, destination)

    expect(result.destination).toBe(join(destination, 'Artist - Album [FLAC]'))
    expect(result.fileCount).toBe(2)
    expect(result.bytesTotal).toBe('cover'.length + 'audio-one'.length)
    expect(await readFile(join(result.destination, 'CD1', '01.flac'), 'utf8')).toBe('audio-one')
  })

  it('hardlinks when it can, sharing the inode rather than the bytes', async () => {
    const result = await copyFolderForSeeding(source, destination)

    expect(result.hardlinked).toBe(true)
    const original = await stat(join(source, 'cover.jpg'))
    const copied = await stat(join(result.destination, 'cover.jpg'))
    expect(copied.ino).toBe(original.ino)
  })

  it('falls back to a byte copy across volumes', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    link.mockImplementation(async () => {
      const err = new Error('cross-device link') as NodeJS.ErrnoException
      err.code = 'EXDEV'
      throw err
    })

    const result = await copyFolderForSeeding(source, destination)

    expect(result.hardlinked).toBe(false)
    expect(await readFile(join(result.destination, 'cover.jpg'), 'utf8')).toBe('cover')
    const original = await actual.stat(join(source, 'cover.jpg'))
    const copied = await actual.stat(join(result.destination, 'cover.jpg'))
    expect(copied.ino).not.toBe(original.ino)
  })

  it('reports one hardlinked file as enough to lose the hardlinked flag', async () => {
    let calls = 0
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    link.mockImplementation(async (...args: Parameters<typeof actual.link>) => {
      calls += 1
      if (calls === 2) {
        const err = new Error('nope') as NodeJS.ErrnoException
        err.code = 'EXDEV'
        throw err
      }
      return actual.link(...args)
    })

    expect((await copyFolderForSeeding(source, destination)).hardlinked).toBe(false)
  })

  it('replaces a leftover file from an earlier attempt', async () => {
    await mkdir(join(destination, 'Artist - Album [FLAC]'), { recursive: true })
    await writeFile(join(destination, 'Artist - Album [FLAC]', 'cover.jpg'), 'stale')

    const result = await copyFolderForSeeding(source, destination)

    expect(await readFile(join(result.destination, 'cover.jpg'), 'utf8')).toBe('cover')
  })

  it('emits progress with running byte and file counts', async () => {
    const progress: TransferProgress[] = []
    await copyFolderForSeeding(source, destination, { onProgress: (p) => progress.push(p) })

    expect(progress).toHaveLength(2)
    expect(progress.at(-1)).toMatchObject({
      bytesTransferred: 'cover'.length + 'audio-one'.length,
      bytesTotal: 'cover'.length + 'audio-one'.length,
      filesTransferred: 2,
      filesTotal: 2
    })
    expect(progress[0]!.filesTransferred).toBe(1)
    expect(progress.map((p) => p.currentFile).sort()).toEqual([
      join('CD1', '01.flac'),
      'cover.jpg'
    ])
  })

  it('refuses to run without a destination', async () => {
    await expect(copyFolderForSeeding(source, '   ')).rejects.toThrow('not configured')
  })

  it('honours an abort signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      copyFolderForSeeding(source, destination, { signal: controller.signal })
    ).rejects.toThrow('aborted')
  })
})
