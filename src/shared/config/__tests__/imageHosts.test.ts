import { describe, expect, it } from 'vitest'
import type { Config } from '@shared/types/config'
import {
  coverImageHostOptions,
  enabledImageHostOptions,
  enabledSpectralImageHostOptions,
  isValidCoverImageHost,
  sanitizeCoverImageHosts,
  supportsSpectralUpload
} from '@shared/config/imageHosts'

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    appearance: { theme: 'system' },
    directories: { source: '', torrents: '', seeding: '' },
    tools: { sox: '', flac: '', metaflac: '', mp3val: '', lame: '' },
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
      deezer: { enabled: false },
      requestTimeoutSeconds: 10
    },
    imageHosts: {
      thesungod: { enabled: false, apiKey: '' },
      imgbb: { enabled: false, apiKey: '' },
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
      deleteTemporaryFiles: true,
      deleteSpectralsAfterUpload: false
    },
    workflow: {
      confirmBeforeWrites: true,
      useUpcAsCatNo: true
    },
    ...overrides
  }
}

describe('imageHosts', () => {
  it('marks only imgbb as supporting spectral upload', () => {
    expect(supportsSpectralUpload('imgbb')).toBe(true)
    expect(supportsSpectralUpload('thesungod')).toBe(false)
    expect(supportsSpectralUpload('redacted')).toBe(false)
  })

  it('lists enabled hosts and filters spectral options to imgbb', () => {
    const cfg = baseConfig({
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: true, apiKey: 'key' },
        redacted: { enabled: false }
      }
    })
    expect(enabledImageHostOptions(cfg)).toEqual(['thesungod', 'imgbb'])
    expect(enabledSpectralImageHostOptions(cfg)).toEqual(['imgbb'])
  })

  it('returns no spectral options when imgbb is disabled', () => {
    const cfg = baseConfig({
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: false, apiKey: '' },
        redacted: { enabled: false }
      }
    })
    expect(enabledSpectralImageHostOptions(cfg)).toEqual([])
  })

  it('lists redacted only when enabled and the tracker is configured', () => {
    let cfg = baseConfig({
      trackers: {
        redacted: {
          enabled: true,
          siteUrl: 'https://redacted.example',
          announceUrl: 'https://flacsfor.me',
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
      },
      imageHosts: {
        thesungod: { enabled: false, apiKey: '' },
        imgbb: { enabled: false, apiKey: '' },
        redacted: { enabled: true }
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
          siteUrl: 'https://redacted.example',
          announceUrl: 'https://flacsfor.me',
          apiKey: 'key',
          sessionCookie: '',
          coverImageHost: ''
        },
        orpheus: {
          enabled: true,
          siteUrl: 'https://orpheus.example',
          announceUrl: 'https://home.opsfet.ch',
          apiKey: 'key',
          sessionCookie: '',
          coverImageHost: ''
        }
      },
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: true, apiKey: 'key' },
        redacted: { enabled: true }
      }
    })
    expect(coverImageHostOptions(cfg, 'redacted')).toEqual(['thesungod', 'imgbb', 'redacted'])
    expect(coverImageHostOptions(cfg, 'orpheus')).toEqual(['thesungod', 'imgbb'])
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
        redacted: { enabled: false }
      }
    })
    sanitizeCoverImageHosts(cfg)
    expect(cfg.trackers.redacted.coverImageHost).toBe('')
    expect(cfg.trackers.orpheus.coverImageHost).toBe('')
  })
})
