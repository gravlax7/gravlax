export const UPLOAD_TRACKER_IDS = ['redacted', 'orpheus'] as const

export type UploadTrackerId = (typeof UPLOAD_TRACKER_IDS)[number]

export const TRACKER_INFO = {
  redacted: { name: 'Redacted', code: 'RED' },
  orpheus: { name: 'Orpheus', code: 'OPS' }
} as const satisfies Record<UploadTrackerId, { name: string; code: string }>

export const TRACKER_AUTH_MODES = ['api', 'session'] as const

export type TrackerAuthMode = (typeof TRACKER_AUTH_MODES)[number]

export function isUploadTrackerId(value: unknown): value is UploadTrackerId {
  return UPLOAD_TRACKER_IDS.some((id) => id === value)
}

export function trackerName(id: UploadTrackerId): string {
  return TRACKER_INFO[id].name
}

export function trackerCode(id: UploadTrackerId): string {
  return TRACKER_INFO[id].code
}
