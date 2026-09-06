import { describe, expect, it } from 'vitest'
import { COVER_IMAGE_HOST_IDS, type Config } from '@shared/types/config'
import {
  coverImageHostOptions,
  enabledImageHostOptions,
  enabledSpectralImageHostOptions,
  isCoverImageHostId,
  isValidCoverImageHost,
  sanitizeCoverImageHosts,
  supportsSpectralUpload
} from '@shared/config/imageHosts'

describe('image host catalog', () => {
  it('recognizes every cover image host and rejects unknown hosts', () => {
    for (const host of COVER_IMAGE_HOST_IDS) expect(isCoverImageHostId(host)).toBe(true)
    expect(isCoverImageHostId('other')).toBe(false)
  })
})

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    appearance: { theme: 'system' },
    directories: { source: '', torrents: '', seeding: '' },
    tools: { sox: '', flac: '', metaflac: '', lame: '' },
    trackers: {
      redacted: {
        enabled: false,
        siteUrl: '',
        announceUrl: '',
        apiKey: '',
        sessionCookie: '',
        coverImageHost: ''
      },
      orpheus: {
        enabled: false,
        siteUrl: '',
        announceUrl: '',
        apiKey: '',
        sessionCookie: '',
        coverImageHost: ''
      }
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
      catbox: { enabled: false }
    },
    torrentClient: {
      enabled: false,
      url: '',
      allowInsecureHTTP: false,
      useApiKey: false,
      apiKey: '',
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
      autoRepairFlacIntegrity: false,
      keepExistingTagsByDefault: false
    },
    ...overrides
  }
}

describe('imageHosts', () => {
  it('marks imgbb and catbox as supporting spectral upload', () => {
    expect(supportsSpectralUpload('imgbb')).toBe(true)
    expect(supportsSpectralUpload('catbox')).toBe(true)
    expect(supportsSpectralUpload('thesungod')).toBe(false)
    expect(supportsSpectralUpload('redacted')).toBe(false)
  })

  it('lists enabled hosts and filters spectral options', () => {
    const cfg = baseConfig({
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: true, apiKey: 'key' },
        catbox: { enabled: true }
      }
    })
    expect(enabledImageHostOptions(cfg)).toEqual(['thesungod', 'imgbb', 'catbox'])
    expect(enabledSpectralImageHostOptions(cfg)).toEqual(['imgbb', 'catbox'])
  })

  it('returns no spectral options when imgbb and catbox are disabled', () => {
    const cfg = baseConfig({
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: false, apiKey: '' },
        catbox: { enabled: false }
      }
    })
    expect(enabledSpectralImageHostOptions(cfg)).toEqual([])
  })

  it('lists redacted when the tracker is enabled with an API key', () => {
    let cfg = baseConfig({
      trackers: {
        redacted: {
          enabled: true,
          siteUrl: 'redacted.example',
          announceUrl: 'announce.redacted.example',
          apiKey: 'key',
          sessionCookie: '',
          coverImageHost: ''
        },
        orpheus: {
          enabled: false,
          siteUrl: '',
          announceUrl: '',
          apiKey: '',
          sessionCookie: '',
          coverImageHost: ''
        }
      }
    })
    expect(enabledImageHostOptions(cfg)).toEqual(['redacted'])

    cfg = {
      ...cfg,
      trackers: {
        ...cfg.trackers,
        redacted: { ...cfg.trackers.redacted, enabled: false }
      }
    }
    expect(enabledImageHostOptions(cfg)).toEqual([])
  })

  it('allows redacted cover host only for the redacted tracker', () => {
    const cfg = baseConfig({
      trackers: {
        redacted: {
          enabled: true,
          siteUrl: 'redacted.example',
          announceUrl: 'announce.redacted.example',
          apiKey: 'key',
          sessionCookie: '',
          coverImageHost: ''
        },
        orpheus: {
          enabled: true,
          siteUrl: 'orpheus.example',
          announceUrl: 'announce.orpheus.example',
          apiKey: 'key',
          sessionCookie: '',
          coverImageHost: ''
        }
      },
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: true, apiKey: 'key' },
        catbox: { enabled: true }
      }
    })
    expect(coverImageHostOptions(cfg, 'redacted')).toEqual([
      'thesungod',
      'imgbb',
      'catbox',
      'redacted'
    ])
    expect(coverImageHostOptions(cfg, 'orpheus')).toEqual(['thesungod', 'imgbb', 'catbox'])
    expect(isValidCoverImageHost(cfg, 'orpheus', 'catbox')).toBe(true)
    expect(isValidCoverImageHost(cfg, 'redacted', 'redacted')).toBe(true)
    expect(isValidCoverImageHost(cfg, 'orpheus', 'redacted')).toBe(false)
  })

  it('clears invalid cover image hosts', () => {
    const cfg = baseConfig({
      trackers: {
        redacted: {
          enabled: false,
          siteUrl: '',
          announceUrl: '',
          apiKey: '',
          sessionCookie: '',
          coverImageHost: 'redacted'
        },
        orpheus: {
          enabled: false,
          siteUrl: '',
          announceUrl: '',
          apiKey: '',
          sessionCookie: '',
          coverImageHost: 'redacted'
        }
      },
      imageHosts: {
        thesungod: { enabled: false, apiKey: '' },
        imgbb: { enabled: true, apiKey: 'key' },
        catbox: { enabled: false }
      }
    })
    sanitizeCoverImageHosts(cfg)
    expect(cfg.trackers.redacted.coverImageHost).toBe('')
    expect(cfg.trackers.orpheus.coverImageHost).toBe('')
  })

  it('keeps the redacted cover host when the tracker is turned off', () => {
    const cfg = baseConfig({
      trackers: {
        redacted: {
          enabled: false,
          siteUrl: 'redacted.example',
          announceUrl: 'announce.redacted.example',
          apiKey: 'key',
          sessionCookie: '',
          coverImageHost: 'redacted'
        },
        orpheus: {
          enabled: false,
          siteUrl: '',
          announceUrl: '',
          apiKey: '',
          sessionCookie: '',
          coverImageHost: ''
        }
      }
    })
    sanitizeCoverImageHosts(cfg)
    expect(cfg.trackers.redacted.coverImageHost).toBe('redacted')
  })
})
