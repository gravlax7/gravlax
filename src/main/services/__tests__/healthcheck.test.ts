import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import type { ToolId, ToolResolver, ToolResolution } from '@main/core/tools/binaries'
import type { Provider } from '@main/core/tools/metadata/base'

const mocks = vi.hoisted(() => ({
  healthcheckTrackers: vi.fn(),
  trackerHealthRowsReady: vi.fn(),
  healthcheckImageHosts: vi.fn(),
  providerDefinitions: vi.fn(),
  createProviders: vi.fn(),
  probeToolVersion: vi.fn()
}))

vi.mock('@main/core/tools/trackers/health', () => ({
  healthcheckTrackers: mocks.healthcheckTrackers,
  trackerHealthRowsReady: mocks.trackerHealthRowsReady
}))

vi.mock('@main/core/tools/imagehosts/health', () => ({
  healthcheckImageHosts: mocks.healthcheckImageHosts
}))

vi.mock('@main/core/tools/metadata/providers', () => ({
  providerDefinitions: mocks.providerDefinitions,
  createProviders: mocks.createProviders
}))

vi.mock('@main/core/tools/versions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@main/core/tools/versions')>()
  return { ...original, probeToolVersion: mocks.probeToolVersion }
})

import { runHealthcheck } from '../healthcheck'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.healthcheckTrackers.mockResolvedValue([
    { id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' }
  ])
  mocks.trackerHealthRowsReady.mockReturnValue(true)
  mocks.healthcheckImageHosts.mockResolvedValue([
    { id: 'image:host', name: 'Image host', status: 'available' }
  ])
  mocks.providerDefinitions.mockReturnValue([])
  mocks.createProviders.mockReturnValue([])
  mocks.probeToolVersion.mockImplementation(async (id: ToolId) => ({
    product: id === 'sox' ? 'SoX' : id === 'lame' ? 'LAME' : id === 'flac' ? 'FLAC' : 'metaflac',
    version: id === 'sox' ? '14.4.2' : id === 'lame' ? '3.100' : '1.5.0'
  }))
})

describe('binary healthchecks', () => {
  it('shows the resolved executable path and forces a fresh lookup', async () => {
    const tools = fakeResolver((id) => ({
      status: 'available',
      path: `/tools/${id}`,
      source: 'standard'
    }))

    const result = await runHealthcheck(defaultConfig(), tools)

    expect(result.rows.find((row) => row.id === 'bin:sox')).toMatchObject({
      status: 'available',
      detail: 'SoX 14.4.2 · /tools/sox'
    })
    expect(tools.resolve).toHaveBeenCalledWith('sox', { refresh: true })
  })

  it('rejects FLAC tools older than 1.5.0', async () => {
    mocks.probeToolVersion.mockImplementation(async (id: ToolId) => ({
      product: id === 'metaflac' ? 'metaflac' : id === 'flac' ? 'FLAC' : id === 'lame' ? 'LAME' : 'SoX',
      version: id === 'flac' || id === 'metaflac' ? '1.3.1' : id === 'lame' ? '3.100' : '14.4.2'
    }))
    const tools = fakeResolver((id) => ({
      status: 'available',
      path: `/tools/${id}`,
      source: 'standard'
    }))

    const result = await runHealthcheck(defaultConfig(), tools)

    expect(result.rows.find((row) => row.id === 'bin:flac')).toMatchObject({
      status: 'failing',
      detail: 'FLAC 1.3.1 is unsupported; version 1.5.0 or newer is required · /tools/flac'
    })
    expect(result.rows.find((row) => row.id === 'bin:metaflac')).toMatchObject({
      status: 'failing'
    })
    expect(result.overview).toBe('Not ready to upload.')
  })

  it('reports an invalid override', async () => {
    const tools = fakeResolver((id) => {
      if (id === 'sox') {
        return {
          status: 'missing',
          configuredPath: '/bad/sox',
          reason: 'Configured executable is not a runnable file: /bad/sox'
        }
      }
      return { status: 'available', path: `/tools/${id}`, source: 'path' }
    })

    const result = await runHealthcheck(defaultConfig(), tools)

    expect(result.rows.find((row) => row.id === 'bin:sox')).toMatchObject({
      status: 'missing',
      detail: 'Configured executable is not a runnable file: /bad/sox'
    })
  })
})

describe('provider healthchecks', () => {
  it('publishes each row while checks are still in flight', async () => {
    const updates: Array<{ overview: string; statuses: string[] }> = []
    mocks.healthcheckTrackers.mockImplementation(async (_cfg, _ids, _source, onRow) => {
      const checking = {
        id: 'trackers:redacted:api',
        name: 'Redacted API',
        group: 'Trackers',
        status: 'checking' as const,
        detail: 'Checking…'
      }
      onRow?.(checking)
      await new Promise((resolve) => setTimeout(resolve, 0))
      const done = { ...checking, status: 'available' as const, detail: 'Available' }
      onRow?.(done)
      return [done]
    })

    const result = await runHealthcheck(
      defaultConfig(),
      fakeResolver((id) => ({ status: 'available', path: `/tools/${id}`, source: 'path' })),
      'manual',
      (next) => {
        updates.push({
          overview: next.overview,
          statuses: next.rows.map((row) => `${row.id}:${row.status}`)
        })
      }
    )

    expect(updates[0]?.overview).toBe('Checking dependencies…')
    expect(updates[0]?.statuses).toContain('trackers:redacted:api:checking')
    expect(result.rows.find((row) => row.id === 'trackers:redacted:api')).toMatchObject({
      status: 'available'
    })
    expect(result.overview).not.toBe('Checking dependencies…')
  })

  it('treats a passing Redacted API as enough when only the Redacted image host is enabled', async () => {
    mocks.healthcheckImageHosts.mockResolvedValue([
      { id: 'img:imgbb', name: 'imgbb', group: 'Image Hosts', status: 'disabled' },
      { id: 'img:catbox', name: 'Catbox', group: 'Image Hosts', status: 'disabled' },
      { id: 'img:thesungod', name: 'Ra', group: 'Image Hosts', status: 'disabled' }
    ])
    const cfg = defaultConfig()
    cfg.imageHosts.redacted.enabled = true
    cfg.imageHosts.catbox.enabled = false

    const result = await runHealthcheck(
      cfg,
      fakeResolver((id) => ({ status: 'available', path: `/tools/${id}`, source: 'path' }))
    )

    expect(result.overview).toBe('Ready to upload.')
    expect(result.rows.find((row) => row.id === 'img:redacted')).toBeUndefined()
  })

  it('checks other dependencies without waiting for trackers', async () => {
    let releaseTrackers!: () => void
    mocks.healthcheckTrackers.mockReturnValue(
      new Promise((resolve) => {
        releaseTrackers = () =>
          resolve([{ id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' }])
      })
    )
    let imageHostsStarted = false
    mocks.healthcheckImageHosts.mockImplementation(async () => {
      imageHostsStarted = true
      return [{ id: 'image:host', name: 'Image host', status: 'available' }]
    })

    const pending = runHealthcheck(
      defaultConfig(),
      fakeResolver((id) => ({ status: 'available', path: `/tools/${id}`, source: 'path' }))
    )
    await Promise.resolve()
    expect(imageHostsStarted).toBe(true)

    releaseTrackers()
    await pending
  })

  it('aborts a provider request when its healthcheck times out', async () => {
    vi.useFakeTimers()
    try {
      let requestSignal: AbortSignal | undefined
      const provider: Provider = {
        name: 'MusicBrainz',
        healthcheck: vi.fn(async (signal) => {
          requestSignal = signal
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('The operation was aborted', 'AbortError')),
              { once: true }
            )
          })
        }),
        async searchReleases() {
          return []
        },
        releaseIDFromURL() {
          return null
        },
        async fetchData() {
          return {}
        },
        mapRelease() {
          return {}
        },
        formatURL() {
          return ''
        }
      }
      mocks.providerDefinitions.mockReturnValue([{ name: provider.name, enabled: true }])
      mocks.createProviders.mockReturnValue([provider])

      const pending = runHealthcheck(
        defaultConfig(),
        fakeResolver((id) => ({ status: 'available', path: `/tools/${id}`, source: 'path' }))
      )
      await vi.runAllTimersAsync()
      const result = await pending

      expect(requestSignal?.aborted).toBe(true)
      expect(result.rows.find((row) => row.id === 'meta:MusicBrainz')).toMatchObject({
        status: 'failing',
        detail: 'Error: timeout'
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

function fakeResolver(resolve: (id: ToolId) => ToolResolution): ToolResolver {
  return {
    resolve: vi.fn(async (id: ToolId) => resolve(id)),
    require: vi.fn(async (id: ToolId) => {
      const result = resolve(id)
      if (result.status === 'available') return result.path
      throw new Error(result.reason)
    })
  }
}
