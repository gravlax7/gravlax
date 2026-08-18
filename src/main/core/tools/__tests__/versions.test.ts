import { describe, expect, it } from 'vitest'
import { compareToolVersions, parseToolVersion } from '../versions'

describe('tool versions', () => {
  it.each([
    ['sox', 'sox:      SoX v14.4.2', { product: 'SoX', version: '14.4.2' }],
    ['sox', 'sox:      SoX_ng v14.7.1.2', { product: 'SoX_ng', version: '14.7.1.2' }],
    ['flac', 'flac 1.5.0', { product: 'FLAC', version: '1.5.0' }],
    ['metaflac', 'metaflac 1.5.0', { product: 'metaflac', version: '1.5.0' }],
    ['lame', 'LAME 64bits version 3.100', { product: 'LAME', version: '3.100' }]
  ] as const)('parses %s output', (id, output, expected) => {
    expect(parseToolVersion(id, output)).toEqual(expected)
  })

  it('rejects output from the wrong program', () => {
    expect(parseToolVersion('flac', 'not flac at all')).toBeNull()
  })

  it('compares versions with different part counts', () => {
    expect(compareToolVersions('1.5.0', '1.5')).toBe(0)
    expect(compareToolVersions('1.4.3', '1.5.0')).toBeLessThan(0)
    expect(compareToolVersions('14.7.1.2', '14.4.2')).toBeGreaterThan(0)
  })
})
