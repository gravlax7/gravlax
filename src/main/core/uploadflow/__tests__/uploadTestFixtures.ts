import type { Config } from '@shared/types/config'
import { defaultConfig } from '@main/core/config/defaults'

export const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46
])
export const TEST_VERSION = 'test'

export function cfgWithTrackers(enabled: Array<'redacted' | 'orpheus'>): Config {
  const cfg = structuredClone(defaultConfig())
  cfg.trackers.redacted.enabled = enabled.includes('redacted')
  cfg.trackers.orpheus.enabled = enabled.includes('orpheus')
  return cfg
}

export function cfgWithCoverHost(): Config {
  const cfg = cfgWithTrackers(['redacted'])
  cfg.imageHosts.imgbb.enabled = true
  cfg.imageHosts.imgbb.apiKey = 'imgbb-key'
  cfg.trackers.redacted.coverImageHost = 'imgbb'
  return cfg
}
