import { describe, expect, it } from 'vitest'
import { CONFIG_SECTION_IDS, type Config } from '../types/config'
import { parseIpcArguments } from '../ipc'
import { THEME_PREFERENCES } from '../theme'
import { UPLOAD_TRACKER_IDS } from '../trackers'
import { SOURCE_MEDIA_OPTIONS } from '../upload/sourceMedia'

describe('IPC argument contract', () => {
  it('accepts every value from the shared domain catalogs', () => {
    for (const trackerId of UPLOAD_TRACKER_IDS) {
      expect(parseIpcArguments('upload:fetchTorrentGroup', [trackerId, 1])).toEqual([
        trackerId,
        1
      ])
    }
    for (const media of SOURCE_MEDIA_OPTIONS) {
      expect(parseIpcArguments('upload:selectSourceMedia', [media])).toEqual([media])
    }
    for (const section of CONFIG_SECTION_IDS) {
      expect(parseIpcArguments('config:resetSection', [section])).toEqual([section])
    }
    for (const theme of THEME_PREFERENCES) {
      const cfg = configInput()
      cfg.appearance.theme = theme
      expect(parseIpcArguments('config:save', [cfg])).toEqual([cfg])
    }
  })

  it('rejects values outside shared domain catalogs', () => {
    expect(() => parseIpcArguments('upload:selectSourceMedia', ['Vinyl'])).toThrow()
    expect(() => parseIpcArguments('config:resetSection', ['other'])).toThrow()
    const cfg = configInput()
    ;(cfg.appearance as { theme: string }).theme = 'other'
    expect(() => parseIpcArguments('config:save', [cfg])).toThrow()
  })

  it('accepts a valid workflow transition index', () => {
    expect(parseIpcArguments('upload:setCurrentStep', [4])).toEqual([4])
  })

  it('rejects unknown workflow transition indexes', () => {
    expect(() => parseIpcArguments('upload:setCurrentStep', [99])).toThrow()
  })

  it('rejects malformed tracker commands before they reach a service', () => {
    expect(() => parseIpcArguments('upload:fetchTorrentGroup', ['other', 1])).toThrow()
    expect(() => parseIpcArguments('upload:fetchTorrentGroup', ['redacted', 0])).toThrow()
  })

  it('allows an omitted optional argument', () => {
    expect(parseIpcArguments('upload:searchTrackerGroups', [])).toEqual([])
  })

  it('accepts BBCode preview text, including an empty description', () => {
    expect(parseIpcArguments('upload:previewBbcode', ['[b]Album[/b]'])).toEqual([
      '[b]Album[/b]'
    ])
    expect(parseIpcArguments('upload:previewBbcode', [''])).toEqual([''])
    expect(() => parseIpcArguments('upload:previewBbcode', [42])).toThrow()
  })

  it('accepts an update check without renderer-supplied input', () => {
    expect(parseIpcArguments('updates:check', [])).toEqual([])
  })

  it('accepts safe diagnostic commands and known health check sources', () => {
    expect(parseIpcArguments('diagnostics:report', [])).toEqual([])
    expect(parseIpcArguments('diagnostics:revealLogs', [])).toEqual([])
    expect(parseIpcArguments('health:refresh', ['settings-save'])).toEqual(['settings-save'])
    expect(() => parseIpcArguments('health:refresh', ['other'])).toThrow()
  })

  it('accepts torrent save commands and rejects an empty submission id', () => {
    expect(parseIpcArguments('upload:saveTorrent', ['redacted:flac'])).toEqual([
      'redacted:flac'
    ])
    expect(parseIpcArguments('upload:saveTorrents', [])).toEqual([])
    expect(() => parseIpcArguments('upload:saveTorrent', [''])).toThrow()
  })

  it('accepts FLAC integrity repair without renderer input', () => {
    expect(parseIpcArguments('upload:repairFlacIntegrity', [])).toEqual([])
  })

  it('checks the track-rename upload toggle', () => {
    expect(parseIpcArguments('upload:setRenameTrackFiles', [false])).toEqual([false])
    expect(() => parseIpcArguments('upload:setRenameTrackFiles', ['false'])).toThrow()
  })

  it('accepts clipboard text and rejects an empty value', () => {
    expect(parseIpcArguments('clipboard:writeText', ['/downloads/music'])).toEqual([
      '/downloads/music'
    ])
    expect(() => parseIpcArguments('clipboard:writeText', [''])).toThrow()
  })

  it('accepts a metadata URL and rejects an empty one', () => {
    expect(parseIpcArguments('upload:resolveMetadataUrl', ['https://example.test/release'])).toEqual([
      'https://example.test/release'
    ])
    expect(() => parseIpcArguments('upload:resolveMetadataUrl', [''])).toThrow()
  })

  it('accepts tool paths in config and the tools reset section', () => {
    const cfg = configInput()
    cfg.tools.sox = '/opt/homebrew/bin/sox'
    expect(parseIpcArguments('config:save', [cfg])).toEqual([cfg])
    expect(parseIpcArguments('config:resetSection', ['tools'])).toEqual(['tools'])
  })

  it('validates qBittorrent API key settings before saving', () => {
    const cfg = configInput()
    cfg.torrentClient.useApiKey = true
    cfg.torrentClient.apiKey = 'qbt_api_key'
    expect(parseIpcArguments('config:save', [cfg])).toEqual([cfg])

    ;(cfg.torrentClient as { useApiKey: unknown }).useApiKey = 'yes'
    expect(() => parseIpcArguments('config:save', [cfg])).toThrow()
  })
})

function configInput(): Config {
  const tracker = {
    enabled: false,
    siteUrl: '',
    announceUrl: '',
    apiKey: '',
    sessionCookie: '',
    coverImageHost: ''
  }
  return {
    appearance: { theme: 'system' as const },
    directories: { source: '', torrents: '', seeding: '' },
    tools: { sox: '', flac: '', metaflac: '', lame: '' },
    trackers: { redacted: { ...tracker }, orpheus: { ...tracker } },
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
      releaseFolderTemplate: '{title}',
      trackFileTemplate: '{title}',
      multiDiscFolderTemplate: '{discNumber}'
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
    workflow: { confirmBeforeWrites: true, useUpcAsCatNo: true, autoRepairFlacIntegrity: false, keepExistingTagsByDefault: false }
  }
}
