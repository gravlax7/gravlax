export const TORRENT_PIECE_SIZES = [
  'Auto',
  '16 KiB',
  '32 KiB',
  '64 KiB',
  '128 KiB',
  '256 KiB',
  '512 KiB',
  '1 MiB',
  '2 MiB',
  '4 MiB',
  '8 MiB',
  '16 MiB'
] as const

export type TorrentPieceSize = (typeof TORRENT_PIECE_SIZES)[number]

export function isTorrentPieceSize(value: unknown): value is TorrentPieceSize {
  return TORRENT_PIECE_SIZES.some((size) => size === value)
}

/** Bytes for a fixed size, undefined for Auto. */
export function pieceSizeBytes(size: TorrentPieceSize): number | undefined {
  if (size === 'Auto') return undefined
  const [amount, unit] = size.split(' ')
  return Number(amount) * (unit === 'MiB' ? 1024 * 1024 : 1024)
}
