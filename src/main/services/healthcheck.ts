import type { Config } from '@shared/types/config'
import type { HealthResult, HealthRow } from '@shared/types'
import { trackerHealthRowId } from '@shared/upload/validation'
import {
  automaticToolResolver,
  type ToolId,
  type ToolResolver
} from '@main/core/tools/binaries'
import { compareToolVersions, probeToolVersion } from '@main/core/tools/versions'
import { providerDefinitions, createProviders } from '@main/core/tools/metadata/providers'
import { healthcheckImageHosts } from '@main/core/tools/imagehosts/health'
import { healthcheckTrackers, trackerHealthRowsReady } from '@main/core/tools/trackers/health'
import { createQBittorrentClient } from '@main/core/tools/torrentClient'
import { testSftpConnection } from '@main/core/tools/transfer'

export type HealthRowReporter = (row: HealthRow) => void

const BINARY_CHECKS: Array<{
  id: ToolId
  name: string
  installURL: string
  instructions: string
  minimumVersion?: string
}> = [
  {
    id: 'sox',
    name: 'SoX',
    installURL: 'https://sourceforge.net/projects/sox/',
    instructions: 'Install SoX 14.4.2 or newer and ensure it is available on PATH, or select the binary in Settings → Tools.',
    minimumVersion: '14.4.2'
  },
  {
    id: 'flac',
    name: 'FLAC',
    installURL: 'https://xiph.org/flac/',
    instructions: 'Install FLAC 1.5.0 or newer and ensure it is available on PATH, or select the binary in Settings → Tools.',
    minimumVersion: '1.5.0'
  },
  {
    id: 'metaflac',
    name: 'metaflac',
    installURL: 'https://xiph.org/flac/',
    instructions: 'Install FLAC 1.5.0 or newer and ensure metaflac is available on PATH, or select the binary in Settings → Tools.',
    minimumVersion: '1.5.0'
  },
  {
    id: 'lame',
    name: 'LAME',
    installURL: 'https://lame.sourceforge.io/',
    instructions: 'Install LAME 3.100 or newer and ensure it is available on PATH, or select the binary in Settings → Tools.',
    minimumVersion: '3.100'
  }
]

let nextHealthcheckRunId = 0

export async function runHealthcheck(
  cfg: Config,
  tools: ToolResolver = automaticToolResolver,
  source: 'startup' | 'settings-save' | 'manual' = 'manual',
  onUpdate?: (result: HealthResult) => void
): Promise<HealthResult> {
  const runId = ++nextHealthcheckRunId
  const rows = new Map<string, HealthRow>()
  const order: string[] = []
  let publishing = false

  const snapshot = (): HealthResult => ({
    runId,
    overview: overviewFor(cfg, order.map((id) => rows.get(id)!)),
    rows: order.map((id) => ({ ...rows.get(id)! }))
  })

  const report: HealthRowReporter = (row) => {
    if (!rows.has(row.id)) order.push(row.id)
    rows.set(row.id, row)
    if (publishing) onUpdate?.(snapshot())
  }

  const tasks = [
    healthcheckTrackers(cfg, undefined, source, report),
    healthcheckSeed(cfg, report),
    healthcheckImageHosts(cfg, report),
    healthcheckMetadata(cfg, report),
    healthcheckTools(tools, report)
  ]
  publishing = true
  onUpdate?.(snapshot())
  const groups = await Promise.all(tasks)
  for (const row of groups.flat()) report(row)
  return snapshot()
}

function overviewFor(cfg: Config, rows: HealthRow[]): string {
  if (rows.some((row) => row.status === 'checking')) return 'Checking dependencies…'
  const trackerReady = trackerHealthRowsReady(rows.filter((row) => row.group === 'Trackers'))
  const imageReady =
    rows.some((row) => row.group === 'Image Hosts' && row.status === 'available') ||
    (cfg.imageHosts.redacted.enabled &&
      rows.some(
        (row) => row.id === trackerHealthRowId('redacted', 'api') && row.status === 'available'
      ))
  const binaryUnavailable = rows.some(
    (row) => row.id.startsWith('bin:') && (row.status === 'missing' || row.status === 'failing')
  )
  return trackerReady && imageReady && !binaryUnavailable
    ? 'Ready to upload.'
    : 'Not ready to upload.'
}

async function healthcheckMetadata(cfg: Config, onRow?: HealthRowReporter): Promise<HealthRow[]> {
  const definitions = providerDefinitions(cfg)
  const providers = createProviders(cfg)
  const byName = new Map(providers.map((p) => [p.name, p]))
  for (const definition of definitions) {
    onRow?.({
      id: `meta:${definition.name}`,
      name: definition.name,
      group: 'Metadata Providers',
      status: definition.enabled ? 'checking' : 'disabled',
      detail: definition.enabled ? 'Checking…' : 'Disabled'
    })
  }
  return Promise.all(
    definitions.map(async (definition) => {
      const row: HealthRow = {
        id: `meta:${definition.name}`,
        name: definition.name,
        group: 'Metadata Providers',
        status: 'checking'
      }
      if (!definition.enabled) {
        const disabled = { ...row, status: 'disabled' as const, detail: 'Disabled' }
        onRow?.(disabled)
        return disabled
      }
      const provider = byName.get(definition.name)
      if (!provider) {
        const missing = { ...row, status: 'failing' as const, detail: 'Provider unavailable' }
        onRow?.(missing)
        return missing
      }
      try {
        const controller = new AbortController()
        try {
          await withTimeout(provider.healthcheck(controller.signal), 3000)
        } finally {
          controller.abort()
        }
        const available = { ...row, status: 'available' as const, detail: 'Available' }
        onRow?.(available)
        return available
      } catch (err) {
        const failing = { ...row, status: 'failing' as const, detail: String(err) }
        onRow?.(failing)
        return failing
      }
    })
  )
}

async function healthcheckTools(tools: ToolResolver, onRow?: HealthRowReporter): Promise<HealthRow[]> {
  for (const binary of BINARY_CHECKS) {
    onRow?.({
      id: `bin:${binary.id}`,
      name: binary.name,
      group: 'Tools',
      status: 'checking',
      detail: 'Checking…',
      installURL: binary.installURL,
      installInstructions: binary.instructions
    })
  }

  const rows: HealthRow[] = []
  for (const binary of BINARY_CHECKS) {
    const resolution = await tools.resolve(binary.id, { refresh: true })
    if (resolution.status === 'missing') {
      const row: HealthRow = {
        id: `bin:${binary.id}`,
        name: binary.name,
        group: 'Tools',
        status: 'missing',
        detail: resolution.configuredPath ? resolution.reason : 'Missing',
        installURL: binary.installURL,
        installInstructions: binary.instructions
      }
      onRow?.(row)
      rows.push(row)
      continue
    }

    try {
      const detected = await probeToolVersion(binary.id, resolution.path)
      const versionLabel = `${detected.product} ${detected.version}`
      if (
        binary.minimumVersion &&
        compareToolVersions(detected.version, binary.minimumVersion) < 0
      ) {
        const row: HealthRow = {
          id: `bin:${binary.id}`,
          name: binary.name,
          group: 'Tools',
          status: 'failing',
          detail: `${versionLabel} is unsupported; version ${binary.minimumVersion} or newer is required · ${resolution.path}`,
          installURL: binary.installURL,
          installInstructions: binary.instructions
        }
        onRow?.(row)
        rows.push(row)
        continue
      }
      const row: HealthRow = {
        id: `bin:${binary.id}`,
        name: binary.name,
        group: 'Tools',
        status: 'available',
        detail: `${versionLabel} · ${resolution.path}`,
        installURL: binary.installURL,
        installInstructions: binary.instructions
      }
      onRow?.(row)
      rows.push(row)
    } catch (err) {
      const row: HealthRow = {
        id: `bin:${binary.id}`,
        name: binary.name,
        group: 'Tools',
        status: 'failing',
        detail: `${err instanceof Error ? err.message : String(err)} · ${resolution.path}`,
        installURL: binary.installURL,
        installInstructions: binary.instructions
      }
      onRow?.(row)
      rows.push(row)
    }
  }
  return rows
}

async function healthcheckSeed(cfg: Config, onRow?: HealthRowReporter): Promise<HealthRow[]> {
  const seedbox: HealthRow = {
    id: 'seedbox',
    name: 'Seedbox',
    group: 'Seeding',
    status: cfg.transfer.enabled ? 'checking' : 'disabled',
    detail: cfg.transfer.enabled ? 'Checking…' : 'Disabled (local seeding)'
  }
  const torrentClient: HealthRow = {
    id: 'torrentClient',
    name: 'Torrent Client',
    group: 'Seeding',
    status: cfg.torrentClient.enabled ? 'checking' : 'disabled',
    detail: cfg.torrentClient.enabled ? 'Checking…' : 'Disabled'
  }
  onRow?.(seedbox)
  onRow?.(torrentClient)

  if (cfg.transfer.enabled) {
    try {
      await withTimeout(testSftpConnection(cfg.transfer), 5000)
      seedbox.status = 'available'
      seedbox.detail = `SFTP ${cfg.transfer.host}:${cfg.transfer.port || 22}`
    } catch (err) {
      seedbox.status = 'failing'
      seedbox.detail = err instanceof Error ? err.message : String(err)
    }
  }
  onRow?.(seedbox)

  if (cfg.torrentClient.enabled) {
    try {
      const client = createQBittorrentClient(cfg.torrentClient)
      const version = await withTimeout(client.version(), 5000)
      torrentClient.status = 'available'
      torrentClient.detail = version ? `qBittorrent ${version}` : 'Available'
    } catch (err) {
      torrentClient.status = 'failing'
      torrentClient.detail = err instanceof Error ? err.message : String(err)
    }
  }
  onRow?.(torrentClient)

  return [seedbox, torrentClient]
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
