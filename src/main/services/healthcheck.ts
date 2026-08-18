import type { Config } from '@shared/types/config'
import type { HealthResult, HealthRow } from '@shared/types'
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

export async function runHealthcheck(
  cfg: Config,
  tools: ToolResolver = automaticToolResolver
): Promise<HealthResult> {
  const rows: HealthRow[] = []

  const trackerRows = await healthcheckTrackers(cfg)
  rows.push(...trackerRows)
  rows.push(...(await healthcheckSeed(cfg)))

  const imageHostRows = await healthcheckImageHosts(cfg)
  rows.push(...imageHostRows)

  const definitions = providerDefinitions(cfg)
  const providers = createProviders(cfg)
  const byName = new Map(providers.map((p) => [p.name, p]))
  await Promise.all(
    definitions.map(async (definition) => {
      const row: HealthRow = {
        id: `meta:${definition.name}`,
        name: definition.name,
        group: 'Metadata Providers',
        status: 'checking'
      }
      if (!definition.enabled) {
        row.status = 'disabled'
        row.detail = 'Disabled'
        rows.push(row)
        return
      }
      const provider = byName.get(definition.name)
      if (!provider) {
        row.status = 'failing'
        row.detail = 'Provider unavailable'
        rows.push(row)
        return
      }
      try {
        await withTimeout(provider.healthcheck(), 3000)
        row.status = 'available'
        row.detail = 'Available'
      } catch (err) {
        row.status = 'failing'
        row.detail = String(err)
      }
      rows.push(row)
    })
  )

  const requiredBinaryIds = new Set(BINARY_CHECKS.map((b) => `bin:${b.id}`))

  for (const binary of BINARY_CHECKS) {
    const resolution = await tools.resolve(binary.id, { refresh: true })
    if (resolution.status === 'missing') {
      rows.push({
        id: `bin:${binary.id}`,
        name: binary.name,
        group: 'Tools',
        status: 'missing',
        detail: resolution.configuredPath ? resolution.reason : 'Missing',
        installURL: binary.installURL,
        installInstructions: binary.instructions
      })
      continue
    }

    try {
      const detected = await probeToolVersion(binary.id, resolution.path)
      const versionLabel = `${detected.product} ${detected.version}`
      if (
        binary.minimumVersion &&
        compareToolVersions(detected.version, binary.minimumVersion) < 0
      ) {
        rows.push({
          id: `bin:${binary.id}`,
          name: binary.name,
          group: 'Tools',
          status: 'failing',
          detail: `${versionLabel} is unsupported; version ${binary.minimumVersion} or newer is required · ${resolution.path}`,
          installURL: binary.installURL,
          installInstructions: binary.instructions
        })
        continue
      }
      rows.push({
        id: `bin:${binary.id}`,
        name: binary.name,
        group: 'Tools',
        status: 'available',
        detail: `${versionLabel} · ${resolution.path}`,
        installURL: binary.installURL,
        installInstructions: binary.instructions
      })
    } catch (err) {
      rows.push({
        id: `bin:${binary.id}`,
        name: binary.name,
        group: 'Tools',
        status: 'failing',
        detail: `${err instanceof Error ? err.message : String(err)} · ${resolution.path}`,
        installURL: binary.installURL,
        installInstructions: binary.instructions
      })
    }
  }

  const trackerReady = trackerHealthRowsReady(trackerRows)
  const imageReady = imageHostRows.some((r) => r.status === 'available')
  const binaryUnavailable = rows.some(
    (r) => requiredBinaryIds.has(r.id) && (r.status === 'missing' || r.status === 'failing')
  )
  const overview =
    trackerReady && imageReady && !binaryUnavailable
      ? 'Ready to upload.'
      : 'Not ready to upload.'

  return { overview, rows }
}

async function healthcheckSeed(cfg: Config): Promise<HealthRow[]> {
  const rows: HealthRow[] = []

  const seedbox: HealthRow = {
    id: 'seedbox',
    name: 'Seedbox',
    group: 'Seeding',
    status: 'checking'
  }
  if (!cfg.transfer.enabled) {
    seedbox.status = 'disabled'
    seedbox.detail = 'Disabled (local seeding)'
  } else {
    try {
      await withTimeout(testSftpConnection(cfg.transfer), 5000)
      seedbox.status = 'available'
      seedbox.detail = `SFTP ${cfg.transfer.host}:${cfg.transfer.port || 22}`
    } catch (err) {
      seedbox.status = 'failing'
      seedbox.detail = err instanceof Error ? err.message : String(err)
    }
  }
  rows.push(seedbox)

  const torrentClient: HealthRow = {
    id: 'torrentClient',
    name: 'Torrent Client',
    group: 'Seeding',
    status: 'checking'
  }
  if (!cfg.torrentClient.enabled) {
    torrentClient.status = 'disabled'
    torrentClient.detail = 'Disabled'
  } else {
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
  rows.push(torrentClient)

  return rows
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
