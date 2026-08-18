import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import type { ToolId, ToolResolver, ToolResolution } from '@main/core/tools/binaries'

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
