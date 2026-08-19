import type { TrackerConfig } from '@shared/types/config'
import type { TrackerAuthMode } from '@shared/upload/validation'
import { REDACTED_RELEASE_TYPES } from '@shared/upload/releaseTypes'
import { GazelleClient } from './gazelle'
import type {
  TrackerRateLimits,
  TrackerUploadData,
  TrackerUploadFiles,
  TrackerUploadResult
} from './types'

export { REDACTED_RELEASE_TYPES }

export const REDACTED_RATE_LIMITS: TrackerRateLimits = {
  session: { maxRequests: 5, windowMs: 10_000 },
  apiKey: { maxRequests: 10, windowMs: 10_000 }
}

export class RedactedClient extends GazelleClient {
  async upload(
    data: TrackerUploadData,
    files: TrackerUploadFiles,
    signal?: AbortSignal
  ): Promise<TrackerUploadResult> {
    if ((files.logFiles?.length ?? 0) > 0) {
      return this.sitePageUpload(data, files, signal)
    }
    return super.upload(data, files, signal)
  }

  async sitePageUpload(
    data: TrackerUploadData,
    files: TrackerUploadFiles,
    signal?: AbortSignal
  ): Promise<TrackerUploadResult> {
    const payload = { ...data }
    const groupIdValue = payload.groupid
    const groupId =
      typeof groupIdValue === 'number'
        ? groupIdValue
        : typeof groupIdValue === 'string'
          ? Number(groupIdValue)
          : undefined
    if (groupId !== undefined && Number.isFinite(groupId)) {
      await this.enrichUploadDataFromGroup(payload, groupId, signal)
    }
    return super.sitePageUpload(payload, files, signal)
  }
}

export function createRedactedTracker(cfg: TrackerConfig, timeoutMs = 10_000) {
  const client = new RedactedClient({
    trackerId: 'redacted',
    siteUrl: cfg.siteUrl,
    announceUrl: cfg.announceUrl,
    apiKey: cfg.apiKey,
    sessionCookie: cfg.sessionCookie,
    releaseTypes: REDACTED_RELEASE_TYPES,
    rateLimits: REDACTED_RATE_LIMITS,
    timeoutMs
  })

  return {
    id: 'redacted' as const,
    name: 'Redacted',
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
