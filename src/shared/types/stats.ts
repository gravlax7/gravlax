import type { UploadTrackerId } from './upload'

/** Public, aggregate-only upload statistics. */
export interface UploadStats {
  version: 1
  formats: Record<string, number>
  trackers: Record<UploadTrackerId, number>
}

export function totalUploads(stats: UploadStats): number {
  return Object.values(stats.formats).reduce((total, count) => total + count, 0)
}
