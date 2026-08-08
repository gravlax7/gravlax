import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enumerateReleaseFiles } from '../releaseFiles'
import { createTorrent } from '../torrent/createTorrent'
import { copyFolderForSeeding } from '../transfer/localCopy'

/**
 * The invariant the shared enumerator exists to protect: torrent creation, the
 * local seeding copy and the SFTP transfer must agree exactly on which files
 * make up a release.
 *
 * If they drift, the torrent lists a file that was never placed where the
 * client looks, and the release seeds at 99% forever with nothing obviously
 * wrong. The SFTP path is covered by construction — it maps the same
 * enumerator output — so this exercises the two that transform it.
 */

let root = ''
let release = ''
let destination = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-agree-'))
  release = join(root, 'Artist - Album (2020) [FLAC]')
  destination = join(root, 'seed')
  await mkdir(join(release, 'CD1'), { recursive: true })
  await mkdir(join(release, 'CD2'), { recursive: true })
  await mkdir(destination, { recursive: true })

  await writeFile(join(release, 'CD1', '01.flac'), 'a'.repeat(1000))
  await writeFile(join(release, 'CD1', '02.flac'), 'b'.repeat(1500))
  await writeFile(join(release, 'CD2', '01.flac'), 'c'.repeat(900))
  await writeFile(join(release, 'cover.jpg'), 'd'.repeat(300))
  await writeFile(join(release, 'rip.log'), 'log')

  // The awkward cases: junk that must be excluded everywhere, and a symlinked
  // track that must be included everywhere.
  await writeFile(join(release, '.DS_Store'), 'junk')
  await writeFile(join(release, 'CD1', '._01.flac'), 'junk')
  const linked = join(root, 'bonus-source.flac')
  await writeFile(linked, 'e'.repeat(700))
  await symlink(linked, join(release, 'CD2', '02.flac'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('release file selection agreement', () => {
  it('puts exactly the torrent’s files into the seeding folder', async () => {
    const torrent = await createTorrent({
      folderPath: release,
      announceUrl: 'https://flacsfor.me/abc123/announce',
      source: 'RED',
      createdBy: 'gravlax/test'
    })
    const result = await copyFolderForSeeding(release, destination)
    const copied = await enumerateReleaseFiles(result.destination)

    const inTorrent = (torrent.meta.info.files ?? []).map((f) =>
      f.path.map((part) => Buffer.from(part).toString()).join('/')
    )
    expect(inTorrent).toEqual(copied.map((f) => f.relativePath))
    expect(result.fileCount).toBe(inTorrent.length)
  })

  it('agrees on sizes, so every piece is backed by bytes that were placed', async () => {
    const torrent = await createTorrent({
      folderPath: release,
      announceUrl: 'https://flacsfor.me/abc123/announce',
      source: 'RED',
      createdBy: 'gravlax/test'
    })
    const result = await copyFolderForSeeding(release, destination)
    const copied = await enumerateReleaseFiles(result.destination)

    expect((torrent.meta.info.files ?? []).map((f) => f.length)).toEqual(
      copied.map((f) => f.size)
    )
    expect(torrent.totalBytes).toBe(result.bytesTotal)
  })

  it('includes the symlinked track and excludes the junk on both sides', async () => {
    const torrent = await createTorrent({
      folderPath: release,
      announceUrl: 'https://flacsfor.me/abc123/announce',
      source: 'RED',
      createdBy: 'gravlax/test'
    })
    const result = await copyFolderForSeeding(release, destination)
    const copied = (await enumerateReleaseFiles(result.destination)).map((f) => f.relativePath)
    const inTorrent = (torrent.meta.info.files ?? []).map((f) =>
      f.path.map((part) => Buffer.from(part).toString()).join('/')
    )

    for (const list of [inTorrent, copied]) {
      expect(list).toContain('CD2/02.flac')
      expect(list).not.toContain('.DS_Store')
      expect(list).not.toContain('CD1/._01.flac')
    }
  })
})
