import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bencode from 'bencode'
import makeTorrent from 'create-torrent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  choosePieceLength,
  createTorrent,
  infoHash,
  torrentFileName,
  withComment,
  writeTorrentFile,
  type TorrentMeta
} from '../createTorrent'

let root = ''
let release = ''

const text = (value: Uint8Array | undefined): string =>
  value === undefined ? '' : Buffer.from(value).toString()

const filePaths = (meta: TorrentMeta): string[] =>
  (meta.info.files ?? []).map((f) => f.path.map(text).join('/'))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-torrent-'))
  release = join(root, 'Artist - Album (2020) [FLAC]')
  await mkdir(release, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const create = (folderPath = release) =>
  createTorrent({
    folderPath,
    announceUrl: 'https://flacsfor.me/abc123/announce',
    source: 'RED',
    createdBy: 'gravlax/test'
  })

describe('choosePieceLength', () => {
  it('starts at 16 KiB for small releases', () => {
    expect(choosePieceLength(1024)).toBe(16 * 1024)
    expect(choosePieceLength(16 * 1024 * 1500)).toBe(16 * 1024)
  })

  it('doubles until the piece count is near target', () => {
    expect(choosePieceLength(16 * 1024 * 1501)).toBe(32 * 1024)
    expect(choosePieceLength(500 * 1024 * 1024)).toBe(512 * 1024)
  })

  it('caps at 16 MiB', () => {
    expect(choosePieceLength(10 * 1024 ** 4)).toBe(16 * 1024 * 1024)
  })

  it('always returns a power of two', () => {
    for (const size of [0, 1, 1e6, 1e9, 1e12]) {
      expect(Number.isInteger(Math.log2(choosePieceLength(size)))).toBe(true)
    }
  })

  it('reaches 16 MiB for releases large enough to need it', () => {
    // 1500 pieces of 8 MiB is 12 GiB; anything past that takes the last step.
    expect(choosePieceLength(13 * 1024 ** 3)).toBe(16 * 1024 * 1024)
    expect(choosePieceLength(200 * 1024 ** 3)).toBe(16 * 1024 * 1024)
  })
})

describe('piece length wiring', () => {
  it('puts choosePieceLength’s answer into the torrent', async () => {
    await writeFile(join(release, 'a.flac'), 'hello')
    const torrent = await create()

    expect(torrent.pieceLength).toBe(choosePieceLength(torrent.totalBytes))
    expect(torrent.meta.info['piece length']).toBe(torrent.pieceLength)
  })

  it('is not clamped by create-torrent’s own 4 MiB maxPieceLength default', async () => {
    // Guards an assumption we depend on: create-torrent only applies
    // `maxPieceLength` (4 MiB) to its automatic calculation, and uses an
    // explicit `pieceLength` verbatim. If that precedence ever flips, our
    // 16 MiB ceiling would silently drop to 4 MiB and large releases would
    // gain four times the pieces. Driving the library directly is the only way
    // to check this without a multi-gigabyte fixture.
    await writeFile(join(release, 'a.flac'), Buffer.alloc(1000, 1))
    const stream = createReadStream(join(release, 'a.flac')) as ReturnType<
      typeof createReadStream
    > & { name: string }
    stream.name = 'Artist - Album (2020) [FLAC]/a.flac'

    const raw = await new Promise<Uint8Array>((resolve, reject) => {
      makeTorrent(
        [stream],
        {
          name: 'Artist - Album (2020) [FLAC]',
          private: true,
          filterJunkFiles: false,
          pieceLength: 16 * 1024 * 1024,
          announceList: [['https://flacsfor.me/abc123/announce']],
          info: { source: 'RED' }
        },
        (err, torrent) => (err ? reject(err) : resolve(torrent))
      )
    })

    const meta = bencode.decode(raw) as unknown as TorrentMeta
    expect(meta.info['piece length']).toBe(16 * 1024 * 1024)
  })
})

describe('createTorrent', () => {
  it('builds a private, source-tagged multi-file torrent', async () => {
    await writeFile(join(release, '01 One.flac'), 'a'.repeat(1000))
    await writeFile(join(release, '02 Two.flac'), 'b'.repeat(2000))

    const torrent = await create()

    expect(text(torrent.meta.announce)).toBe('https://flacsfor.me/abc123/announce')
    expect(text(torrent.meta.info.name)).toBe('Artist - Album (2020) [FLAC]')
    expect(torrent.meta.info.private).toBe(1)
    expect(text(torrent.meta.info.source)).toBe('RED')
    expect(torrent.meta.info.files?.map((f) => f.length)).toEqual([1000, 2000])
    expect(filePaths(torrent.meta)).toEqual(['01 One.flac', '02 Two.flac'])
    expect(torrent.totalBytes).toBe(3000)
    expect(torrent.fileCount).toBe(2)
  })

  it('hashes pieces across file boundaries', async () => {
    // Two 10 KiB files with a 16 KiB piece length: one full piece spanning both
    // files, then a 4 KiB remainder.
    await writeFile(join(release, 'a.flac'), Buffer.alloc(10 * 1024, 1))
    await writeFile(join(release, 'b.flac'), Buffer.alloc(10 * 1024, 2))

    const torrent = await create()
    expect(torrent.pieceLength).toBe(16 * 1024)
    expect(torrent.meta.info.pieces.length).toBe(40)

    const all = Buffer.concat([Buffer.alloc(10 * 1024, 1), Buffer.alloc(10 * 1024, 2)])
    const expected = Buffer.concat([
      createHash('sha1').update(all.subarray(0, 16 * 1024)).digest(),
      createHash('sha1').update(all.subarray(16 * 1024)).digest()
    ])
    expect(Buffer.from(torrent.meta.info.pieces)).toEqual(expected)
  })

  it('produces a stable infohash for identical content', async () => {
    await writeFile(join(release, 'a.flac'), 'hello')
    const first = await create()
    const second = await create()
    expect(second.infoHash).toBe(first.infoHash)
    expect(first.infoHash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('changes the infohash with the source tag', async () => {
    await writeFile(join(release, 'a.flac'), 'hello')
    const red = await create()
    const ops = await createTorrent({
      folderPath: release,
      announceUrl: 'https://home.opsfet.ch/abc123/announce',
      source: 'OPS',
      createdBy: 'gravlax/test'
    })
    expect(ops.infoHash).not.toBe(red.infoHash)
  })

  it('excludes OS junk files', async () => {
    await writeFile(join(release, 'a.flac'), 'hello')
    await writeFile(join(release, '.DS_Store'), 'junk')
    await writeFile(join(release, 'Thumbs.db'), 'junk')
    await writeFile(join(release, 'desktop.ini'), 'junk')
    await writeFile(join(release, '._a.flac'), 'junk')

    expect(filePaths((await create()).meta)).toEqual(['a.flac'])
  })

  it('keeps multi-disc structure and orders by path components', async () => {
    await mkdir(join(release, 'CD2'), { recursive: true })
    await mkdir(join(release, 'CD1'), { recursive: true })
    await writeFile(join(release, 'CD2', '01.flac'), 'x')
    await writeFile(join(release, 'CD1', '01.flac'), 'y')
    await writeFile(join(release, 'cover.jpg'), 'z')

    expect(filePaths((await create()).meta)).toEqual([
      'CD1/01.flac',
      'CD2/01.flac',
      'cover.jpg'
    ])
  })

  it('keeps a subdirectory that holds every file', async () => {
    // The common-prefix trimming in create-torrent would otherwise strip CD1
    // along with the release folder, flattening the release.
    await mkdir(join(release, 'CD1'), { recursive: true })
    await writeFile(join(release, 'CD1', '01.flac'), 'x')
    await writeFile(join(release, 'CD1', '02.flac'), 'y')

    const torrent = await create()
    expect(text(torrent.meta.info.name)).toBe('Artist - Album (2020) [FLAC]')
    expect(filePaths(torrent.meta)).toEqual(['CD1/01.flac', 'CD1/02.flac'])
  })

  it('keeps the folder form for a one-file release', async () => {
    // Gazelle expects a directory; create-torrent would otherwise emit a
    // single-file torrent naming the file after the folder.
    await writeFile(join(release, '01 Only.flac'), 'hello')

    const torrent = await create()
    expect(text(torrent.meta.info.name)).toBe('Artist - Album (2020) [FLAC]')
    expect(torrent.meta.info.length).toBeUndefined()
    expect(torrent.meta.info.files?.map((f) => f.length)).toEqual([5])
    expect(filePaths(torrent.meta)).toEqual(['01 Only.flac'])
  })

  it('follows a symlinked track rather than dropping it', async () => {
    const outside = join(root, 'elsewhere.flac')
    await writeFile(outside, 'linked-audio')
    await writeFile(join(release, '01.flac'), 'plain')
    await symlink(outside, join(release, '02.flac'))

    const torrent = await create()
    expect(filePaths(torrent.meta)).toEqual(['01.flac', '02.flac'])
    expect(torrent.meta.info.files?.map((f) => f.length)).toEqual([5, 'linked-audio'.length])
  })

  it('rejects an empty folder', async () => {
    await expect(create()).rejects.toThrow('no files to include')
  })

  it('honours an abort signal', async () => {
    await writeFile(join(release, 'a.flac'), 'hello')
    const controller = new AbortController()
    controller.abort()
    await expect(
      createTorrent({
        folderPath: release,
        announceUrl: 'https://red.com/abc123/announce',
        source: 'RED',
        createdBy: 'gravlax/test',
        signal: controller.signal
      })
    ).rejects.toThrow('aborted')
  })
})

describe('withComment', () => {
  it('leaves the infohash unchanged', async () => {
    await writeFile(join(release, 'a.flac'), 'hello')
    const torrent = await create()
    const commented = withComment(torrent.meta, 'https://red.com/torrents.php?torrentid=1')

    expect(commented.comment).toBe('https://red.com/torrents.php?torrentid=1')
    expect(infoHash(commented)).toBe(torrent.infoHash)
    expect(bencode.encode(commented)).not.toEqual(torrent.data)
  })
})

describe('writeTorrentFile', () => {
  it('writes bencoded bytes, creating the directory', async () => {
    await writeFile(join(release, 'a.flac'), 'hello')
    const torrent = await create()
    const target = join(root, 'torrents', torrentFileName(release, 'RED'))

    await writeTorrentFile(torrent.meta, target)

    const written = await readFile(target)
    expect(new Uint8Array(written)).toEqual(torrent.data)
    expect(target.endsWith('Artist - Album (2020) [FLAC] - RED.torrent')).toBe(true)
  })
})
