import type { Config } from '@shared/types/config'
import type { HealthResult, HealthRow } from '@shared/types'
import { findOnPath } from '@main/core/tools/binaries'
import { providerDefinitions, createProviders } from '@main/core/tools/metadata/providers'
import { healthcheckImageHosts } from '@main/core/tools/imagehosts/health'
import { healthcheckTrackers, trackerHealthRowsReady } from '@main/core/tools/trackers/health'
import { createQBittorrentClient } from '@main/core/tools/torrentClient'
import { testSftpConnection } from '@main/core/tools/transfer'

const BINARY_CHECKS: Array<{
  id: string
  name: string
  installURL: string
  instructions: string
  optional?: boolean
}> = [
  {
    id: 'sox',
    name: 'Sox',
    installURL: 'https://sourceforge.net/projects/sox/',
    instructions: 'Install SoX and ensure it is available on PATH.'
  },
  {
    id: 'flac',
    name: 'flac',
    installURL: 'https://xiph.org/flac/',
    instructions: 'Install flac and ensure it is available on PATH.'
  },
  {
    id: 'metaflac',
    name: 'metaflac',
    installURL: 'https://xiph.org/flac/',
    instructions: 'Install FLAC tools and ensure metaflac is available on PATH.'
  },
  {
    id: 'mp3val',
    name: 'mp3val',
    installURL: 'http://mp3val.sourceforge.net/',
    instructions: 'Install mp3val and ensure it is available on PATH.'
  },
  {
    id: 'lame',
    name: 'lame',
    installURL: 'https://lame.sourceforge.io/',
    instructions: 'Install lame and ensure it is available on PATH.'
  },
  {
    id: 'flaccheck',
    name: 'flaccheck',
    installURL: 'https://github.com/dasunNimantha/flaccheck',
    instructions:
      'Optional. Install flaccheck (cargo install --path crates/flaccheck-cli) and ensure it is available on PATH.',
    optional: true
  }
]

export async function runHealthcheck(cfg: Config): Promise<HealthResult> {
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

  const requiredBinaryIds = new Set(
    BINARY_CHECKS.filter((b) => !b.optional).map((b) => `bin:${b.id}`)
  )

  for (const binary of BINARY_CHECKS) {
    const found = await findOnPath(binary.id)
    rows.push({
      id: `bin:${binary.id}`,
      name: binary.name,
      status: found ? 'available' : 'missing',
      detail: found ? 'Available' : binary.optional ? 'Missing (optional)' : 'Missing',
      installURL: binary.installURL,
      installInstructions: binary.instructions
    })
  }

  const trackerReady = trackerHealthRowsReady(trackerRows)
  const imageReady = imageHostRows.some((r) => r.status === 'available')
  const binaryMissing = rows.some(
    (r) => requiredBinaryIds.has(r.id) && r.status === 'missing'
  )
  const overview =
    trackerReady && imageReady && !binaryMissing
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
