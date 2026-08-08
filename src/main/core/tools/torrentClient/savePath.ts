import type { Config } from '@shared/types/config'

/**
 * The path qBittorrent should use to find the release data.
 *
 * Returns null under Automatic Torrent Management, where the location comes
 * from the category and sending a save path alongside it would be
 * contradictory — qBittorrent silently ignores one of the two.
 *
 * An empty `savePath` falls back to wherever the data was just put: the seedbox
 * `remotePath` when the transfer ran, otherwise the local seeding folder. When
 * the client runs on the seedbox it usually sees the exact directory the upload
 * landed in, and making that case require the same string twice would be
 * busywork. Set `savePath` explicitly when qBittorrent sees a different mount.
 */
export function resolveTorrentSavePath(cfg: Config): string | null {
  if (cfg.torrentClient.useAutoTMM) return null
  const explicit = cfg.torrentClient.savePath.trim()
  if (explicit !== '') return explicit
  if (cfg.transfer.enabled) return cfg.transfer.remotePath.trim()
  return cfg.directories.seeding.trim()
}
