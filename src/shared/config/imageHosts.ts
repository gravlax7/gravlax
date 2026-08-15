import type { Config } from '@shared/types/config'
import { canEnableRedactedImageHost } from '@shared/config/trackers'

const SPECTRAL_UPLOAD_HOSTS = new Set(['imgbb', 'catbox'])

export type TrackerImageHostTarget = 'redacted' | 'orpheus'

export function supportsSpectralUpload(host: string): boolean {
  return SPECTRAL_UPLOAD_HOSTS.has(host)
}

export function enabledImageHostOptions(cfg: Config): string[] {
  const options: string[] = []
  if (cfg.imageHosts.thesungod.enabled) options.push('thesungod')
  if (cfg.imageHosts.imgbb.enabled) options.push('imgbb')
  if (cfg.imageHosts.catbox.enabled) options.push('catbox')
  if (cfg.imageHosts.redacted.enabled && canEnableRedactedImageHost(cfg)) options.push('redacted')
  return options
}

export function enabledSpectralImageHostOptions(cfg: Config): string[] {
  return enabledImageHostOptions(cfg).filter(supportsSpectralUpload)
}

export function coverImageHostOptions(cfg: Config, tracker: TrackerImageHostTarget): string[] {
  const options = enabledImageHostOptions(cfg)
  if (tracker === 'redacted') return options
  return options.filter((host) => host !== 'redacted')
}

export function isValidCoverImageHost(
  cfg: Config,
  tracker: TrackerImageHostTarget,
  host: string
): boolean {
  if (host === '') return true
  return coverImageHostOptions(cfg, tracker).includes(host)
}

export function sanitizeCoverImageHosts(cfg: Config): void {
  if (!isValidCoverImageHost(cfg, 'redacted', cfg.trackers.redacted.coverImageHost)) {
    cfg.trackers.redacted.coverImageHost = ''
  }
  if (!isValidCoverImageHost(cfg, 'orpheus', cfg.trackers.orpheus.coverImageHost)) {
    cfg.trackers.orpheus.coverImageHost = ''
  }
}
