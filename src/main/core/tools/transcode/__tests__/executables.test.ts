import { describe, expect, it, vi } from 'vitest'
import type { ToolId, ToolResolver } from '@main/core/tools/binaries'
import { resolveMp3Executables } from '../mp3'

describe('resolveMp3Executables', () => {
  it('resolves both sides of the pipeline before spawning', async () => {
    const tools = resolver(async (id) => `/tools/${id}`)

    await expect(resolveMp3Executables(tools)).resolves.toEqual({
      flacExecutable: '/tools/flac',
      lameExecutable: '/tools/lame'
    })
    expect(tools.require).toHaveBeenCalledWith('flac')
    expect(tools.require).toHaveBeenCalledWith('lame')
  })

  it('fails resolution when either pipeline tool is missing', async () => {
    const tools = resolver(async (id) => {
      if (id === 'lame') throw new Error('lame is missing')
      return `/tools/${id}`
    })

    await expect(resolveMp3Executables(tools)).rejects.toThrow('lame is missing')
    expect(tools.require).toHaveBeenCalledTimes(2)
  })
})

function resolver(require: (id: ToolId) => Promise<string>): ToolResolver {
  return { resolve: vi.fn(), require: vi.fn(require) }
}
