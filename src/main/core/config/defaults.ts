import type { Config, SectionID } from '@shared/types/config'

export function defaultConfig(): Config {
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
      catbox: { enabled: true },
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
      releaseFolderTemplate: '{artists} - {title} ({year}) [{source} {format}]',
      trackFileTemplate: '{trackNumber}. {title}',
      multiDiscFolderTemplate: 'CD {discNumber}'
    },
    spectral: {
      imageHost: '',
      defaultSpectralIds: 'Random',
      defaultSpectralIdsForLossyMasters: 'All'
    },
    cleanup: {
      archiveDirectory: '',
      deleteOriginalFolder: false,
      deleteTemporaryFiles: false,
      deleteSpectralsAfterUpload: false
    },
    workflow: {
      confirmBeforeWrites: true,
      useUpcAsCatNo: true,
      autoRepairFlacIntegrity: false
    }
  }
}

export function resetSection(cfg: Config, section: SectionID): Config {
  const def = defaultConfig()
  const next = structuredClone(cfg)
  switch (section) {
    case 'appearance':
      next.appearance = def.appearance
      break
    case 'directories':
      next.directories = def.directories
      break
    case 'tools':
      next.tools = def.tools
      break
    case 'trackers':
      next.trackers = def.trackers
      break
    case 'metadataProviders':
      next.metadataProviders = def.metadataProviders
      break
    case 'imageHosts':
      next.imageHosts = def.imageHosts
      break
    case 'torrentClient':
      next.torrentClient = def.torrentClient
      break
    case 'transfer':
      next.transfer = def.transfer
      break
    case 'naming':
      next.naming = def.naming
      break
    case 'spectral':
      next.spectral = def.spectral
      break
    case 'cleanup':
      next.cleanup = def.cleanup
      break
    case 'workflow':
      next.workflow = def.workflow
      break
  }
  return next
}
