import path from 'node:path'
import type { Config, SectionID, ValidationIssue } from '@shared/types/config'
import {
  enabledSpectralImageHostOptions,
  isValidCoverImageHost
} from '@shared/config/imageHosts'
import { canEnableRedactedImageHost } from '@shared/config/trackers'
import { listDescriptionTemplateIds } from '@shared/upload/templates'
import { validateMultiDiscFolderTemplate, validateReleaseFolderTemplate, validateTrackFileTemplate } from '@shared/upload/naming'
import { expandPath, normalizePath } from './paths'

export function validate(cfg: Config): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (section: SectionID, field: string, message: string): void => {
    issues.push({ section, field, message })
  }

  if (!oneOf(cfg.appearance.theme, 'system', 'dark', 'light')) {
    add('appearance', 'theme', 'theme must be system, dark, or light')
  }

  validateTracker(cfg.trackers.redacted, 'redacted', 'Redacted', add)
  validateTracker(cfg.trackers.orpheus, 'orpheus', 'Orpheus', add)
  if (!isValidCoverImageHost(cfg, 'redacted', cfg.trackers.redacted.coverImageHost)) {
    add(
      'trackers',
      'redacted.coverImageHost',
      'cover image host must be one of the enabled image hosts'
    )
  }
  if (!isValidCoverImageHost(cfg, 'orpheus', cfg.trackers.orpheus.coverImageHost)) {
    add(
      'trackers',
      'orpheus.coverImageHost',
      cfg.trackers.orpheus.coverImageHost === 'redacted'
        ? 'Redacted image host can only be selected for the Redacted tracker'
        : 'cover image host must be one of the enabled image hosts'
    )
  }
  for (const [field, value] of Object.entries({
    source: cfg.directories.source,
    torrents: cfg.directories.torrents
  })) {
    if (value !== '' && !validCleanPath(value)) {
      add('directories', field, 'directory path must be clean')
    }
  }

  if (cfg.metadataProviders.requestTimeoutSeconds <= 0) {
    add('metadataProviders', 'requestTimeoutSeconds', 'request timeout must be positive')
  }

  if (cfg.imageHosts.thesungod.enabled && cfg.imageHosts.thesungod.apiKey === '') {
    add('imageHosts', 'thesungod.apiKey', 'thesungod API key is required when thesungod is enabled')
  }
  if (cfg.imageHosts.imgbb.enabled && cfg.imageHosts.imgbb.apiKey === '') {
    add('imageHosts', 'imgbb.apiKey', 'imgbb API key is required when imgbb is enabled')
  }
  if (cfg.imageHosts.redacted.enabled && !canEnableRedactedImageHost(cfg)) {
    add(
      'imageHosts',
      'redacted.enabled',
      'Redacted Image Host requires an enabled Redacted tracker with an API key'
    )
  }

  if (cfg.torrentClient.enabled && cfg.torrentClient.url === '') {
    add('torrentClient', 'url', 'WebUI URL is required when torrent client is enabled')
  }
  if (cfg.torrentClient.url !== '' && !validHTTPURL(cfg.torrentClient.url)) {
    add('torrentClient', 'url', 'WebUI URL must be an http or https URL')
  }
  if (cfg.torrentClient.enabled) {
    if (cfg.torrentClient.useAutoTMM) {
      // Without a category ATM falls back to qBittorrent's global default save
      // path, which silently puts the torrent somewhere the release is not.
      if (cfg.torrentClient.category === '') {
        add(
          'torrentClient',
          'category',
          'category is required when automatic torrent management is on, otherwise qBittorrent uses its default save path'
        )
      }
    } else if (cfg.torrentClient.savePath === '' && !cfg.transfer.enabled) {
      // With a seedbox the save path may be left empty to reuse remotePath.
      add(
        'torrentClient',
        'savePath',
        'save path is required when automatic torrent management is off and no seedbox is configured'
      )
    }
  }
  if (cfg.torrentClient.savePath !== '' && !validCleanPath(cfg.torrentClient.savePath)) {
    add('torrentClient', 'savePath', 'save path must be a clean path')
  }

  if (cfg.transfer.enabled) {
    if (cfg.transfer.host === '') {
      add('transfer', 'host', 'SFTP host is required when seedbox is enabled')
    }
    if (cfg.transfer.port <= 0 || cfg.transfer.port > 65535) {
      add('transfer', 'port', 'SFTP port must be between 1 and 65535')
    }
    if (cfg.transfer.username === '') {
      add('transfer', 'username', 'username is required when seedbox is enabled')
    }
    if (cfg.transfer.password === '' && cfg.transfer.privateKeyPath === '') {
      add('transfer', 'password', 'password or private key path is required when seedbox is enabled')
    }
    if (cfg.transfer.remotePath === '') {
      add('transfer', 'remotePath', 'remote path is required when seedbox is enabled')
    }
  }
  for (const [field, value] of Object.entries({
    privateKeyPath: cfg.transfer.privateKeyPath,
    remotePath: cfg.transfer.remotePath
  })) {
    if (value !== '' && !validCleanPath(value)) {
      add('transfer', field, 'path value must be clean')
    }
  }

  if (!oneOf(cfg.naming.albumDescriptionTemplateId, ...listDescriptionTemplateIds())) {
    add('naming', 'albumDescriptionTemplateId', 'album description template must be a known template')
  }
  if (cfg.naming.releaseFolderTemplate === '') {
    add('naming', 'releaseFolderTemplate', 'release folder template is required')
  }
  if (cfg.naming.trackFileTemplate === '') {
    add('naming', 'trackFileTemplate', 'track file template is required')
  }
  if (cfg.naming.multiDiscFolderTemplate === '') {
    add('naming', 'multiDiscFolderTemplate', 'multi-disc folder template is required')
  }
  for (const message of validateReleaseFolderTemplate(cfg.naming.releaseFolderTemplate)) {
    add('naming', 'releaseFolderTemplate', message)
  }
  for (const message of validateTrackFileTemplate(cfg.naming.trackFileTemplate)) {
    add('naming', 'trackFileTemplate', message)
  }
  for (const message of validateMultiDiscFolderTemplate(cfg.naming.multiDiscFolderTemplate)) {
    add('naming', 'multiDiscFolderTemplate', message)
  }

  if (
    cfg.spectral.imageHost !== '' &&
    !oneOf(cfg.spectral.imageHost, ...enabledSpectralImageHostOptions(cfg))
  ) {
    add('spectral', 'imageHost', 'image host must be one of the enabled spectral image hosts')
  }
  if (!oneOf(cfg.spectral.defaultSpectralIds, 'All', 'Random', 'First track', 'None')) {
    add('spectral', 'defaultSpectralIds', 'default spectral ids must be All, Random, First track, or None')
  }
  if (!oneOf(cfg.spectral.defaultSpectralIdsForLossyMasters, 'All', 'Random', 'First track', 'None')) {
    add(
      'spectral',
      'defaultSpectralIdsForLossy',
      'default spectral ids for lossy masters must be All, Random, First track, or None'
    )
  }

  return issues
}

function validHTTPURL(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host !== ''
  } catch {
    return false
  }
}

function validCleanPath(pathValue: string): boolean {
  const normalized = normalizePath(pathValue)
  const { path: expanded, ok } = expandPath(normalized)
  if (!ok || expanded === '') return false
  return path.normalize(expanded) === expanded
}

function oneOf(value: string, ...options: string[]): boolean {
  return options.includes(value)
}

function normalizeTrackerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function validateTracker(
  tracker: Config['trackers']['redacted'],
  prefix: 'redacted' | 'orpheus',
  label: string,
  add: (section: SectionID, field: string, message: string) => void
): void {
  if (!tracker.enabled) return

  const siteUrl = normalizeTrackerUrl(tracker.siteUrl)
  if (siteUrl === '') {
    add('trackers', `${prefix}.siteUrl`, `${label} site URL is required when ${label} is enabled`)
  } else if (!validHTTPURL(siteUrl)) {
    add('trackers', `${prefix}.siteUrl`, `${label} site URL must be a valid http(s) URL`)
  }

  const announceUrl = normalizeTrackerUrl(tracker.announceUrl)
  if (announceUrl === '') {
    add(
      'trackers',
      `${prefix}.announceUrl`,
      `${label} announce URL is required when ${label} is enabled`
    )
  } else if (!validHTTPURL(announceUrl)) {
    add('trackers', `${prefix}.announceUrl`, `${label} announce URL must be a valid http(s) URL`)
  }

  if (tracker.apiKey === '' && tracker.sessionCookie === '') {
    add(
      'trackers',
      `${prefix}.apiKey`,
      `${label} API key or session cookie is required when ${label} is enabled`
    )
  }
}
