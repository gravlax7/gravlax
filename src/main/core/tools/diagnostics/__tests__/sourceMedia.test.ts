import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectSourceMedia, discoverLogFiles } from '../sourceMedia'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gravlax-source-media-'))
  dirs.push(dir)
  return dir
}

describe('detectSourceMedia', () => {
  it('returns CD when a .log file is present at the root', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'rip.log'), 'Exact Audio Copy')
    expect(await detectSourceMedia(dir)).toBe('CD')
  })

  it('discovers nested log files', async () => {
    const dir = await tempDir()
    const nested = join(dir, 'CD1')
    await mkdir(nested)
    await writeFile(join(nested, 'eac.LOG'), 'log')
    const files = await discoverLogFiles(dir)
    expect(files.map((f) => f.relativePath)).toEqual(['CD1/eac.LOG'])
  })

  it('returns CD when a .log file is nested', async () => {
    const dir = await tempDir()
    const nested = join(dir, 'CD1')
    await mkdir(nested)
    await writeFile(join(nested, 'eac.LOG'), 'log')
    expect(await detectSourceMedia(dir)).toBe('CD')
  })

  it('returns null when no .log file is present', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'readme.txt'), 'notes')
    expect(await detectSourceMedia(dir)).toBeNull()
  })

  it('returns null for an empty path', async () => {
    expect(await detectSourceMedia('')).toBeNull()
  })
})
