export type TrackerId = 'redacted' | 'orpheus'

export interface GazelleEnvelope<T = unknown> {
  status: string
  response?: T
  error?: string
}

export interface GazelleIndexResponse {
  authkey: string
  passkey: string
  username?: string
  id?: number
}

export type BrowseParams = Record<string, string | number | undefined>

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

export interface TrackerRateLimits {
  session: RateLimitConfig
  apiKey: RateLimitConfig
}

export interface GazelleClientOptions {
  trackerId?: TrackerId
  siteUrl: string
  announceUrl: string
  apiKey: string
  sessionCookie: string
  releaseTypes: Record<string, number>
  rateLimits: TrackerRateLimits
  timeoutMs?: number
  userAgent?: string
}

export type LogcheckerChecksum = 'checksum_ok' | 'checksum_invalid' | 'checksum_missing'

export interface LogcheckerResult {
  score: number
  issues: string[]
  ripper?: string
  ripperVersion?: string
  language?: string
  checksum?: LogcheckerChecksum | string
}

export type LogcheckerInput =
  | { pastelog: string; log?: undefined }
  | {
      pastelog?: string
      log: { data: Uint8Array | ArrayBuffer | Blob; filename?: string }
    }

export type TrackerUploadFieldValue = string | number | boolean | Array<string | number>

export type TrackerUploadData = Record<string, TrackerUploadFieldValue>

export interface TrackerUploadFiles {
  torrentData: Uint8Array | ArrayBuffer | Blob
  logFiles?: Array<{ filename: string; data: Uint8Array | ArrayBuffer | Blob }>
}

export interface TrackerUploadResult {
  torrentId: number
  groupId: number
  filledRequestUrl?: string
}
