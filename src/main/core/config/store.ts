import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sanitizeCoverImageHosts, supportsSpectralUpload } from '@shared/config/imageHosts'
import { isThemePreference } from '@shared/theme'
import type { Config } from '@shared/types/config'
import { defaultConfig } from './defaults'
import { normalizePath } from './paths'

export function normalizeMetadataProviders(raw: unknown, base: Config['metadataProviders']): Config['metadataProviders'] {
  if (!raw || typeof raw !== 'object') {
    return base
  }
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)

  if (typeof obj.musicBrainzEnabled === 'boolean') {
    next.musicBrainz.enabled = obj.musicBrainzEnabled
  }

  if (obj.musicBrainz && typeof obj.musicBrainz === 'object') {
    next.musicBrainz = { ...next.musicBrainz, ...(obj.musicBrainz as object) }
  }
  if (obj.deezer && typeof obj.deezer === 'object') {
    next.deezer = { ...next.deezer, ...(obj.deezer as object) }
  }
  if (obj.bandcamp && typeof obj.bandcamp === 'object') {
    next.bandcamp = { ...next.bandcamp, ...(obj.bandcamp as object) }
  }
  if (typeof obj.requestTimeoutSeconds === 'number') {
    next.requestTimeoutSeconds = obj.requestTimeoutSeconds
  }

  return next
}

export function normalizeTrackers(raw: unknown, base: Config['trackers']): Config['trackers'] {
  if (!raw || typeof raw !== 'object') {
    return base
  }
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)

  if (obj.redacted && typeof obj.redacted === 'object') {
    const redacted = { ...(obj.redacted as Record<string, unknown>) }
    delete redacted.passkey
    next.redacted = { ...next.redacted, ...redacted }
  }
  if (obj.orpheus && typeof obj.orpheus === 'object') {
    const orpheus = { ...(obj.orpheus as Record<string, unknown>) }
    delete orpheus.passkey
    next.orpheus = { ...next.orpheus, ...orpheus }
  }

  const hasLegacy =
    typeof obj.enabled === 'boolean' ||
    typeof obj.defaultTracker === 'string' ||
    typeof obj.apiKey === 'string' ||
    typeof obj.sessionCookie === 'string'

  if (hasLegacy && !obj.redacted && !obj.orpheus) {
    const creds = {
      apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : '',
      sessionCookie: typeof obj.sessionCookie === 'string' ? obj.sessionCookie : ''
    }
    const enabled = obj.enabled === true
    const defaultTracker =
      typeof obj.defaultTracker === 'string' ? obj.defaultTracker.trim().toLowerCase() : ''

    if (defaultTracker === 'ops' || defaultTracker === 'orpheus') {
      next.orpheus = { ...next.orpheus, enabled, ...creds }
    } else if (defaultTracker === 'red' || defaultTracker === 'redacted' || enabled) {
      next.redacted = { ...next.redacted, enabled, ...creds }
    } else {
      next.redacted = { ...next.redacted, enabled: false, ...creds }
    }
  }

  return next
}

export function normalizeTorrentClient(raw: unknown, base: Config['torrentClient']): Config['torrentClient'] {
  if (!raw || typeof raw !== 'object') {
    return base
  }
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)
  if (typeof obj.enabled === 'boolean') next.enabled = obj.enabled
  if (typeof obj.url === 'string') next.url = obj.url
  else if (typeof obj.apiURL === 'string') next.url = obj.apiURL
  if (typeof obj.username === 'string') next.username = obj.username
  if (typeof obj.password === 'string') next.password = obj.password
  if (typeof obj.category === 'string') next.category = obj.category
  else if (typeof obj.label === 'string') next.category = obj.label
  if (typeof obj.useAutoTMM === 'boolean') next.useAutoTMM = obj.useAutoTMM
  if (typeof obj.savePath === 'string') next.savePath = obj.savePath
  if (typeof obj.startPaused === 'boolean') next.startPaused = obj.startPaused
  return next
}

export function normalizeTransfer(raw: unknown, base: Config['transfer']): Config['transfer'] {
  if (!raw || typeof raw !== 'object') {
    return base
  }
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)
  if (typeof obj.enabled === 'boolean') next.enabled = obj.enabled
  if (typeof obj.host === 'string') next.host = obj.host
  if (typeof obj.port === 'number' && Number.isFinite(obj.port)) next.port = obj.port
  if (typeof obj.username === 'string') next.username = obj.username
  if (typeof obj.password === 'string') next.password = obj.password
  if (typeof obj.privateKeyPath === 'string') next.privateKeyPath = obj.privateKeyPath
  if (typeof obj.remotePath === 'string') next.remotePath = obj.remotePath
  return next
}

/**
 * Picks only the keys the section still has.
 *
 * The generic merge below is a blanket `Object.assign`, so a retired setting
 * left in an existing config.json would be copied straight back in and written
 * out again on the next save.
 */
export function normalizeCleanup(raw: unknown, base: Config['cleanup']): Config['cleanup'] {
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)
  if (typeof obj.archiveDirectory === 'string') {
    next.archiveDirectory = normalizePath(obj.archiveDirectory)
  }
  if (typeof obj.deleteOriginalFolder === 'boolean') {
    next.deleteOriginalFolder = obj.deleteOriginalFolder
  }
  if (typeof obj.deleteTemporaryFiles === 'boolean') {
    next.deleteTemporaryFiles = obj.deleteTemporaryFiles
  }
  if (typeof obj.deleteSpectralsAfterUpload === 'boolean') {
    next.deleteSpectralsAfterUpload = obj.deleteSpectralsAfterUpload
  }
  return next
}

export function normalizeSpectral(raw: unknown, base: Config['spectral']): Config['spectral'] {
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)
  if (typeof obj.imageHost === 'string') next.imageHost = obj.imageHost
  if (typeof obj.defaultSpectralIds === 'string') {
    next.defaultSpectralIds = obj.defaultSpectralIds
  }
  if (typeof obj.defaultSpectralIdsForLossyMasters === 'string') {
    next.defaultSpectralIdsForLossyMasters = obj.defaultSpectralIdsForLossyMasters
  }
  return next
}

export function normalizeWorkflow(raw: unknown, base: Config['workflow']): Config['workflow'] {
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)
  if (typeof obj.confirmBeforeWrites === 'boolean') {
    next.confirmBeforeWrites = obj.confirmBeforeWrites
  }
  if (typeof obj.useUpcAsCatNo === 'boolean') {
    next.useUpcAsCatNo = obj.useUpcAsCatNo
  }
  if (typeof obj.autoRepairFlacIntegrity === 'boolean') {
    next.autoRepairFlacIntegrity = obj.autoRepairFlacIntegrity
  }
  return next
}

export function normalizeNaming(raw: unknown, base: Config['naming']): Config['naming'] {
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)
  if (typeof obj.albumDescriptionTemplateId === 'string') {
    next.albumDescriptionTemplateId = obj.albumDescriptionTemplateId
  }
  if (typeof obj.releaseFolderTemplate === 'string') {
    next.releaseFolderTemplate = obj.releaseFolderTemplate
  }
  if (typeof obj.trackFileTemplate === 'string') {
    next.trackFileTemplate = obj.trackFileTemplate
  }
  if (typeof obj.multiDiscFolderTemplate === 'string') {
    next.multiDiscFolderTemplate = obj.multiDiscFolderTemplate
  }
  return next
}

export function normalizeTools(raw: unknown, base: Config['tools']): Config['tools'] {
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const next = structuredClone(base)
  for (const key of Object.keys(next) as (keyof Config['tools'])[]) {
    if (typeof obj[key] === 'string') next[key] = normalizePath(obj[key] as string)
  }
  return next
}

export function mergeLoadedConfig(raw: unknown): Config {
  const cfg = defaultConfig()
  if (!raw || typeof raw !== 'object') {
    return cfg
  }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(cfg) as (keyof Config)[]) {
    if (key === 'metadataProviders') {
      cfg.metadataProviders = normalizeMetadataProviders(obj.metadataProviders, cfg.metadataProviders)
      continue
    }
    if (key === 'tools') {
      cfg.tools = normalizeTools(obj.tools, cfg.tools)
      continue
    }
    if (key === 'trackers') {
      cfg.trackers = normalizeTrackers(obj.trackers, cfg.trackers)
      continue
    }
    if (key === 'torrentClient') {
      const legacy = obj.torrentClients ?? obj.torrentClient
      cfg.torrentClient = normalizeTorrentClient(legacy, cfg.torrentClient)
      continue
    }
    if (key === 'transfer') {
      cfg.transfer = normalizeTransfer(obj.transfer, cfg.transfer)
      continue
    }
    if (key === 'cleanup') {
      cfg.cleanup = normalizeCleanup(obj.cleanup, cfg.cleanup)
      continue
    }
    if (key === 'spectral') {
      cfg.spectral = normalizeSpectral(obj.spectral, cfg.spectral)
      continue
    }
    if (key === 'workflow') {
      cfg.workflow = normalizeWorkflow(obj.workflow, cfg.workflow)
      continue
    }
    if (key === 'naming') {
      cfg.naming = normalizeNaming(obj.naming, cfg.naming)
      continue
    }
    if (obj[key] && typeof obj[key] === 'object') {
      Object.assign(cfg[key] as object, obj[key])
    }
  }
  if (cfg.spectral.imageHost !== '' && !supportsSpectralUpload(cfg.spectral.imageHost)) {
    cfg.spectral.imageHost = ''
  }
  if (!isThemePreference(cfg.appearance.theme)) {
    cfg.appearance.theme = defaultConfig().appearance.theme
  }
  sanitizeCoverImageHosts(cfg)
  return cfg
}

export async function loadConfig(path: string): Promise<Config> {
  try {
    const data = await readFile(path, 'utf8')
    return mergeLoadedConfig(JSON.parse(data))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return defaultConfig()
    }
    throw new Error(`read config: ${String(err)}`)
  }
}

export async function saveConfig(path: string, cfg: Config): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 })
  const data = `${JSON.stringify(cfg, null, 2)}\n`
  await writeFile(path, data, { mode: 0o600 })
}

export function gravlaxConfigPath(userData: string): string {
  return join(userData, 'config.json')
}
