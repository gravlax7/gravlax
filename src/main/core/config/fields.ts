import type { Config, FieldMetadata, SectionID } from '@shared/types/config'
import {
  coverImageHostOptions,
  enabledImageHostOptions,
  enabledSpectralImageHostOptions,
  sanitizeCoverImageHosts
} from '@shared/config/imageHosts'
import { canEnableRedactedImageHost } from '@shared/config/trackers'
import { normalizePath } from './paths'

export {
  coverImageHostOptions,
  enabledImageHostOptions,
  enabledSpectralImageHostOptions
}

export function fieldValue(cfg: Config, section: SectionID, field: string): string {
  switch (section) {
    case 'appearance': {
      const c = cfg.appearance
      switch (field) {
        case 'theme':
          return c.theme
      }
      break
    }
    case 'directories': {
      const c = cfg.directories
      switch (field) {
        case 'source':
          return c.source
        case 'torrents':
          return c.torrents
        case 'seeding':
          return c.seeding
      }
      break
    }
    case 'trackers': {
      const c = cfg.trackers
      switch (field) {
        case 'redacted.enabled':
          return String(c.redacted.enabled)
        case 'redacted.siteUrl':
          return c.redacted.siteUrl
        case 'redacted.announceUrl':
          return c.redacted.announceUrl
        case 'redacted.apiKey':
          return c.redacted.apiKey
        case 'redacted.sessionCookie':
          return c.redacted.sessionCookie
        case 'redacted.coverImageHost':
          return c.redacted.coverImageHost
        case 'orpheus.enabled':
          return String(c.orpheus.enabled)
        case 'orpheus.siteUrl':
          return c.orpheus.siteUrl
        case 'orpheus.announceUrl':
          return c.orpheus.announceUrl
        case 'orpheus.apiKey':
          return c.orpheus.apiKey
        case 'orpheus.sessionCookie':
          return c.orpheus.sessionCookie
        case 'orpheus.coverImageHost':
          return c.orpheus.coverImageHost
      }
      break
    }
    case 'metadataProviders': {
      const c = cfg.metadataProviders
      switch (field) {
        case 'musicBrainz.enabled':
          return String(c.musicBrainz.enabled)
        case 'deezer.enabled':
          return String(c.deezer.enabled)
        case 'requestTimeoutSeconds':
          return String(c.requestTimeoutSeconds)
      }
      break
    }
    case 'imageHosts': {
      const c = cfg.imageHosts
      switch (field) {
        case 'thesungod.enabled':
          return String(c.thesungod.enabled)
        case 'thesungod.apiKey':
          return c.thesungod.apiKey
        case 'imgbb.enabled':
          return String(c.imgbb.enabled)
        case 'imgbb.apiKey':
          return c.imgbb.apiKey
        case 'redacted.enabled':
          return String(c.redacted.enabled)
      }
      break
    }
    case 'torrentClient': {
      const c = cfg.torrentClient
      switch (field) {
        case 'enabled':
          return String(c.enabled)
        case 'url':
          return c.url
        case 'username':
          return c.username
        case 'password':
          return c.password
        case 'category':
          return c.category
        case 'useAutoTMM':
          return String(c.useAutoTMM)
        case 'savePath':
          return c.savePath
        case 'startPaused':
          return String(c.startPaused)
      }
      break
    }
    case 'transfer': {
      const c = cfg.transfer
      switch (field) {
        case 'enabled':
          return String(c.enabled)
        case 'host':
          return c.host
        case 'port':
          return String(c.port)
        case 'username':
          return c.username
        case 'password':
          return c.password
        case 'privateKeyPath':
          return c.privateKeyPath
        case 'hostFingerprint':
          return c.hostFingerprint
        case 'remotePath':
          return c.remotePath
      }
      break
    }
    case 'naming': {
      const c = cfg.naming
      switch (field) {
        case 'albumDescriptionTemplateId':
          return c.albumDescriptionTemplateId
        case 'releaseFolderTemplate':
          return c.releaseFolderTemplate
        case 'trackFileTemplate':
          return c.trackFileTemplate
        case 'multiDiscFolderTemplate':
          return c.multiDiscFolderTemplate
      }
      break
    }
    case 'spectral': {
      const c = cfg.spectral
      switch (field) {
        case 'imageHost':
          return c.imageHost
        case 'defaultSpectralIds':
          return c.defaultSpectralIds
        case 'defaultSpectralIdsForLossy':
          return c.defaultSpectralIdsForLossyMasters
        case 'compress':
          return String(c.compress)
      }
      break
    }
    case 'cleanup': {
      const c = cfg.cleanup
      switch (field) {
        case 'deleteTemporaryFiles':
          return String(c.deleteTemporaryFiles)
        case 'deleteSpectralsAfterUpload':
          return String(c.deleteSpectralsAfterUpload)
      }
      break
    }
    case 'workflow': {
      const c = cfg.workflow
      switch (field) {
        case 'confirmBeforeWrites':
          return String(c.confirmBeforeWrites)
        case 'useUpcAsCatNo':
          return String(c.useUpcAsCatNo)
      }
      break
    }
  }
  return ''
}

export function fieldBoolValue(cfg: Config, section: SectionID, field: string): boolean {
  return fieldValue(cfg, section, field) === 'true'
}

export function setFieldString(cfg: Config, section: SectionID, field: string, value: string): Config {
  const next = structuredClone(cfg)
  value = normalizeFieldString(section, field, value)
  switch (section) {
    case 'appearance':
      if (field === 'theme') next.appearance.theme = value as Config['appearance']['theme']
      break
    case 'directories':
      if (field === 'source') next.directories.source = value
      if (field === 'torrents') next.directories.torrents = value
      if (field === 'seeding') next.directories.seeding = value
      break
    case 'trackers':
      if (field === 'redacted.siteUrl') next.trackers.redacted.siteUrl = value
      if (field === 'redacted.announceUrl') next.trackers.redacted.announceUrl = value
      if (field === 'redacted.apiKey') next.trackers.redacted.apiKey = value
      if (field === 'redacted.sessionCookie') next.trackers.redacted.sessionCookie = value
      if (field === 'redacted.coverImageHost') next.trackers.redacted.coverImageHost = value
      if (field === 'orpheus.siteUrl') next.trackers.orpheus.siteUrl = value
      if (field === 'orpheus.announceUrl') next.trackers.orpheus.announceUrl = value
      if (field === 'orpheus.apiKey') next.trackers.orpheus.apiKey = value
      if (field === 'orpheus.sessionCookie') next.trackers.orpheus.sessionCookie = value
      if (field === 'orpheus.coverImageHost') next.trackers.orpheus.coverImageHost = value
      if (!canEnableRedactedImageHost(next)) next.imageHosts.redacted.enabled = false
      sanitizeCoverImageHosts(next)
      break
    case 'imageHosts':
      if (field === 'thesungod.apiKey') next.imageHosts.thesungod.apiKey = value
      if (field === 'imgbb.apiKey') next.imageHosts.imgbb.apiKey = value
      sanitizeCoverImageHosts(next)
      break
    case 'torrentClient':
      if (field === 'url') next.torrentClient.url = value
      if (field === 'username') next.torrentClient.username = value
      if (field === 'password') next.torrentClient.password = value
      if (field === 'category') next.torrentClient.category = value
      if (field === 'savePath') next.torrentClient.savePath = value
      break
    case 'transfer':
      if (field === 'host') next.transfer.host = value
      if (field === 'username') next.transfer.username = value
      if (field === 'password') next.transfer.password = value
      if (field === 'privateKeyPath') next.transfer.privateKeyPath = value
      if (field === 'hostFingerprint') next.transfer.hostFingerprint = value.trim()
      if (field === 'remotePath') next.transfer.remotePath = value
      break
    case 'naming':
      if (field === 'albumDescriptionTemplateId') next.naming.albumDescriptionTemplateId = value
      if (field === 'releaseFolderTemplate') next.naming.releaseFolderTemplate = value
      if (field === 'trackFileTemplate') next.naming.trackFileTemplate = value
      if (field === 'multiDiscFolderTemplate') next.naming.multiDiscFolderTemplate = value
      break
    case 'spectral':
      if (field === 'imageHost') next.spectral.imageHost = value
      if (field === 'defaultSpectralIds') next.spectral.defaultSpectralIds = value
      if (field === 'defaultSpectralIdsForLossy') next.spectral.defaultSpectralIdsForLossyMasters = value
      break
  }
  return next
}

function normalizeFieldString(section: SectionID, field: string, value: string): string {
  if (isPathField(section, field)) {
    return normalizePath(value)
  }
  return value
}

function isPathField(section: SectionID, field: string): boolean {
  switch (section) {
    case 'directories':
      return field === 'source' || field === 'torrents' || field === 'seeding'
    // torrentClient.savePath is deliberately absent: it is a path on whichever
    // machine runs qBittorrent, so local normalization (and the local folder
    // picker) would be wrong whenever a seedbox is in use.
    case 'transfer':
      return field === 'privateKeyPath'
    default:
      return false
  }
}

export function setFieldBool(cfg: Config, section: SectionID, field: string, value: boolean): Config {
  const next = structuredClone(cfg)
  switch (section) {
    case 'trackers':
      if (field === 'redacted.enabled') next.trackers.redacted.enabled = value
      if (field === 'orpheus.enabled') next.trackers.orpheus.enabled = value
      if (!canEnableRedactedImageHost(next)) next.imageHosts.redacted.enabled = false
      sanitizeCoverImageHosts(next)
      break
    case 'metadataProviders':
      if (field === 'musicBrainz.enabled') next.metadataProviders.musicBrainz.enabled = value
      if (field === 'deezer.enabled') next.metadataProviders.deezer.enabled = value
      break
    case 'imageHosts':
      if (field === 'thesungod.enabled') next.imageHosts.thesungod.enabled = value
      if (field === 'imgbb.enabled') next.imageHosts.imgbb.enabled = value
      if (field === 'redacted.enabled') {
        next.imageHosts.redacted.enabled = value && canEnableRedactedImageHost(next)
      }
      sanitizeCoverImageHosts(next)
      break
    case 'torrentClient':
      if (field === 'enabled') next.torrentClient.enabled = value
      if (field === 'useAutoTMM') next.torrentClient.useAutoTMM = value
      if (field === 'startPaused') next.torrentClient.startPaused = value
      break
    case 'transfer':
      if (field === 'enabled') next.transfer.enabled = value
      break
    case 'spectral':
      if (field === 'compress') next.spectral.compress = value
      break
    case 'cleanup':
      if (field === 'deleteTemporaryFiles') next.cleanup.deleteTemporaryFiles = value
      if (field === 'deleteSpectralsAfterUpload') next.cleanup.deleteSpectralsAfterUpload = value
      break
    case 'workflow':
      if (field === 'confirmBeforeWrites') next.workflow.confirmBeforeWrites = value
      if (field === 'useUpcAsCatNo') next.workflow.useUpcAsCatNo = value
      break
  }
  return next
}

export function setFieldInt(cfg: Config, section: SectionID, field: string, value: number): Config {
  const next = structuredClone(cfg)
  switch (section) {
    case 'metadataProviders':
      if (field === 'requestTimeoutSeconds') next.metadataProviders.requestTimeoutSeconds = value
      break
    case 'transfer':
      if (field === 'port') next.transfer.port = value
      break
  }
  return next
}

export function cycleFieldEnum(cfg: Config, section: SectionID, field: FieldMetadata): Config {
  const next = structuredClone(cfg)
  if (section === 'spectral' && field.name === 'imageHost') {
    const options = enabledSpectralImageHostOptions(next)
    if (options.length === 0) {
      next.spectral.imageHost = ''
      return next
    }
    next.spectral.imageHost = cycleOption(next.spectral.imageHost, options)
    return next
  }
  if (section === 'trackers' && field.name === 'redacted.coverImageHost') {
    const options = coverImageHostOptions(next, 'redacted')
    if (options.length === 0) {
      next.trackers.redacted.coverImageHost = ''
      return next
    }
    next.trackers.redacted.coverImageHost = cycleOption(next.trackers.redacted.coverImageHost, options)
    return next
  }
  if (section === 'trackers' && field.name === 'orpheus.coverImageHost') {
    const options = coverImageHostOptions(next, 'orpheus')
    if (options.length === 0) {
      next.trackers.orpheus.coverImageHost = ''
      return next
    }
    next.trackers.orpheus.coverImageHost = cycleOption(next.trackers.orpheus.coverImageHost, options)
    return next
  }
  if (!field.options || field.options.length === 0) {
    return next
  }
  const current = fieldValue(next, section, field.name)
  let nextValue = field.options[0]!
  for (let i = 0; i < field.options.length; i++) {
    if (field.options[i] === current) {
      nextValue = field.options[(i + 1) % field.options.length]!
      break
    }
  }
  switch (section) {
    case 'appearance':
      if (field.name === 'theme') next.appearance.theme = nextValue as Config['appearance']['theme']
      break
    case 'spectral':
      if (field.name === 'defaultSpectralIds') next.spectral.defaultSpectralIds = nextValue
      if (field.name === 'defaultSpectralIdsForLossy') next.spectral.defaultSpectralIdsForLossyMasters = nextValue
      break
  }
  return next
}

function cycleOption(current: string, options: string[]): string {
  if (options.length === 0) return ''
  for (let i = 0; i < options.length; i++) {
    if (options[i] === current) {
      return options[(i + 1) % options.length]!
    }
  }
  return options[0]!
}
