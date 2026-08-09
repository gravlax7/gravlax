import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import type { ToolId, ToolResolver, ToolResolution } from '@main/core/tools/binaries'

const mocks = vi.hoisted(() => ({
  healthcheckTrackers: vi.fn(),
  trackerHealthRowsReady: vi.fn(),
  healthcheckImageHosts: vi.fn(),
  providerDefinitions: vi.fn(),
  createProviders: vi.fn()
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
      detail: 'Available · /tools/sox'
    })
    expect(tools.resolve).toHaveBeenCalledWith('sox', { refresh: true })
  })

  it('reports an invalid override and keeps automatic optional misses concise', async () => {
    const tools = fakeResolver((id) => {
      if (id === 'sox') {
        return {
          status: 'missing',
          configuredPath: '/bad/sox',
          reason: 'Configured executable is not a runnable file: /bad/sox'
        }
      }
      if (id === 'flaccheck') {
        return {
          status: 'missing',
          reason: 'Could not find flaccheck in PATH or common install locations.'
        }
      }
      return { status: 'available', path: `/tools/${id}`, source: 'path' }
    })

    const result = await runHealthcheck(defaultConfig(), tools)

    expect(result.rows.find((row) => row.id === 'bin:sox')).toMatchObject({
      status: 'missing',
      detail: 'Configured executable is not a runnable file: /bad/sox'
    })
    expect(result.rows.find((row) => row.id === 'bin:flaccheck')).toMatchObject({
      status: 'missing',
      detail: 'Missing (optional)'
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
