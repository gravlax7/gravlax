import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import bencode from 'bencode'
import makeTorrent from 'create-torrent'
import { enumerateReleaseFiles, totalSize, type ReleaseFile } from '@main/core/tools/releaseFiles'

const MIN_PIECE_LENGTH = 16 * 1024
const MAX_PIECE_LENGTH = 16 * 1024 * 1024
const TARGET_PIECE_COUNT = 1500

export interface TorrentInfo {
  name: Uint8Array
  'piece length': number
  pieces: Uint8Array
  files?: Array<{ length: number; path: Uint8Array[] }>
  length?: number
  private: number
  source: Uint8Array
}

export interface TorrentMeta {
  announce?: Uint8Array
  comment?: string
  info: TorrentInfo
  [key: string]: unknown
}

export interface CreateTorrentOptions {
  folderPath: string
  announceUrl: string
  /** Tracker source tag ("RED" / "OPS"). Part of `info`, so it changes the infohash. */
  source: string
  createdBy: string
  signal?: AbortSignal
}

export interface CreatedTorrent {
  meta: TorrentMeta
  data: Uint8Array
  infoHash: string
  pieceLength: number
  totalBytes: number
  fileCount: number
}

export async function createTorrent(options: CreateTorrentOptions): Promise<CreatedTorrent> {
  const { folderPath, announceUrl, source, createdBy, signal } = options
  if (!folderPath) throw new Error('torrent: folder path is required')
  if (!announceUrl) throw new Error('torrent: announce URL is required')
  throwIfAborted(signal)

  const files = await enumerateReleaseFiles(folderPath)
  if (files.length === 0) {
    throw new Error(`torrent: no files to include in "${folderPath}"`)
  }
  throwIfAborted(signal)

  const totalBytes = totalSize(files)
  const pieceLength = choosePieceLength(totalBytes)
  const name = basename(folderPath)

  const data = await buildTorrent({ files, folderPath, name, announceUrl, source, createdBy, pieceLength, signal })
  const meta = bencode.decode(data) as unknown as TorrentMeta
  normalizeToMultiFile(meta, files)

  // The torrent must name exactly the files the enumerator returned. A drift —
  // create-torrent trimming a common prefix or dropping a stream — would
  // publish a torrent that can never reach 100%: the client looks for files
  // the torrent never listed.
  const expectedPaths = files.map((file) => file.relativePath).sort()
  const listedPaths = (meta.info.files ?? [])
    .map((file) => file.path.map((part) => new TextDecoder().decode(part)).join('/'))
    .sort()
  if (
    listedPaths.length !== expectedPaths.length ||
    listedPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new Error(`torrent: file list does not match the enumerated release (${folderPath})`)
  }

  return {
    meta,
    data: bencode.encode(meta) as unknown as Uint8Array,
    infoHash: infoHash(meta),
    pieceLength,
    totalBytes,
    fileCount: files.length
  }
}

interface BuildOptions {
  files: ReleaseFile[]
  folderPath: string
  name: string
  announceUrl: string
  source: string
  createdBy: string
  pieceLength: number
  signal?: AbortSignal
}

function buildTorrent(options: BuildOptions): Promise<Uint8Array> {
  const { files, folderPath, name, announceUrl, source, createdBy, pieceLength, signal } = options

  // Streams rather than paths: create-torrent reduces a plain path array to
  // basenames, which would flatten CD1/CD2 into one directory and collide
  // identically-named tracks. A stream carries its own `name`, so the relative
  // path we enumerated is the path that lands in the torrent.
  //
  // Each name is prefixed with the release folder so create-torrent's
  // common-prefix trimming always strips exactly that folder. Without it, a
  // release whose files all sit under one subdirectory would have that
  // subdirectory silently stripped instead.
  const streams = files.map((file) => {
    const stream = createReadStream(file.absolutePath) as ReturnType<typeof createReadStream> & {
      name: string
    }
    stream.name = `${name}/${file.relativePath}`
    return stream
  })

  const destroyAll = (): void => {
    for (const stream of streams) stream.destroy()
  }
  signal?.addEventListener('abort', destroyAll, { once: true })

  return new Promise((resolve, reject) => {
    makeTorrent(
      streams,
      {
        name,
        private: true,
        // Our enumerator is the single authority on which files are included;
        // a second filter here could drop one the transfer still sends.
        filterJunkFiles: false,
        // Required: a stream reports no length up front, so the automatic
        // calculation would see a zero-byte torrent and pick the 16 KiB
        // minimum — roughly 190k pieces, and a multi-megabyte torrent file,
        // for a large release.
        pieceLength,
        createdBy,
        announceList: [[announceUrl]],
        info: { source }
      },
      (err: Error | null, torrent: Uint8Array) => {
        signal?.removeEventListener('abort', destroyAll)
        if (err) {
          reject(new Error(`torrent: ${err.message} (${folderPath})`))
          return
        }
        if (signal?.aborted) {
          reject(new Error('Torrent creation aborted'))
          return
        }
        resolve(torrent)
      }
    )
  })
}

/**
 * Force the folder form even for a one-file release.
 *
 * create-torrent emits a single-file torrent whenever it is handed one input,
 * which would publish the release under `info.length` with the folder name used
 * as the file name. Gazelle expects a directory. Only the file-list
 * representation changes here — pieces hash the concatenated content either
 * way, so the payload is untouched.
 */
function normalizeToMultiFile(meta: TorrentMeta, files: ReleaseFile[]): void {
  if (meta.info.files !== undefined || meta.info.length === undefined) return
  const only = files[0]
  if (!only || files.length !== 1) return

  meta.info.files = [
    {
      length: meta.info.length,
      path: only.relativePath.split('/').map((part) => new TextEncoder().encode(part))
    }
  ]
  delete meta.info.length
}

export function infoHash(meta: TorrentMeta): string {
  return createHash('sha1')
    .update(bencode.encode(meta.info) as unknown as Uint8Array)
    .digest('hex')
}

/**
 * `comment` lives outside `info`, so adding one after the upload leaves the
 * infohash — and any torrent already handed to a client — untouched.
 */
export function withComment(meta: TorrentMeta, comment: string): TorrentMeta {
  return { ...meta, comment }
}

export async function writeTorrentFile(meta: TorrentMeta, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o755 })
  await writeFile(filePath, bencode.encode(meta) as unknown as Uint8Array)
}

export function torrentFileName(folderPath: string, source: string): string {
  return `${basename(folderPath)} - ${source}.torrent`
}

export function choosePieceLength(totalBytes: number): number {
  let pieceLength = MIN_PIECE_LENGTH
  while (pieceLength < MAX_PIECE_LENGTH && totalBytes / pieceLength > TARGET_PIECE_COUNT) {
    pieceLength *= 2
  }
  return pieceLength
}

export function torrentFilePath(directory: string, folderPath: string, source: string): string {
  return join(directory, torrentFileName(folderPath, source))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Torrent creation aborted')
}
