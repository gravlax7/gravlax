import type { TrackerConfig } from '@shared/types/config'
import type { TrackerAuthMode } from '@shared/upload/validation'
import { ORPHEUS_RELEASE_TYPES } from '@shared/upload/releaseTypes'
import { GazelleClient } from './gazelle'
import { parseMostRecentTorrentAndGroupIdFromOpsGroupPage } from './html'
import type {
  TrackerRateLimits,
  TrackerUploadData,
  TrackerUploadFiles,
  TrackerUploadResult
} from './types'

export { ORPHEUS_RELEASE_TYPES }

export const ORPHEUS_RATE_LIMITS: TrackerRateLimits = {
  session: { maxRequests: 5, windowMs: 10_000 },
  apiKey: { maxRequests: 5, windowMs: 10_000 }
}

export class OrpheusClient extends GazelleClient {
  parseMostRecentTorrentAndGroupIdFromGroupPage(text: string): TrackerUploadResult {
    return parseMostRecentTorrentAndGroupIdFromOpsGroupPage(text)
  }

  lossyReportType(_source: string): string {
    return 'lossyapproval'
  }
}

export function createOrpheusTracker(cfg: TrackerConfig, timeoutMs = 10_000) {
  const client = new OrpheusClient({
    siteUrl: cfg.siteUrl,
    announceUrl: cfg.announceUrl,
    apiKey: cfg.apiKey,
    sessionCookie: cfg.sessionCookie,
    releaseTypes: ORPHEUS_RELEASE_TYPES,
    rateLimits: ORPHEUS_RATE_LIMITS,
    timeoutMs
  })

  return {
    id: 'orpheus' as const,
    name: 'Orpheus',
    client,
    async healthcheck(mode: TrackerAuthMode, signal?: AbortSignal) {
      if (!cfg.siteUrl.trim()) {
        throw new Error('Missing site URL')
      }
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
