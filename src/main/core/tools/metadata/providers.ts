import type { Config } from '@shared/types/config'
import type { Provider } from './base'
import { BANDCAMP_NAME, createBandcampProvider } from './bandcamp'
import { createDeezerProvider, DEEZER_NAME } from './deezer'
import { timeoutMsFromConfig } from './http'
import { createMusicBrainzProvider, MUSICBRAINZ_NAME } from './musicbrainz'

export interface ProviderDefinition {
  name: string
  enabled: boolean
}

export function providerDefinitions(cfg: Config): ProviderDefinition[] {
  const m = cfg.metadataProviders
  return [
    { name: MUSICBRAINZ_NAME, enabled: m.musicBrainz.enabled },
    { name: DEEZER_NAME, enabled: m.deezer.enabled },
    { name: BANDCAMP_NAME, enabled: m.bandcamp.enabled }
  ]
}

export function createProviders(cfg: Config): Provider[] {
  const timeoutMs = timeoutMsFromConfig(cfg.metadataProviders.requestTimeoutSeconds)
  return [
    createMusicBrainzProvider(timeoutMs),
    createDeezerProvider(timeoutMs),
    createBandcampProvider(timeoutMs)
  ]
}
