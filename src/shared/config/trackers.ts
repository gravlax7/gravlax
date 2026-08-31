import type { Config, TrackerConfig } from '@shared/types/config'
import { UPLOAD_TRACKER_IDS, type UploadTrackerId } from '@shared/trackers'
import { isTrackerHost, normalizeTrackerHost } from './network'

export function normalizeTrackerHosts(cfg: Config): Config {
  const next = structuredClone(cfg)
  for (const id of UPLOAD_TRACKER_IDS) {
    next.trackers[id].siteUrl = normalizeTrackerHost(next.trackers[id].siteUrl)
    next.trackers[id].announceUrl = normalizeTrackerHost(next.trackers[id].announceUrl)
  }
  return next
}

export function anyTrackerEnabled(cfg: Config): boolean {
  return UPLOAD_TRACKER_IDS.some((id) => cfg.trackers[id].enabled)
}

export function enabledTrackerOptions(cfg: Config): UploadTrackerId[] {
  return UPLOAD_TRACKER_IDS.filter((id) => cfg.trackers[id].enabled)
}

export function isTrackerConfigured(tracker: TrackerConfig): boolean {
  if (!tracker.enabled) return false
  const siteHost = normalizeTrackerHost(tracker.siteUrl)
  const announceHost = normalizeTrackerHost(tracker.announceUrl)
  if (!isTrackerHost(siteHost) || !isTrackerHost(announceHost)) return false
  if (tracker.apiKey.trim() === '' && tracker.sessionCookie.trim() === '') return false
  return true
}

export function canEnableRedactedImageHost(cfg: Config): boolean {
  return (
    isTrackerConfigured(cfg.trackers.redacted) && cfg.trackers.redacted.apiKey.trim() !== ''
  )
}
