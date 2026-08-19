import { describe, expect, it, vi } from 'vitest'
import { compareToolVersions, parseToolVersion, probeToolVersion } from '../versions'

describe('tool versions', () => {
  it.each([
    ['sox', 'sox:      SoX v14.4.2', { product: 'SoX', version: '14.4.2' }],
    ['sox', 'sox:      SoX_ng v14.7.1.2', { product: 'SoX_ng', version: '14.7.1.2' }],
    ['flac', 'flac 1.5.0', { product: 'FLAC', version: '1.5.0' }],
    ['metaflac', 'metaflac 1.5.0', { product: 'metaflac', version: '1.5.0' }],
    [
      'metaflac',
      'metaflac - Command-line FLAC metadata editor version 1.5.0',
      { product: 'metaflac', version: '1.5.0' }
    ],
    ['lame', 'LAME 64bits version 3.100', { product: 'LAME', version: '3.100' }]
  ] as const)('parses %s output', (id, output, expected) => {
    expect(parseToolVersion(id, output)).toEqual(expected)
  })

  it('rejects output from the wrong program', () => {
    expect(parseToolVersion('flac', 'not flac at all')).toBeNull()
  })

  it('falls back to metaflac help when Windows 1.5.0 prints no version', async () => {
    const run = vi
      .fn<(executable: string, args: string[]) => Promise<string>>()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('metaflac - Command-line FLAC metadata editor version 1.5.0')

    await expect(probeToolVersion('metaflac', 'C:\\FLAC\\metaflac.exe', run)).resolves.toEqual({
      product: 'metaflac',
      version: '1.5.0'
    })
    expect(run).toHaveBeenNthCalledWith(1, 'C:\\FLAC\\metaflac.exe', ['--version'])
    expect(run).toHaveBeenNthCalledWith(2, 'C:\\FLAC\\metaflac.exe', ['--help'])
  })

  it('does not use the help fallback when metaflac returns its version', async () => {
    const run = vi.fn<(executable: string, args: string[]) => Promise<string>>().mockResolvedValue('metaflac 1.5.0')

    await expect(probeToolVersion('metaflac', 'metaflac', run)).resolves.toEqual({ product: 'metaflac', version: '1.5.0' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('compares versions with different part counts', () => {
    expect(compareToolVersions('1.5.0', '1.5')).toBe(0)
    expect(compareToolVersions('1.4.3', '1.5.0')).toBeLessThan(0)
    expect(compareToolVersions('14.7.1.2', '14.4.2')).toBeGreaterThan(0)
  })
})
