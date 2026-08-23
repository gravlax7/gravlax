import type { TrackerConfig } from '@shared/types/config'
import { ORPHEUS_RELEASE_TYPES } from '@shared/upload/releaseTypes'
import { createGazelleTracker } from './factory'
import { GazelleClient } from './gazelle'
import { parseMostRecentTorrentAndGroupIdFromOpsGroupPage } from './html'
import type {
  TrackerRateLimits,
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
    trackerId: 'orpheus',
    siteUrl: cfg.siteUrl,
    announceUrl: cfg.announceUrl,
    apiKey: cfg.apiKey,
    sessionCookie: cfg.sessionCookie,
    releaseTypes: ORPHEUS_RELEASE_TYPES,
    rateLimits: ORPHEUS_RATE_LIMITS,
    timeoutMs
  })

  return createGazelleTracker('orpheus', cfg, client)
}
