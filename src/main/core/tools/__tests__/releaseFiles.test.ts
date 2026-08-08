import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareRelativePaths, enumerateReleaseFiles, totalSize } from '../releaseFiles'

let root = ''
let release = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-files-'))
  release = join(root, 'Artist - Album [FLAC]')
  await mkdir(release, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const paths = async (): Promise<string[]> =>
  (await enumerateReleaseFiles(release)).map((f) => f.relativePath)

describe('enumerateReleaseFiles', () => {
  it('returns relative POSIX paths with sizes', async () => {
    await mkdir(join(release, 'CD1'), { recursive: true })
    await writeFile(join(release, 'CD1', '01.flac'), 'abcde')
    await writeFile(join(release, 'cover.jpg'), 'xy')

    const files = await enumerateReleaseFiles(release)
    expect(files.map((f) => f.relativePath)).toEqual(['CD1/01.flac', 'cover.jpg'])
    expect(files.map((f) => f.size)).toEqual([5, 2])
    expect(files[0]!.absolutePath).toBe(join(release, 'CD1', '01.flac'))
    expect(totalSize(files)).toBe(7)
  })

  it('orders by path components, not by the joined string', async () => {
    await mkdir(join(release, 'a-1'), { recursive: true })
    await mkdir(join(release, 'a'), { recursive: true })
    await writeFile(join(release, 'a-1', 'x.flac'), '1')
    await writeFile(join(release, 'a', 'b.flac'), '2')

    // 'a/b.flac' < 'a-1/x.flac' as strings ('/' is 0x2f, '-' is 0x2d), but
    // component-wise 'a' sorts before 'a-1'.
    expect(await paths()).toEqual(['a/b.flac', 'a-1/x.flac'])
  })

  it('filters junk files at any depth', async () => {
    await mkdir(join(release, 'CD1'), { recursive: true })
    await writeFile(join(release, '01.flac'), 'x')
    await writeFile(join(release, '.DS_Store'), 'junk')
    await writeFile(join(release, 'Thumbs.db'), 'junk')
    await writeFile(join(release, 'desktop.ini'), 'junk')
    await writeFile(join(release, 'CD1', '._02.flac'), 'junk')
    await writeFile(join(release, 'CD1', '02.flac'), 'y')

    expect(await paths()).toEqual(['01.flac', 'CD1/02.flac'])
  })

  it('follows a symlinked file and reports the target size', async () => {
    const outside = join(root, 'target.flac')
    await writeFile(outside, 'linked-bytes')
    await symlink(outside, join(release, '02.flac'))
    await writeFile(join(release, '01.flac'), 'x')

    const files = await enumerateReleaseFiles(release)
    expect(files.map((f) => f.relativePath)).toEqual(['01.flac', '02.flac'])
    expect(files[1]!.size).toBe('linked-bytes'.length)
  })

  it('follows a symlinked directory', async () => {
    const outside = join(root, 'extra')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'bonus.flac'), 'bonus')
    await symlink(outside, join(release, 'CD2'))
    await writeFile(join(release, '01.flac'), 'x')

    expect(await paths()).toEqual(['01.flac', 'CD2/bonus.flac'])
  })

  it('does not loop on a symlink cycle', async () => {
    await writeFile(join(release, '01.flac'), 'x')
    await symlink(release, join(release, 'self'))

    // Terminates, and visits the real directory exactly once.
    expect(await paths()).toEqual(['01.flac'])
  })

  it('skips a broken symlink rather than listing an unseedable file', async () => {
    await writeFile(join(release, '01.flac'), 'x')
    await symlink(join(root, 'does-not-exist.flac'), join(release, '02.flac'))

    expect(await paths()).toEqual(['01.flac'])
  })

  it('returns nothing for an empty folder', async () => {
    expect(await paths()).toEqual([])
  })
})

describe('compareRelativePaths', () => {
  it('sorts shallower paths before their deeper neighbours', () => {
    expect(compareRelativePaths('a', 'a/b')).toBeLessThan(0)
    expect(compareRelativePaths('a/b', 'a')).toBeGreaterThan(0)
    expect(compareRelativePaths('a/b', 'a/b')).toBe(0)
  })
})
