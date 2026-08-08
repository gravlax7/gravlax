/**
 * Minimal declarations for the two torrent dependencies, neither of which
 * ships its own. Kept to the surface `createTorrent.ts` actually uses rather
 * than modelling the full API.
 */

declare module 'bencode' {
  const bencode: {
    encode(value: unknown): Uint8Array
    decode(data: Uint8Array): unknown
  }
  export default bencode
}

declare module 'create-torrent' {
  import type { Readable } from 'node:stream'

  interface CreateTorrentOpts {
    name?: string
    comment?: string
    createdBy?: string
    creationDate?: number | Date
    private?: boolean
    pieceLength?: number
    maxPieceLength?: number
    filterJunkFiles?: boolean
    announceList?: string[][]
    urlList?: string[]
    /** Non-standard entries merged into the info dict, e.g. `source`. */
    info?: Record<string, string | number>
    onProgress?: (hashed: number, total: number) => void
  }

  type CreateTorrentInput = string | Uint8Array | Readable | Array<string | Uint8Array | Readable>

  export default function createTorrent(
    input: CreateTorrentInput,
    opts: CreateTorrentOpts,
    cb: (err: Error | null, torrent: Uint8Array) => void
  ): void
}
