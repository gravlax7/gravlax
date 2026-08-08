import type { Config, TrackerConfig } from '@shared/types/config'

export function anyTrackerEnabled(cfg: Config): boolean {
  return cfg.trackers.redacted.enabled || cfg.trackers.orpheus.enabled
}

export function enabledTrackerOptions(cfg: Config): string[] {
  const options: string[] = []
  if (cfg.trackers.redacted.enabled) options.push('redacted')
  if (cfg.trackers.orpheus.enabled) options.push('orpheus')
  return options
}

export function isTrackerConfigured(tracker: TrackerConfig): boolean {
  if (!tracker.enabled) return false
  if (tracker.siteUrl.trim() === '' || tracker.announceUrl.trim() === '') return false
  if (tracker.apiKey.trim() === '' && tracker.sessionCookie.trim() === '') return false
  return true
}

export function canEnableRedactedImageHost(cfg: Config): boolean {
  return (
    isTrackerConfigured(cfg.trackers.redacted) && cfg.trackers.redacted.apiKey.trim() !== ''
  )
}
