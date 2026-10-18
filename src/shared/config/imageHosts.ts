import {
  COVER_IMAGE_HOST_IDS,
  type Config,
  type CoverImageHostId
} from '@shared/types/config'
import { canEnableRedactedImageHost } from '@shared/config/trackers'
import { UPLOAD_TRACKER_IDS } from '@shared/trackers'

const SPECTRAL_UPLOAD_HOSTS = new Set(['imgbb', 'catbox', 'ptscreens'])
const COVER_IMAGE_HOSTS = new Set<CoverImageHostId>(COVER_IMAGE_HOST_IDS)

export function supportsSpectralUpload(host: string): boolean {
  return SPECTRAL_UPLOAD_HOSTS.has(host)
}

export function isCoverImageHostId(host: string): host is CoverImageHostId {
  return COVER_IMAGE_HOSTS.has(host as CoverImageHostId)
}

export function enabledImageHostOptions(cfg: Config): string[] {
  const options: string[] = []
  if (cfg.imageHosts.thesungod.enabled) options.push('thesungod')
  if (cfg.imageHosts.imgbb.enabled) options.push('imgbb')
  if (cfg.imageHosts.catbox.enabled) options.push('catbox')
  if (cfg.imageHosts.ptscreens.enabled) options.push('ptscreens')
  if (canEnableRedactedImageHost(cfg)) options.push('redacted')
  return options
}

export function enabledSpectralImageHostOptions(cfg: Config): string[] {
  return enabledImageHostOptions(cfg).filter(supportsSpectralUpload)
}

export function isValidCoverImageHost(cfg: Config, host: string): boolean {
  return host === '' || enabledImageHostOptions(cfg).includes(host)
}

export function sanitizeCoverImageHosts(cfg: Config): void {
  for (const id of UPLOAD_TRACKER_IDS) {
    if (!isValidCoverImageHost(cfg, cfg.trackers[id].coverImageHost)) {
      cfg.trackers[id].coverImageHost = ''
    }
  }
}
