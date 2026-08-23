import type { TrackerConfig } from '@shared/types/config'
import { trackerName, type UploadTrackerId } from '@shared/trackers'
import type { TrackerAuthMode } from '@shared/upload/validation'
import type { GazelleClient } from './gazelle'
import type { TrackerUploadData, TrackerUploadFiles } from './types'

export function createGazelleTracker<T extends UploadTrackerId>(
  id: T,
  cfg: TrackerConfig,
  client: GazelleClient
) {
  return {
    id,
    name: trackerName(id),
    client,
    async healthcheck(mode: TrackerAuthMode, signal?: AbortSignal) {
      if (!cfg.siteUrl.trim()) throw new Error('Missing site URL')
      await client.checkAuthentication(mode, signal)
    },
    upload(data: TrackerUploadData, files: TrackerUploadFiles, signal?: AbortSignal) {
      return client.upload(data, files, signal)
    },
    reportLossyMaster(
      torrentId: number,
      comment: string,
      source: string,
      signal?: AbortSignal
    ) {
      return client.reportLossyMaster(torrentId, comment, source, signal)
    }
  }
}
