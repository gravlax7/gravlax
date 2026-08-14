import { describe, expect, it } from 'vitest'
import { parseIpcArguments } from '../ipc'

describe('IPC argument contract', () => {
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

  it('accepts an update check without renderer-supplied input', () => {
    expect(parseIpcArguments('updates:check', [])).toEqual([])
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
})

function configInput() {
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
    tools: { sox: '', flac: '', metaflac: '', mp3val: '', lame: '' },
    trackers: { redacted: { ...tracker }, orpheus: { ...tracker } },
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
      releaseFolderTemplate: '{title}',
      trackFileTemplate: '{title}',
      multiDiscFolderTemplate: '{discNumber}'
    },
    spectral: {
      imageHost: '',
      defaultSpectralIds: 'Random',
      defaultSpectralIdsForLossyMasters: 'All'
    },
    cleanup: { deleteTemporaryFiles: true, deleteSpectralsAfterUpload: false },
    workflow: { confirmBeforeWrites: true, useUpcAsCatNo: true }
  }
}
