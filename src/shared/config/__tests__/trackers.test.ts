import { describe, expect, it } from 'vitest'
import type { Config, TrackerConfig } from '@shared/types/config'
import { canEnableRedactedImageHost, isTrackerConfigured } from '@shared/config/trackers'

const emptyTracker: TrackerConfig = {
  enabled: false,
  siteUrl: '',
  announceUrl: '',
  apiKey: '',
  sessionCookie: '',
  coverImageHost: ''
}

function cfgWithRedacted(tracker: TrackerConfig): Config {
  return {
    appearance: { theme: 'system' },
    directories: { source: '', torrents: '', seeding: '' },
    tools: { sox: '', flac: '', metaflac: '', lame: '' },
    trackers: {
      redacted: tracker,
      orpheus: { ...emptyTracker }
    },
    metadataProviders: {
      musicBrainz: { enabled: true },
      deezer: { enabled: true },
      bandcamp: { enabled: true },
      discogs: { enabled: false, token: '' },
      requestTimeoutSeconds: 10
    },
    imageHosts: {
      thesungod: { enabled: false, apiKey: '' },
      imgbb: { enabled: false, apiKey: '' },
      catbox: { enabled: false },
      redacted: { enabled: false }
    },
    torrentClient: {
      enabled: false,
      url: '',
      username: '',
      password: '',
      category: '',
      useAutoTMM: false,
      savePath: '',
      startPaused: false
    },
    transfer: {
      enabled: false,
      host: '',
      port: 22,
      username: '',
      password: '',
      privateKeyPath: '',
      remotePath: ''
    },
    naming: {
      albumDescriptionTemplateId: 'peachfuzz',
      releaseFolderTemplate: '{artists} - {title}',
      trackFileTemplate: '{trackNumber}. {title}',
      multiDiscFolderTemplate: 'Disc {discNumber}'
    },
    spectral: {
      imageHost: '',
      defaultSpectralIds: 'Random',
      defaultSpectralIdsForLossyMasters: 'All'
    },
    cleanup: {
      archiveDirectory: '',
      deleteOriginalFolder: false,
      deleteTemporaryFiles: true,
      deleteSpectralsAfterUpload: false
    },
    workflow: {
      confirmBeforeWrites: true,
      useUpcAsCatNo: true,
      autoRepairFlacIntegrity: false
    }
  }
}

describe('trackers', () => {
  it('treats a tracker as configured only when enabled with urls and credentials', () => {
    expect(isTrackerConfigured(emptyTracker)).toBe(false)
    expect(
      isTrackerConfigured({
        ...emptyTracker,
        enabled: true,
        siteUrl: 'https://redacted.example',
        announceUrl: 'https://flacsfor.me',
        apiKey: 'key'
      })
    ).toBe(true)
    expect(
      isTrackerConfigured({
        ...emptyTracker,
        enabled: true,
        siteUrl: 'https://redacted.example',
        announceUrl: 'https://flacsfor.me',
        sessionCookie: 'cookie'
      })
    ).toBe(true)
    expect(
      isTrackerConfigured({
        ...emptyTracker,
        enabled: true,
        siteUrl: 'https://redacted.example',
        announceUrl: 'https://flacsfor.me'
      })
    ).toBe(false)
  })

  it('gates redacted image host on redacted tracker configuration', () => {
    expect(canEnableRedactedImageHost(cfgWithRedacted(emptyTracker))).toBe(false)
    expect(
      canEnableRedactedImageHost(
        cfgWithRedacted({
          ...emptyTracker,
          enabled: true,
          siteUrl: 'https://redacted.example',
          announceUrl: 'https://flacsfor.me',
          apiKey: 'key'
        })
      )
    ).toBe(true)

    expect(
      canEnableRedactedImageHost(
        cfgWithRedacted({
          ...emptyTracker,
          enabled: true,
          siteUrl: 'https://redacted.example',
          announceUrl: 'https://flacsfor.me',
          sessionCookie: 'cookie'
        })
      )
    ).toBe(false)
  })
})
