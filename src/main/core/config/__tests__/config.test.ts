import { describe, expect, it } from 'vitest'
import {
  defaultConfig,
  fieldBoolValue,
  fieldValue,
  resetSection,
  setFieldBool,
  setFieldString,
  validate
} from '@main/core/config'
import { mergeLoadedConfig } from '@main/core/config/store'

describe('config', () => {
  it('default includes every section with expected values', () => {
    const cfg = defaultConfig()
    expect(cfg.naming.releaseFolderTemplate).not.toBe('')
    expect(cfg.naming.trackFileTemplate).not.toBe('')
    expect(cfg.naming.albumDescriptionTemplateId).toBe('peachfuzz')
    expect(cfg.tools).toEqual({
      sox: '',
      flac: '',
      metaflac: '',
      mp3val: '',
      lame: ''
    })
    expect(cfg.appearance.theme).toBe('system')
    expect(cfg.workflow.confirmBeforeWrites).toBe(true)
    expect(cfg.workflow.useUpcAsCatNo).toBe(true)
    expect(cfg.metadataProviders.requestTimeoutSeconds).toBe(10)
    expect(cfg.metadataProviders.musicBrainz.enabled).toBe(true)
    expect(cfg.metadataProviders.deezer.enabled).toBe(false)
    expect(cfg.imageHosts.catbox).toEqual({ enabled: true })
    expect(cfg.spectral.defaultSpectralIds).toBe('Random')
    expect(cfg.spectral.defaultSpectralIdsForLossyMasters).toBe('All')
    expect(cfg.cleanup.deleteOriginalFolder).toBe(false)
    expect(cfg.cleanup.deleteTemporaryFiles).toBe(false)
    expect(cfg.cleanup.deleteSpectralsAfterUpload).toBe(false)
    expect(cfg.cleanup.archiveDirectory).toBe('')
  })

  it('resetSection restores defaults for one section', () => {
    let cfg = defaultConfig()
    cfg = { ...cfg, directories: { ...cfg.directories, source: '/tmp' } }
    cfg = resetSection(cfg, 'directories')
    expect(cfg.directories.source).toBe('')
  })

  it('loads, normalizes, and resets tool overrides without breaking old configs', () => {
    const old = mergeLoadedConfig({ directories: { source: '/music' } })
    expect(old.tools).toEqual(defaultConfig().tools)

    const loaded = mergeLoadedConfig({ tools: { sox: '  /opt/tools/sox  ', unknown: '/bad' } })
    expect(loaded.tools.sox).toBe('/opt/tools/sox')
    expect(loaded.tools).not.toHaveProperty('unknown')

    loaded.tools.sox = '/custom/sox'
    expect(resetSection(loaded, 'tools').tools).toEqual(defaultConfig().tools)
  })

  it('adds the enabled catbox default when loading an older config', () => {
    const cfg = mergeLoadedConfig({
      imageHosts: { imgbb: { enabled: true, apiKey: 'key' } }
    })
    expect(cfg.imageHosts.imgbb).toEqual({ enabled: true, apiKey: 'key' })
    expect(cfg.imageHosts.catbox).toEqual({ enabled: true })
  })

  it('keeps catbox disabled when a saved config turns it off', () => {
    const cfg = mergeLoadedConfig({ imageHosts: { catbox: { enabled: false } } })
    expect(cfg.imageHosts.catbox).toEqual({ enabled: false })
  })

  it('reads and updates the catbox settings toggle', () => {
    const cfg = setFieldBool(defaultConfig(), 'imageHosts', 'catbox.enabled', false)
    expect(fieldBoolValue(cfg, 'imageHosts', 'catbox.enabled')).toBe(false)
  })

  it('requires configured tool overrides to be absolute clean paths', () => {
    const cfg = defaultConfig()
    cfg.tools.sox = 'relative/sox'
    expect(validate(cfg)).toContainEqual({
      section: 'tools',
      field: 'sox',
      message: 'executable path must be an absolute, clean path'
    })

    cfg.tools.sox = '~/bin/sox'
    expect(validate(cfg).some((issue) => issue.section === 'tools')).toBe(false)
  })

  it('drops retired naming settings when loading config', () => {
    const cfg = mergeLoadedConfig({
      naming: {
        releaseFolderTemplate: '{title}',
        replaceSpacesWith: '_'
      }
    })
    expect(cfg.naming.releaseFolderTemplate).toBe('{title}')
    expect(cfg.naming).not.toHaveProperty('replaceSpacesWith')
  })

  it('drops the retired temporary directory setting when loading config', () => {
    const cfg = mergeLoadedConfig({
      cleanup: {
        deleteTemporaryFiles: false,
        temporaryDirectory: '/tmp/gravlax'
      }
    })
    expect(cfg.cleanup.deleteTemporaryFiles).toBe(false)
    expect(cfg.cleanup).not.toHaveProperty('temporaryDirectory')
  })

  it('keeps an existing workspace cleanup choice after the default changes', () => {
    const cfg = mergeLoadedConfig({ cleanup: { deleteTemporaryFiles: true } })
    expect(cfg.cleanup.deleteTemporaryFiles).toBe(true)
    expect(cfg.cleanup.deleteOriginalFolder).toBe(false)
  })

  it('reads and updates the original-folder delete toggle', () => {
    const cfg = setFieldBool(defaultConfig(), 'cleanup', 'deleteOriginalFolder', true)
    expect(fieldBoolValue(cfg, 'cleanup', 'deleteOriginalFolder')).toBe(true)
  })

  it('loads and updates the archive folder as a local path', () => {
    const loaded = mergeLoadedConfig({ cleanup: { archiveDirectory: '  /Music/Archive/  ' } })
    expect(loaded.cleanup.archiveDirectory).toBe('/Music/Archive')

    const next = setFieldString(defaultConfig(), 'cleanup', 'archiveDirectory', '/Other/Archive/')
    expect(fieldValue(next, 'cleanup', 'archiveDirectory')).toBe('/Other/Archive')
  })

  it('requires the archive folder to be an absolute clean path', () => {
    const cfg = defaultConfig()
    cfg.cleanup.archiveDirectory = 'relative/archive'
    expect(validate(cfg)).toContainEqual({
      section: 'cleanup',
      field: 'archiveDirectory',
      message: 'archive folder must be an absolute, clean path'
    })
  })

  it('drops the retired spectral compression setting when loading config', () => {
    const cfg = mergeLoadedConfig({ spectral: { compress: true } })
    expect(cfg.spectral).not.toHaveProperty('compress')
  })

  it('drops retired workflow settings when loading config', () => {
    const cfg = mergeLoadedConfig({
      workflow: {
        confirmBeforeWrites: false,
        confirmBeforeNetworkActions: false,
        autoSaveMetadata: true,
        showAdvancedSettings: true,
        startInLastDirectory: true
      }
    })
    expect(cfg.workflow.confirmBeforeWrites).toBe(false)
    expect(cfg.workflow).not.toHaveProperty('confirmBeforeNetworkActions')
    expect(cfg.workflow).not.toHaveProperty('autoSaveMetadata')
    expect(cfg.workflow).not.toHaveProperty('showAdvancedSettings')
    expect(cfg.workflow).not.toHaveProperty('startInLastDirectory')
  })

  it('validate catches required fields', () => {
    let cfg = defaultConfig()
    cfg = {
      ...cfg,
      trackers: {
        ...cfg.trackers,
        redacted: { ...cfg.trackers.redacted, enabled: true, siteUrl: '', announceUrl: '' }
      },
      naming: { ...cfg.naming, releaseFolderTemplate: '' }
    }
    const issues = validate(cfg)
    expect(issues.some((i) => i.field === 'redacted.siteUrl')).toBe(true)
    expect(issues.some((i) => i.field === 'redacted.announceUrl')).toBe(true)
    expect(issues.some((i) => i.field === 'redacted.apiKey')).toBe(true)
    expect(issues.some((i) => i.field === 'releaseFolderTemplate')).toBe(true)
  })

  it('validate requires a category under automatic torrent management', () => {
    const cfg = defaultConfig()
    cfg.torrentClient.enabled = true
    cfg.torrentClient.url = 'http://127.0.0.1:8080'
    cfg.torrentClient.useAutoTMM = true

    // Without a category, ATM silently falls back to qBittorrent's default.
    expect(validate(cfg).some((i) => i.field === 'category')).toBe(true)

    cfg.torrentClient.category = 'music'
    expect(validate(cfg).some((i) => i.field === 'category')).toBe(false)
    // savePath is unused under ATM, so it is never required there.
    expect(validate(cfg).some((i) => i.field === 'savePath')).toBe(false)
  })

  it('only allows qBittorrent HTTP on localhost or loopback', () => {
    const cfg = defaultConfig()
    cfg.torrentClient.url = 'http://192.168.1.20:8080'
    expect(validate(cfg)).toContainEqual({
      section: 'torrentClient',
      field: 'url',
      message: 'WebUI URL must use HTTPS, or HTTP on localhost/loopback'
    })

    cfg.torrentClient.url = 'https://192.168.1.20:8080'
    expect(validate(cfg).some((issue) => issue.field === 'url')).toBe(false)

    cfg.torrentClient.url = 'http://[::1]:8080'
    expect(validate(cfg).some((issue) => issue.field === 'url')).toBe(false)
  })

  it('validate requires a save path only when there is no seedbox to fall back to', () => {
    const cfg = defaultConfig()
    cfg.torrentClient.enabled = true
    cfg.torrentClient.url = 'http://127.0.0.1:8080'
    cfg.torrentClient.useAutoTMM = false

    expect(validate(cfg).some((i) => i.field === 'savePath')).toBe(true)

    // A seedbox remote path is a valid fallback, so an empty savePath is fine.
    cfg.transfer.enabled = true
    expect(validate(cfg).some((i) => i.field === 'savePath')).toBe(false)

    cfg.transfer.enabled = false
    cfg.torrentClient.savePath = '/seed/music'
    expect(validate(cfg).some((i) => i.field === 'savePath')).toBe(false)
  })

  it('does not apply local path rules to the seedbox remote path', () => {
    const cfg = defaultConfig()
    cfg.transfer.enabled = true
    cfg.transfer.host = 'seedbox.example.com'
    cfg.transfer.username = 'uploader'
    cfg.transfer.password = 'secret'
    cfg.transfer.remotePath = '/home/uploader/../seed'

    expect(validate(cfg).some((i) => i.field === 'remotePath')).toBe(false)
  })

  it('validate accepts enabled tracker with defaults and credentials', () => {
    let cfg = defaultConfig()
    cfg = {
      ...cfg,
      trackers: {
        ...cfg.trackers,
        redacted: {
          ...cfg.trackers.redacted,
          enabled: true,
          apiKey: 'key',
          siteUrl: 'https://redacted.ch',
          announceUrl: 'https://flacsfor.me'
        }
      }
    }
    const issues = validate(cfg)
    expect(issues.some((i) => i.section === 'trackers')).toBe(false)
  })

  it('requires HTTPS for enabled tracker URLs', () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted = {
      ...cfg.trackers.redacted,
      enabled: true,
      apiKey: 'key',
      siteUrl: 'http://example.test',
      announceUrl: 'https://example.test'
    }

    expect(validate(cfg)).toContainEqual({
      section: 'trackers',
      field: 'redacted.siteUrl',
      message: 'Redacted site URL must use HTTPS'
    })
  })

  it('loads legacy metadata provider keys and ignores removed providers', () => {
    const cfg = mergeLoadedConfig({
      metadataProviders: {
        musicBrainzEnabled: true,
        deezer: { enabled: true },
        discogsEnabled: true,
        discogsToken: 'secret',
        discogs: { enabled: true, token: 'secret' }
      }
    })
    expect(cfg.metadataProviders.musicBrainz.enabled).toBe(true)
    expect(cfg.metadataProviders.deezer.enabled).toBe(true)
    expect(cfg.metadataProviders).not.toHaveProperty('discogs')
  })

  it('loads legacy flat trackers into nested shape', () => {
    const cfg = mergeLoadedConfig({
      trackers: {
        enabled: true,
        defaultTracker: 'ops',
        apiKey: 'ops-key',
        sessionCookie: 'ops-session'
      }
    })
    expect(cfg.trackers.orpheus.enabled).toBe(true)
    expect(cfg.trackers.orpheus.apiKey).toBe('ops-key')
    expect(cfg.trackers.orpheus.sessionCookie).toBe('ops-session')
    expect(cfg.trackers.redacted.enabled).toBe(false)
  })

  it('drops passkeys from saved tracker settings', () => {
    const cfg = mergeLoadedConfig({
      trackers: {
        redacted: { apiKey: 'red-key', passkey: 'old-red-passkey' },
        orpheus: { apiKey: 'ops-key', passkey: 'old-ops-passkey' }
      }
    })

    expect(cfg.trackers.redacted.apiKey).toBe('red-key')
    expect(cfg.trackers.orpheus.apiKey).toBe('ops-key')
    expect(cfg.trackers.redacted).not.toHaveProperty('passkey')
    expect(cfg.trackers.orpheus).not.toHaveProperty('passkey')
  })

  it('loads legacy torrentClients into torrentClient shape', () => {
    const cfg = mergeLoadedConfig({
      torrentClients: {
        enabled: true,
        apiURL: 'http://127.0.0.1:8080',
        username: 'admin',
        password: 'secret',
        startPaused: true
      }
    })
    expect(cfg.torrentClient.enabled).toBe(true)
    expect(cfg.torrentClient.url).toBe('http://127.0.0.1:8080')
    expect(cfg.torrentClient.username).toBe('admin')
    expect(cfg.torrentClient.password).toBe('secret')
    expect(cfg.torrentClient.startPaused).toBe(true)
    expect(cfg).not.toHaveProperty('torrentClients')
  })

  it('clears spectral image hosts that do not support spectral upload', () => {
    const cfg = mergeLoadedConfig({
      spectral: { imageHost: 'thesungod' }
    })
    expect(cfg.spectral.imageHost).toBe('')
  })

  it('rejects thesungod as spectral image host even when enabled', () => {
    let cfg = defaultConfig()
    cfg = {
      ...cfg,
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: true, apiKey: 'key' },
        catbox: { enabled: false },
        redacted: { enabled: false }
      },
      spectral: { ...cfg.spectral, imageHost: 'thesungod' }
    }
    const issues = validate(cfg)
    expect(issues.some((i) => i.section === 'spectral' && i.field === 'imageHost')).toBe(true)
  })

  it('accepts catbox as a spectral image host when enabled', () => {
    const cfg = defaultConfig()
    cfg.imageHosts.catbox.enabled = true
    cfg.spectral.imageHost = 'catbox'
    const issues = validate(cfg)
    expect(issues.some((i) => i.section === 'spectral' && i.field === 'imageHost')).toBe(false)
  })

  it('rejects redacted image host when redacted tracker is not configured', () => {
    let cfg = defaultConfig()
    cfg = {
      ...cfg,
      imageHosts: { ...cfg.imageHosts, redacted: { enabled: true } }
    }
    const issues = validate(cfg)
    expect(issues.some((i) => i.section === 'imageHosts' && i.field === 'redacted.enabled')).toBe(
      true
    )
  })

  it('accepts redacted image host when redacted tracker is configured', () => {
    let cfg = defaultConfig()
    cfg = {
      ...cfg,
      trackers: {
        ...cfg.trackers,
        redacted: {
          ...cfg.trackers.redacted,
          enabled: true,
          siteUrl: 'https://redacted.example',
          announceUrl: 'https://flacsfor.me',
          apiKey: 'key'
        }
      },
      imageHosts: { ...cfg.imageHosts, redacted: { enabled: true } }
    }
    const issues = validate(cfg)
    expect(issues.some((i) => i.section === 'imageHosts' && i.field === 'redacted.enabled')).toBe(
      false
    )
  })

  it('rejects redacted image host when the tracker only has a session cookie', () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted = {
      ...cfg.trackers.redacted,
      enabled: true,
      siteUrl: 'https://redacted.example',
      announceUrl: 'https://flacsfor.me',
      sessionCookie: 'cookie'
    }
    cfg.imageHosts.redacted.enabled = true

    const issues = validate(cfg)
    expect(
      issues.some((issue) => issue.section === 'imageHosts' && issue.field === 'redacted.enabled')
    ).toBe(true)
  })

  it('rejects redacted cover image host for orpheus', () => {
    let cfg = defaultConfig()
    cfg = {
      ...cfg,
      trackers: {
        ...cfg.trackers,
        redacted: {
          ...cfg.trackers.redacted,
          enabled: true,
          siteUrl: 'https://redacted.example',
          announceUrl: 'https://flacsfor.me',
          apiKey: 'key'
        },
        orpheus: {
          ...cfg.trackers.orpheus,
          enabled: true,
          siteUrl: 'https://orpheus.example',
          announceUrl: 'https://home.opsfet.ch',
          apiKey: 'key',
          coverImageHost: 'redacted'
        }
      },
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: false, apiKey: '' },
        catbox: { enabled: false },
        redacted: { enabled: true }
      }
    }
    const issues = validate(cfg)
    expect(
      issues.some((i) => i.section === 'trackers' && i.field === 'orpheus.coverImageHost')
    ).toBe(true)
  })

  it('accepts redacted cover image host for redacted tracker', () => {
    let cfg = defaultConfig()
    cfg = {
      ...cfg,
      trackers: {
        ...cfg.trackers,
        redacted: {
          ...cfg.trackers.redacted,
          enabled: true,
          siteUrl: 'https://redacted.example',
          announceUrl: 'https://flacsfor.me',
          apiKey: 'key',
          coverImageHost: 'redacted'
        }
      },
      imageHosts: {
        thesungod: { enabled: false, apiKey: '' },
        imgbb: { enabled: false, apiKey: '' },
        catbox: { enabled: false },
        redacted: { enabled: true }
      }
    }
    const issues = validate(cfg)
    expect(
      issues.some((i) => i.section === 'trackers' && i.field === 'redacted.coverImageHost')
    ).toBe(false)
  })

  it('clears invalid cover image hosts when loading config', () => {
    const cfg = mergeLoadedConfig({
      trackers: {
        orpheus: { coverImageHost: 'redacted' }
      },
      imageHosts: {
        thesungod: { enabled: true, apiKey: 'key' },
        imgbb: { enabled: false, apiKey: '' },
        catbox: { enabled: false },
        redacted: { enabled: true }
      }
    })
    expect(cfg.trackers.orpheus.coverImageHost).toBe('')
  })
})
