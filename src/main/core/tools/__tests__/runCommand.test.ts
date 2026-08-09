import { describe, expect, it, vi } from 'vitest'
import type { ToolResolver } from '../binaries'
import { runCommand } from '../runCommand'

describe('runCommand', () => {
  it('spawns the absolute path returned by the resolver', async () => {
    const tools: ToolResolver = {
      resolve: vi.fn(),
      require: vi.fn(async () => process.execPath)
    }

    const output = await runCommand(
      'sox',
      ['-e', 'process.stdout.write("resolved")'],
      undefined,
      undefined,
      tools
    )

    expect(output.toString()).toBe('resolved')
    expect(tools.require).toHaveBeenCalledWith('sox')
  })
})
